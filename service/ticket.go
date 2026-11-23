package service

// Ticket service: the single transaction-orchestration layer for the ticket
// system (contract v3.1, docs/ticket-system-delivery-plan.md appendix A).
//
// Dependency direction: controller -> service -> model. This package never
// imports gin and never reads request bodies; viewer identity is always passed
// in as explicit arguments by the controller.
//
// Hard constraints honoured here (§3.3):
//   - No raw SQL, no DB.Exec, no dialect-specific functions, no JSON columns.
//   - All GORM methods with `?` placeholders; column-to-column comparisons and
//     assignments are expressed with gorm.Expr.
//   - All timestamps are int64 Unix seconds from common.GetTimestamp().
//   - No JSON marshalling helper is imported or used here.

import (
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Business error codes and the typed error carrying them
// ---------------------------------------------------------------------------

const (
	CodeInvalidParams      = "ticket.invalid_params"
	CodeTitleEmpty         = "ticket.title_empty"
	CodeTitleTooLong       = "ticket.title_too_long"
	CodeContentEmpty       = "ticket.content_empty"
	CodeContentTooLong     = "ticket.content_too_long"
	CodeNotFound           = "ticket.not_found"
	CodeStatusNotReplyable = "ticket.status_not_replyable"
	CodeInvalidTransition  = "ticket.invalid_transition"
	CodeDuplicate          = "ticket.duplicate"
	CodeRateLimited        = "ticket.rate_limited"
	CodeDbError            = "ticket.db_error"
)

// TicketError is a machine-code business failure. The controller turns Code
// into an i18n message key; the code itself is never translated.
type TicketError struct {
	Code string
}

func (e *TicketError) Error() string {
	return e.Code
}

func ticketErr(code string) error {
	return &TicketError{Code: code}
}

// ---------------------------------------------------------------------------
// Fixed parameters (§7.4 / §7.6 / §14.1)
// ---------------------------------------------------------------------------

const (
	ticketTitleMaxRunes     = 200
	ticketContentMaxRunes   = 8000
	ticketContentMaxBytes   = 65535 // <= 65535; MySQL TEXT ceiling, defensive
	ticketDetailStreamLimit = 200
	ticketDuplicateWindow   = int64(60)
	ticketWriteRetryLimit   = 2 // §14.1 #2: bounded retries, at most 2
	ticketSearchMaxRunes    = 64
)

// ---------------------------------------------------------------------------
// Validation helpers (double-checked: controller + service)
// ---------------------------------------------------------------------------

// ValidateTicketTitle checks emptiness and the 200-rune ceiling. TrimSpace is
// used ONLY for the emptiness test; the stored value is never rewritten.
func ValidateTicketTitle(title string) error {
	if strings.TrimSpace(title) == "" {
		return ticketErr(CodeTitleEmpty)
	}
	if utf8.RuneCountInString(title) > ticketTitleMaxRunes {
		return ticketErr(CodeTitleTooLong)
	}
	return nil
}

// ValidateTicketContent checks both limits; whichever is exceeded first wins,
// but both map to the single public code content_too_long.
func ValidateTicketContent(content string) error {
	if strings.TrimSpace(content) == "" {
		return ticketErr(CodeContentEmpty)
	}
	if utf8.RuneCountInString(content) > ticketContentMaxRunes ||
		len([]byte(content)) > ticketContentMaxBytes {
		return ticketErr(CodeContentTooLong)
	}
	return nil
}

func ValidateStatusEnum(s string) bool {
	return s == model.TicketStatusPending ||
		s == model.TicketStatusProcessing ||
		s == model.TicketStatusResolved ||
		s == model.TicketStatusClosed
}

func ValidateActionEnum(s string) bool {
	return s == "close" || s == "reopen"
}

func isAdminRole(role int) bool {
	return role >= common.RoleAdminUser
}

// EscapeLike escapes the LIKE wildcards using '!' as the ESCAPE character,
// matching model/log.go's `LIKE ? ESCAPE '!'` convention. '!' itself must be
// doubled first because it is the escape character.
func EscapeLike(keyword string) string {
	return strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(keyword)
}

// ---------------------------------------------------------------------------
// Response DTOs (no title/content is ever echoed by a write response)
// ---------------------------------------------------------------------------

type CreateView struct {
	Id            int    `json:"id"`
	Status        string `json:"status"`
	MessageCount  int    `json:"message_count"`
	LastMessageId int    `json:"last_message_id"`
}

type WriteResultView struct {
	Changed       bool   `json:"changed"`
	Status        string `json:"status"`
	MessageCount  int    `json:"message_count"`
	LastMessageId int    `json:"last_message_id"`
}

type UnreadView struct {
	Count int    `json:"count"`
	Scope string `json:"scope"`
}

type ReadResultView struct {
	Changed    bool   `json:"changed"`
	Count      int    `json:"count"`
	LastReadId int    `json:"last_read_id"`
	Scope      string `json:"scope"`
}

// TicketSelfView is the user-side ticket row. It deliberately exposes no admin
// watermark columns.
type TicketSelfView struct {
	Id            int    `json:"id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	MessageCount  int    `json:"message_count"`
	LastMessageId int    `json:"last_message_id"`
	LastMessageAt int64  `json:"last_message_at"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

// TicketAdminView is A1 / A3's ticket row: the self view plus submitter and the
// admin-side watermark. admin_last_read_id is a ROW-LEVEL column of this
// ticket, shared by all administrators; it is not a system-wide value.
type TicketAdminView struct {
	Id                int    `json:"id"`
	Title             string `json:"title"`
	Status            string `json:"status"`
	MessageCount      int    `json:"message_count"`
	LastMessageId     int    `json:"last_message_id"`
	LastMessageAt     int64  `json:"last_message_at"`
	CreatedAt         int64  `json:"created_at"`
	UpdatedAt         int64  `json:"updated_at"`
	UserId            int    `json:"user_id"`
	Username          string `json:"username"`
	LastAdminNotifyId int    `json:"last_admin_notify_id"`
	AdminLastReadId   int    `json:"admin_last_read_id"`
}

// MessageView is exactly the 12 fields of U4 / A3 replies[].
type MessageView struct {
	Id             int    `json:"id"`
	TicketId       int    `json:"ticket_id"`
	Kind           string `json:"kind"`
	ActorRole      string `json:"actor_role"`
	AuthorUserId   int    `json:"author_user_id"`
	AuthorUsername string `json:"author_username"`
	Content        string `json:"content"`
	EventType      string `json:"event_type"`
	FromStatus     string `json:"from_status"`
	ToStatus       string `json:"to_status"`
	NotifyTarget   string `json:"notify_target"`
	CreatedAt      int64  `json:"created_at"`
}

type DetailData struct {
	Ticket  any           `json:"ticket"`
	Replies []MessageView `json:"replies"`
	Total   int           `json:"total"`
	HasMore bool          `json:"has_more"`
}

// AdminListData is the common.PageInfo shape plus an optional search notice.
type AdminListData struct {
	Page         int               `json:"page"`
	PageSize     int               `json:"page_size"`
	Total        int               `json:"total"`
	Items        []TicketAdminView `json:"items"`
	SearchNotice string            `json:"search_notice,omitempty"`
}

// ---------------------------------------------------------------------------
// Ownership lookup (the single mandatory entry point, §5.4)
// ---------------------------------------------------------------------------

// GetTicketForViewer pushes the ownership predicate down into SQL for
// non-administrators. Not-found and not-owned are intentionally identical.
func GetTicketForViewer(tx *gorm.DB, ticketID, viewerID, viewerRole int) (*model.Ticket, error) {
	q := tx.Model(&model.Ticket{}).Where("id = ?", ticketID)
	if !isAdminRole(viewerRole) {
		q = q.Where("user_id = ?", viewerID)
	}
	var t model.Ticket
	if err := q.First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ticketErr(CodeNotFound)
		}
		return nil, ticketErr(CodeDbError)
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// Bounded CAS retry
// ---------------------------------------------------------------------------

var errTicketWriteConflict = errors.New("ticket write conflict")

// WithTicketWriteRetry runs fn up to 1 + ticketWriteRetryLimit times. Only a
// conflict triggers a retry; every business error is returned immediately.
// Exhausted conflicts surface as ticket.not_found (§7.5) so that existence is
// never leaked and the frontend can treat it as a safe "not available".
func WithTicketWriteRetry(fn func() error) error {
	for attempt := 0; attempt <= ticketWriteRetryLimit; attempt++ {
		err := fn()
		if err == nil {
			return nil
		}
		if !errors.Is(err, errTicketWriteConflict) {
			return err
		}
	}
	return ticketErr(CodeNotFound)
}

// ---------------------------------------------------------------------------
// Write plan and stream row constructors
// ---------------------------------------------------------------------------

type writePlan struct {
	rows          []model.TicketMessage
	newStatus     string
	actorRole     string
	viewerRole    int
	dedupe        bool
	dedupeContent string
	dedupeActor   int
}

func newMessageRow(t *model.Ticket, now int64, actorRole string, actorID int,
	username, content, notifyTarget string) model.TicketMessage {
	return model.TicketMessage{
		TicketId:       t.Id,
		Kind:           model.TicketKindMessage,
		ActorRole:      actorRole,
		AuthorUserId:   actorID,
		AuthorUsername: username,
		Content:        content,
		EventType:      "",
		FromStatus:     "",
		ToStatus:       "",
		NotifyTarget:   notifyTarget,
		CreatedAt:      now,
	}
}

// newEventRow always writes content="" (never NULL) and keeps the status change
// in the structured event_type / from_status / to_status columns. actor_role is
// the ACTUAL triggering party, never "system".
func newEventRow(t *model.Ticket, now int64, actorRole string, actorID int,
	username, from, to, notifyTarget string) model.TicketMessage {
	return model.TicketMessage{
		TicketId:       t.Id,
		Kind:           model.TicketKindEvent,
		ActorRole:      actorRole,
		AuthorUserId:   actorID,
		AuthorUsername: username,
		Content:        "",
		EventType:      model.TicketEventTypeStatusChanged,
		FromStatus:     from,
		ToStatus:       to,
		NotifyTarget:   notifyTarget,
		CreatedAt:      now,
	}
}

// FindDuplicateMessage performs an exact (no normalisation) match on the raw
// content within the trailing 60 seconds for the same author and ticket.
func FindDuplicateMessage(tx *gorm.DB, ticketID, actorID int, content string, now int64) (bool, error) {
	var n int64
	err := tx.Model(&model.TicketMessage{}).
		Where("ticket_id = ? AND author_user_id = ? AND kind = ? AND content = ? AND created_at >= ?",
			ticketID, actorID, model.TicketKindMessage, content, now-ticketDuplicateWindow).
		Count(&n).Error
	if err != nil {
		return false, ticketErr(CodeDbError)
	}
	return n > 0, nil
}

// aggregateWatermarks folds all inserted rows into ONE Updates(map) call.
// notify_target='none' moves neither notify column; the acting side's read
// watermark always advances to the newest stream id.
func aggregateWatermarks(tx *gorm.DB, t *model.Ticket, plan *writePlan,
	rows []model.TicketMessage, now int64) (int, error) {
	lastId := rows[len(rows)-1].Id
	updates := map[string]interface{}{
		"message_count":   gorm.Expr("message_count + ?", len(rows)),
		"last_message_id": lastId,
		"last_message_at": now,
		"status":          plan.newStatus,
		"updated_at":      now,
	}
	maxUserNotify, maxAdminNotify := 0, 0
	for _, r := range rows {
		switch r.NotifyTarget {
		case model.TicketNotifyTargetUser:
			maxUserNotify = r.Id
		case model.TicketNotifyTargetAdmin:
			maxAdminNotify = r.Id
		}
	}
	if maxUserNotify > 0 {
		updates["last_user_notify_id"] = maxUserNotify
	}
	if maxAdminNotify > 0 {
		updates["last_admin_notify_id"] = maxAdminNotify
	}
	switch plan.actorRole {
	case model.TicketActorUser:
		updates["user_last_read_id"] = lastId
	case model.TicketActorAdmin:
		updates["admin_last_read_id"] = lastId
	}

	q := tx.Model(&model.Ticket{}).
		Where("id = ? AND last_message_id < ?", t.Id, lastId)
	if !isAdminRole(plan.viewerRole) {
		q = q.Where("user_id = ?", t.UserId)
	}
	res := q.Updates(updates)
	if res.Error != nil {
		return 0, ticketErr(CodeDbError)
	}
	if res.RowsAffected == 0 {
		return 0, errTicketWriteConflict
	}
	return lastId, nil
}

// executeTicketWrite is the shared write skeleton:
//  1. read the baseline with ownership pushed down into SQL;
//  2. derive a monotonic `now` (one GetTimestamp call for the whole tx);
//  3. build the plan (state machine validation, possibly a zero-write no-op);
//  4. CAS conditional UPDATE as the FIRST WRITE statement of the transaction;
//  5. re-read ownership inside the transaction (defence in depth);
//  6. 60s content dedupe;
//  7. insert event-first / message-last stream rows;
//  8. fold every watermark into a single guarded Updates(map).
//
// The CAS predicate (status = baseline AND last_message_id = baseline) is the
// only concurrency gate: SQLite's lockForUpdate is a no-op, so no pessimistic
// row lock is used anywhere. `now` is forced strictly greater than the baseline
// updated_at so the CAS UPDATE always changes a row on MySQL even when the DSN
// does not set clientFoundRows (otherwise an unchanged SET value would be
// reported as RowsAffected=0 and be mistaken for a conflict).
func executeTicketWrite(ticketID, viewerID, viewerRole int,
	build func(t *model.Ticket, now int64) (*writePlan, error)) (*WriteResultView, error) {

	var result *WriteResultView
	err := WithTicketWriteRetry(func() error {
		return model.DB.Transaction(func(tx *gorm.DB) error {
			t, err := GetTicketForViewer(tx, ticketID, viewerID, viewerRole)
			if err != nil {
				return err
			}

			now := common.GetTimestamp()
			if now <= t.UpdatedAt {
				now = t.UpdatedAt + 1
			}

			plan, err := build(t, now)
			if err != nil {
				return err
			}
			if plan == nil || len(plan.rows) == 0 {
				// Same-state no-op: zero rows, zero watermark movement, and
				// updated_at is NOT touched.
				result = &WriteResultView{
					Changed:       false,
					Status:        t.Status,
					MessageCount:  t.MessageCount,
					LastMessageId: t.LastMessageId,
				}
				return nil
			}
			plan.viewerRole = viewerRole

			cas := tx.Model(&model.Ticket{}).
				Where("id = ? AND status = ? AND last_message_id = ?",
					ticketID, t.Status, t.LastMessageId)
			if !isAdminRole(viewerRole) {
				cas = cas.Where("user_id = ?", viewerID)
			}
			casRes := cas.Updates(map[string]interface{}{"updated_at": now})
			if casRes.Error != nil {
				return ticketErr(CodeDbError)
			}
			if casRes.RowsAffected == 0 {
				return errTicketWriteConflict
			}

			// CAS guarantees status / last_message_id did not move, so the plan
			// built from the baseline is still valid. This second read keeps the
			// ownership predicate inside the same transaction.
			if _, err = GetTicketForViewer(tx, ticketID, viewerID, viewerRole); err != nil {
				return err
			}

			if plan.dedupe {
				dup, derr := FindDuplicateMessage(tx, ticketID, plan.dedupeActor,
					plan.dedupeContent, now)
				if derr != nil {
					return derr
				}
				if dup {
					return ticketErr(CodeDuplicate)
				}
			}

			rows := plan.rows
			for i := range rows {
				if err = tx.Create(&rows[i]).Error; err != nil {
					return ticketErr(CodeDbError)
				}
			}
			lastId, err := aggregateWatermarks(tx, t, plan, rows, now)
			if err != nil {
				return err
			}

			result = &WriteResultView{
				Changed:       true,
				Status:        plan.newStatus,
				MessageCount:  t.MessageCount + len(rows),
				LastMessageId: lastId,
			}
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// U1: create ticket
// ---------------------------------------------------------------------------

// CreateTicket inserts the ticket and its first message row in one transaction.
// The CreateView MUST carry the new ticket id (frontend opens the detail panel
// from data.id); it must NOT echo title or content.
func CreateTicket(viewerID int, viewerUsername, title, content string) (*CreateView, error) {
	if err := ValidateTicketTitle(title); err != nil {
		return nil, err
	}
	if err := ValidateTicketContent(content); err != nil {
		return nil, err
	}

	var out *CreateView
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		now := common.GetTimestamp()
		t := model.Ticket{
			UserId:            viewerID,
			Title:             title,
			Status:            model.TicketStatusPending,
			MessageCount:      0,
			LastMessageId:     0,
			LastMessageAt:     now,
			LastUserNotifyId:  0,
			LastAdminNotifyId: 0,
			UserLastReadId:    0,
			AdminLastReadId:   0,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := tx.Create(&t).Error; err != nil {
			return ticketErr(CodeDbError)
		}

		row := newMessageRow(&t, now, model.TicketActorUser, viewerID,
			viewerUsername, content, model.TicketNotifyTargetAdmin)
		if err := tx.Create(&row).Error; err != nil {
			return ticketErr(CodeDbError)
		}

		res := tx.Model(&model.Ticket{}).
			Where("id = ? AND last_message_id < ?", t.Id, row.Id).
			Updates(map[string]interface{}{
				"message_count":        gorm.Expr("message_count + ?", 1),
				"last_message_id":      row.Id,
				"last_message_at":      now,
				"last_admin_notify_id": row.Id,
				"user_last_read_id":    row.Id,
				"updated_at":           now,
			})
		if res.Error != nil {
			return ticketErr(CodeDbError)
		}
		if res.RowsAffected == 0 {
			return ticketErr(CodeDbError)
		}

		out = &CreateView{
			Id:            t.Id,
			Status:        t.Status,
			MessageCount:  1,
			LastMessageId: row.Id,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// U5: user reply (optionally a compound reopen+reply from closed)
// ---------------------------------------------------------------------------

func AddReply(ticketID, viewerID, viewerRole int, viewerUsername, content string,
	reopen bool) (*WriteResultView, error) {
	if err := ValidateTicketContent(content); err != nil {
		return nil, err
	}
	return executeTicketWrite(ticketID, viewerID, viewerRole,
		func(t *model.Ticket, now int64) (*writePlan, error) {
			plan := &writePlan{
				newStatus:     t.Status,
				actorRole:     model.TicketActorUser,
				dedupe:        true,
				dedupeContent: content,
				dedupeActor:   viewerID,
			}
			if t.Status == model.TicketStatusClosed {
				if !reopen {
					return nil, ticketErr(CodeStatusNotReplyable)
				}
				// S7: event FIRST, then message; both notify the admin so the
				// unread badge counts the ticket once, not twice. A compound
				// reopen does NOT participate in content dedupe.
				plan.newStatus = model.TicketStatusPending
				plan.dedupe = false
				plan.rows = append(plan.rows,
					newEventRow(t, now, model.TicketActorUser, viewerID, viewerUsername,
						model.TicketStatusClosed, model.TicketStatusPending,
						model.TicketNotifyTargetAdmin),
					newMessageRow(t, now, model.TicketActorUser, viewerID, viewerUsername,
						content, model.TicketNotifyTargetAdmin))
				return plan, nil
			}
			// reopen:true outside closed is ignored entirely (no event).
			plan.rows = append(plan.rows,
				newMessageRow(t, now, model.TicketActorUser, viewerID, viewerUsername,
					content, model.TicketNotifyTargetAdmin))
			return plan, nil
		})
}

// ---------------------------------------------------------------------------
// U6: user close / reopen
// ---------------------------------------------------------------------------

func UpdateUserStatus(ticketID, viewerID, viewerRole int, viewerUsername,
	action string) (*WriteResultView, error) {
	if !ValidateActionEnum(action) {
		return nil, ticketErr(CodeInvalidParams)
	}
	return executeTicketWrite(ticketID, viewerID, viewerRole,
		func(t *model.Ticket, now int64) (*writePlan, error) {
			plan := &writePlan{
				newStatus:  t.Status,
				actorRole:  model.TicketActorUser,
				viewerRole: viewerRole,
			}
			switch action {
			case "close":
				if t.Status == model.TicketStatusClosed {
					return nil, nil // same-state no-op
				}
				plan.newStatus = model.TicketStatusClosed
				// S5: notify_target='none' — neither notify column moves, so
				// the admin badge is strictly unchanged. last_message_id /
				// message_count / last_message_at / user_last_read_id /
				// updated_at still advance via the normal aggregation.
				plan.rows = append(plan.rows,
					newEventRow(t, now, model.TicketActorUser, viewerID, viewerUsername,
						t.Status, model.TicketStatusClosed, model.TicketNotifyTargetNone))
			case "reopen":
				if t.Status == model.TicketStatusPending {
					return nil, nil // same-state no-op
				}
				if t.Status == model.TicketStatusProcessing {
					return nil, ticketErr(CodeInvalidTransition)
				}
				plan.newStatus = model.TicketStatusPending
				plan.rows = append(plan.rows,
					newEventRow(t, now, model.TicketActorUser, viewerID, viewerUsername,
						t.Status, model.TicketStatusPending, model.TicketNotifyTargetAdmin))
			}
			return plan, nil
		})
}

// ---------------------------------------------------------------------------
// A4: admin reply, optionally with an explicit status change
// ---------------------------------------------------------------------------

func AdminAddReply(ticketID, adminID int, adminUsername, content,
	overrideStatus string) (*WriteResultView, error) {
	if err := ValidateTicketContent(content); err != nil {
		return nil, err
	}
	if overrideStatus != "" && !ValidateStatusEnum(overrideStatus) {
		// A4 with an illegal status rolls the whole write back.
		return nil, ticketErr(CodeInvalidTransition)
	}
	return executeTicketWrite(ticketID, adminID, common.RoleAdminUser,
		func(t *model.Ticket, now int64) (*writePlan, error) {
			if t.Status == model.TicketStatusClosed {
				return nil, ticketErr(CodeStatusNotReplyable)
			}
			plan := &writePlan{
				newStatus:     t.Status,
				actorRole:     model.TicketActorAdmin,
				dedupe:        true,
				dedupeContent: content,
				dedupeActor:   adminID,
			}
			plan.rows = append(plan.rows,
				newMessageRow(t, now, model.TicketActorAdmin, adminID, adminUsername,
					content, model.TicketNotifyTargetUser))
			if overrideStatus != "" && overrideStatus != t.Status {
				// S3b: event FIRST, message SECOND; both notify the user, so the
				// user badge counts the ticket once, not twice.
				plan.newStatus = overrideStatus
				event := newEventRow(t, now, model.TicketActorAdmin, adminID, adminUsername,
					t.Status, overrideStatus, model.TicketNotifyTargetUser)
				plan.rows = append([]model.TicketMessage{event}, plan.rows...)
			}
			// status == current (or absent): exactly one message, no event.
			return plan, nil
		})
}

// ---------------------------------------------------------------------------
// A5: admin explicit status change
// ---------------------------------------------------------------------------

// AdminUpdateStatus accepts ANY of the four status values from ANY of the four
// states (including -> closed). An illegal status value is the only
// invalid_transition case; a same-value request is a zero-write no-op.
func AdminUpdateStatus(ticketID, adminID int, adminUsername,
	toStatus string) (*WriteResultView, error) {
	if !ValidateStatusEnum(toStatus) {
		return nil, ticketErr(CodeInvalidTransition)
	}
	return executeTicketWrite(ticketID, adminID, common.RoleAdminUser,
		func(t *model.Ticket, now int64) (*writePlan, error) {
			if toStatus == t.Status {
				return nil, nil // same-state no-op
			}
			plan := &writePlan{
				newStatus:  toStatus,
				actorRole:  model.TicketActorAdmin,
				viewerRole: common.RoleAdminUser,
			}
			// S4: even a pure status change rings the user badge; A5 -> closed
			// uses notify_target='user', never 'none'.
			plan.rows = append(plan.rows,
				newEventRow(t, now, model.TicketActorAdmin, adminID, adminUsername,
					t.Status, toStatus, model.TicketNotifyTargetUser))
			return plan, nil
		})
}

// ---------------------------------------------------------------------------
// U7 / A6: per-ticket mark-as-read
// ---------------------------------------------------------------------------

// markRead clears ONLY this ticket's unread on the acting side. Note that
// admin_last_read_id is a row-level column of tickets shared by all admins:
// one A6 clears this ticket's badge for every admin, never all tickets.
//
// SCOPE IS FIXED BY THE ROUTE, NOT BY THE CALLER'S ROLE. adminScope selects
// which read-watermark column, which count formula, which scope label and which
// last_read_id value are used. viewerRole is used ONLY for the ownership
// predicate in GetTicketForViewer (admins may reach any ticket, ordinary users
// only their own). An administrator hitting the user-side U7 therefore still
// moves user_last_read_id and reports scope:"self".
func markRead(ticketID, viewerID, viewerRole int, adminScope bool) (*ReadResultView, error) {
	// Ownership first: an unauthorized / missing ticket produces ZERO writes.
	if _, err := GetTicketForViewer(model.DB, ticketID, viewerID, viewerRole); err != nil {
		return nil, err
	}

	readColumn := "user_last_read_id"
	scope := "self"
	if adminScope {
		readColumn = "admin_last_read_id"
		scope = "global"
	}

	// Column-to-column assignment and comparison; no application-side preread
	// value, so no TOCTOU. updated_at is deliberately untouched.
	q := model.DB.Model(&model.Ticket{}).
		Where("id = ?", ticketID).
		Where(readColumn+" < ?", gorm.Expr("last_message_id"))
	// Redundant ownership predicate, also driven by viewerRole (never scope).
	if !isAdminRole(viewerRole) {
		q = q.Where("user_id = ?", viewerID)
	}
	res := q.Updates(map[string]interface{}{
		readColumn: gorm.Expr("last_message_id"),
	})
	if res.Error != nil {
		return nil, ticketErr(CodeDbError)
	}
	changed := res.RowsAffected > 0

	t, err := GetTicketForViewer(model.DB, ticketID, viewerID, viewerRole)
	if err != nil {
		return nil, err
	}
	lastReadId := t.UserLastReadId
	if adminScope {
		lastReadId = t.AdminLastReadId
	}
	// count MUST come from the same side as scope / readColumn.
	count, err := countUnread(viewerID, adminScope)
	if err != nil {
		return nil, err
	}
	return &ReadResultView{
		Changed:    changed,
		Count:      count,
		LastReadId: lastReadId,
		Scope:      scope,
	}, nil
}

// MarkSelfTicketRead is the U7 entry point (user-side route, scope "self").
func MarkSelfTicketRead(ticketID, viewerID, viewerRole int) (*ReadResultView, error) {
	return markRead(ticketID, viewerID, viewerRole, false)
}

// MarkAdminTicketRead is the A6 entry point (admin-side route, scope "global").
func MarkAdminTicketRead(ticketID, viewerID, viewerRole int) (*ReadResultView, error) {
	return markRead(ticketID, viewerID, viewerRole, true)
}

// ---------------------------------------------------------------------------
// U3 / A2: unread badge counts
// ---------------------------------------------------------------------------

// countUnread counts TICKETS with new activity, not stream rows. The admin
// query is a row-wise two-column comparison over ALL tickets (no user_id
// predicate); it is intentionally not derived from the admin list page.
// adminScope is fixed by the ROUTE. viewerRole is not consulted here at all —
// this function has no per-ticket ownership check.
func countUnread(viewerID int, adminScope bool) (int, error) {
	q := model.DB.Model(&model.Ticket{})
	if adminScope {
		q = q.Where("last_admin_notify_id > ?", gorm.Expr("admin_last_read_id"))
	} else {
		q = q.Where("user_id = ?", viewerID).
			Where("last_user_notify_id > ?", gorm.Expr("user_last_read_id"))
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return 0, ticketErr(CodeDbError)
	}
	return int(n), nil
}

// CountSelfUnread is the U3 entry point. Scope is fixed to "self" here so the
// label can never disagree with the count formula.
func CountSelfUnread(viewerID int) (*UnreadView, error) {
	n, err := countUnread(viewerID, false)
	if err != nil {
		return nil, err
	}
	return &UnreadView{Count: n, Scope: "self"}, nil
}

// CountAdminUnread is the A2 entry point. Scope is fixed to "global".
func CountAdminUnread() (*UnreadView, error) {
	n, err := countUnread(0, true)
	if err != nil {
		return nil, err
	}
	return &UnreadView{Count: n, Scope: "global"}, nil
}

// ---------------------------------------------------------------------------
// U2: my ticket list
// ---------------------------------------------------------------------------

func buildSelfViews(rows []model.Ticket) []TicketSelfView {
	views := make([]TicketSelfView, 0, len(rows))
	for _, r := range rows {
		views = append(views, TicketSelfView{
			Id: r.Id, Title: r.Title, Status: r.Status,
			MessageCount: r.MessageCount, LastMessageId: r.LastMessageId,
			LastMessageAt: r.LastMessageAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		})
	}
	return views
}

func validateOptionalStatus(statusFilter string) error {
	if statusFilter != "" && !ValidateStatusEnum(statusFilter) {
		return ticketErr(CodeInvalidParams)
	}
	return nil
}

func ListMyTickets(viewerID int, pageInfo *common.PageInfo,
	statusFilter string) (*common.PageInfo, error) {
	if err := validateOptionalStatus(statusFilter); err != nil {
		return nil, err
	}

	base := func() *gorm.DB {
		q := model.DB.Model(&model.Ticket{}).Where("user_id = ?", viewerID)
		if statusFilter != "" {
			q = q.Where("status = ?", statusFilter)
		}
		return q
	}

	var total int64
	if err := base().Count(&total).Error; err != nil {
		return nil, ticketErr(CodeDbError)
	}
	var rows []model.Ticket
	err := base().
		Order("last_message_at DESC").Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Find(&rows).Error
	if err != nil {
		return nil, ticketErr(CodeDbError)
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildSelfViews(rows))
	return pageInfo, nil
}

// ---------------------------------------------------------------------------
// A1: admin list + search
// ---------------------------------------------------------------------------

type ticketUserRef struct {
	Id       int
	Username string
}

// ResolveUserIDsByUsername performs the SEARCH-TIME exact username resolution.
// Unscoped() is mandatory: users has a soft-delete DeletedAt column, and a
// deregistered submitter's username must still be resolvable.
// This is a different path from the list-time IN (?) username backfill.
func ResolveUserIDsByUsername(keyword string) ([]int, map[int]string, string, error) {
	var refs []ticketUserRef
	err := model.DB.Unscoped().Model(&model.User{}).
		Select("id, username").Where("username = ?", keyword).
		Find(&refs).Error
	if err != nil {
		return nil, nil, "", ticketErr(CodeDbError)
	}
	ids := make([]int, 0, len(refs))
	prefill := make(map[int]string, len(refs))
	for _, r := range refs {
		ids = append(ids, r.Id)
		prefill[r.Id] = r.Username
	}
	// A1 `search_notice` carries a stable, dot-free i18n KEY rather than a
	// localized sentence. The frontend whitelists and translates these keys;
	// keeping them dot-free is required because i18n/config.ts leaves the
	// default keySeparator '.', which would turn a dotted key into a path.
	notice := ""
	switch {
	case len(ids) == 0:
		notice = "Ticket Search Notice No Username"
	case len(ids) > 1:
		notice = "Ticket Search Notice Multiple Usernames"
	}
	return ids, prefill, notice, nil
}

// BatchFillUsernames fills A1 / A3 view usernames. The search-time prefill is
// reused first; only missing ids trigger ONE additional IN (?) query, so there
// is never a 1+N pattern and the SQL count stays constant w.r.t. page_size.
func BatchFillUsernames(rows []TicketAdminView, prefill map[int]string) error {
	if prefill == nil {
		prefill = map[int]string{}
	}
	missing := make([]int, 0, len(rows))
	seen := map[int]bool{}
	for i := range rows {
		uid := rows[i].UserId
		if _, ok := prefill[uid]; !ok && !seen[uid] {
			seen[uid] = true
			missing = append(missing, uid)
		}
	}
	names := make(map[int]string, len(prefill)+len(missing))
	for k, v := range prefill {
		names[k] = v
	}
	if len(missing) > 0 {
		var refs []ticketUserRef
		if err := model.DB.Unscoped().Model(&model.User{}).
			Select("id, username").Where("id IN ?", missing).
			Find(&refs).Error; err != nil {
			return ticketErr(CodeDbError)
		}
		for _, r := range refs {
			names[r.Id] = r.Username
		}
	}
	for i := range rows {
		rows[i].Username = names[rows[i].UserId]
	}
	return nil
}

func buildAdminViews(rows []model.Ticket) []TicketAdminView {
	views := make([]TicketAdminView, 0, len(rows))
	for _, r := range rows {
		views = append(views, TicketAdminView{
			Id: r.Id, Title: r.Title, Status: r.Status,
			MessageCount: r.MessageCount, LastMessageId: r.LastMessageId,
			LastMessageAt: r.LastMessageAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
			UserId: r.UserId, Username: "",
			LastAdminNotifyId: r.LastAdminNotifyId, AdminLastReadId: r.AdminLastReadId,
		})
	}
	return views
}

// AdminListData is returned directly as `data` (PageInfo shape + optional
// search_notice). searchBy is accepted for forward compatibility but is not
// exposed by the UI and has no effect on the query.
func AdminListTickets(pageInfo *common.PageInfo, keyword, statusFilter,
	searchBy string) (*AdminListData, error) {
	_ = searchBy
	if err := validateOptionalStatus(statusFilter); err != nil {
		return nil, err
	}

	ids := []int(nil)
	prefill := map[int]string{}
	notice := ""
	pattern := ""
	numericID := 0
	hasNumericID := false

	// keyword == "" is EXACTLY "no search": no username resolution, no empty
	// IN (), no degenerating full-table LIKE, byte-identical to omitting it.
	if keyword != "" {
		if utf8.RuneCountInString(keyword) > ticketSearchMaxRunes {
			return nil, ticketErr(CodeInvalidParams)
		}
		var err error
		ids, prefill, notice, err = ResolveUserIDsByUsername(keyword)
		if err != nil {
			return nil, err
		}
		pattern = "%" + EscapeLike(keyword) + "%"
		if n, e := strconv.Atoi(keyword); e == nil && n > 0 {
			numericID, hasNumericID = n, true
		}
	}

	base := func() *gorm.DB {
		q := model.DB.Model(&model.Ticket{})
		if statusFilter != "" {
			q = q.Where("status = ?", statusFilter)
		}
		if keyword == "" {
			return q
		}
		parts := []string{"title LIKE ? ESCAPE '!'"}
		args := []interface{}{pattern}
		if hasNumericID {
			parts = append(parts, "id = ?")
			args = append(args, numericID)
		}
		// Never append an empty IN (?) — it would degenerate into a full scan.
		if len(ids) > 0 {
			parts = append(parts, "user_id IN ?")
			args = append(args, ids)
		}
		return q.Where("("+strings.Join(parts, " OR ")+")", args...)
	}

	empty := func() *AdminListData {
		return &AdminListData{
			Page: pageInfo.GetPage(), PageSize: pageInfo.GetPageSize(),
			Total: 0, Items: []TicketAdminView{}, SearchNotice: notice,
		}
	}

	var total int64
	if err := base().Count(&total).Error; err != nil {
		return nil, ticketErr(CodeDbError)
	}
	if total == 0 {
		return empty(), nil
	}

	var rows []model.Ticket
	err := base().
		Order("last_message_at DESC").Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Find(&rows).Error
	if err != nil {
		return nil, ticketErr(CodeDbError)
	}
	views := buildAdminViews(rows)
	if err = BatchFillUsernames(views, prefill); err != nil {
		return nil, err
	}
	return &AdminListData{
		Page: pageInfo.GetPage(), PageSize: pageInfo.GetPageSize(),
		Total: int(total), Items: views, SearchNotice: notice,
	}, nil
}

// ---------------------------------------------------------------------------
// U4 / A3: detail stream
// ---------------------------------------------------------------------------

// BuildMessageViews maps the 12-field MessageView. adminScope is fixed by the
// ROUTE, never derived from the caller's role: on the user-side U4 the admin
// author identity is scrubbed (field set stays identical, but no admin
// account/username snapshot ever leaks to the user), while A3 keeps it.
func BuildMessageViews(rows []model.TicketMessage, adminScope bool) []MessageView {
	views := make([]MessageView, 0, len(rows))
	for _, r := range rows {
		authorID, authorName := r.AuthorUserId, r.AuthorUsername
		if !adminScope && r.ActorRole == model.TicketActorAdmin {
			authorID, authorName = 0, ""
		}
		views = append(views, MessageView{
			Id: r.Id, TicketId: r.TicketId, Kind: r.Kind, ActorRole: r.ActorRole,
			AuthorUserId: authorID, AuthorUsername: authorName, Content: r.Content,
			EventType: r.EventType, FromStatus: r.FromStatus, ToStatus: r.ToStatus,
			NotifyTarget: r.NotifyTarget, CreatedAt: r.CreatedAt,
		})
	}
	return views
}

// loadDetail deliberately ignores every pagination parameter: it fetches the
// MOST RECENT 200 rows (event rows included) and reverses them in Go into
// created_at ASC, id ASC order. total is tickets.message_count.
//
// adminScope is fixed by the ROUTE: it alone chooses TicketAdminView vs
// TicketSelfView and whether admin author snapshots are scrubbed. viewerRole is
// used ONLY by GetTicketForViewer for the ownership predicate. An administrator
// hitting the user-side U4 must still receive TicketSelfView with no admin_*
// watermark columns and scrubbed admin authors.
func loadDetail(ticketID, viewerID, viewerRole int, adminScope bool) (*DetailData, error) {
	t, err := GetTicketForViewer(model.DB, ticketID, viewerID, viewerRole)
	if err != nil {
		return nil, err
	}

	var rows []model.TicketMessage
	err = model.DB.Model(&model.TicketMessage{}).
		Where("ticket_id = ?", ticketID).
		Order("created_at DESC").Order("id DESC").
		Limit(ticketDetailStreamLimit).
		Find(&rows).Error
	if err != nil {
		return nil, ticketErr(CodeDbError)
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}

	var ticketView any
	if adminScope {
		v := TicketAdminView{
			Id: t.Id, Title: t.Title, Status: t.Status,
			MessageCount: t.MessageCount, LastMessageId: t.LastMessageId,
			LastMessageAt: t.LastMessageAt, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
			UserId: t.UserId, Username: "",
			LastAdminNotifyId: t.LastAdminNotifyId, AdminLastReadId: t.AdminLastReadId,
		}
		var refs []ticketUserRef
		if e := model.DB.Unscoped().Model(&model.User{}).
			Select("id, username").Where("id = ?", t.UserId).
			Find(&refs).Error; e != nil {
			return nil, ticketErr(CodeDbError)
		}
		if len(refs) > 0 {
			v.Username = refs[0].Username
		}
		ticketView = v
	} else {
		ticketView = TicketSelfView{
			Id: t.Id, Title: t.Title, Status: t.Status,
			MessageCount: t.MessageCount, LastMessageId: t.LastMessageId,
			LastMessageAt: t.LastMessageAt, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
		}
	}

	return &DetailData{
		Ticket:  ticketView,
		Replies: BuildMessageViews(rows, adminScope),
		Total:   t.MessageCount,
		HasMore: t.MessageCount > ticketDetailStreamLimit,
	}, nil
}

// LoadSelfTicketDetail is the U4 entry point (TicketSelfView + scrubbed authors).
func LoadSelfTicketDetail(ticketID, viewerID, viewerRole int) (*DetailData, error) {
	return loadDetail(ticketID, viewerID, viewerRole, false)
}

// LoadAdminTicketDetail is the A3 entry point (TicketAdminView + real authors).
func LoadAdminTicketDetail(ticketID, viewerID, viewerRole int) (*DetailData, error) {
	return loadDetail(ticketID, viewerID, viewerRole, true)
}
