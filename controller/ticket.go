package controller

// Ticket HTTP boundary (contract v3.1, docs/ticket-system-delivery-plan.md §7).
//
// This file never imports the data layer and never touches the database.
// Request DTOs are declared locally so unknown fields (e.g. a forged user_id)
// are silently ignored by Gin binding. Viewer identity comes ONLY from the
// authentication middleware context.

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

// ticketFail mirrors common.ApiErrorI18n (which is frozen and has no `code`)
// and appends the machine code. Crucially it emits NO `data` key at all: for
// not-found / unauthorized responses the `data` key set must be completely
// empty (not even total:0 / has_more:false), so existence is never leaked and
// the frontend's `body.data === undefined` branch resolves to not_found.
func ticketFail(c *gin.Context, code string, messageKey string) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": common.TranslateMessage(c, messageKey),
		"code":    code,
	})
}

// ticketMessageKey maps each business code onto an ALREADY EXISTING generic
// i18n key. No YAML key is added for the ticket system.
func ticketMessageKey(code string) string {
	switch code {
	case service.CodeInvalidParams:
		return i18n.MsgInvalidParams
	case service.CodeTitleEmpty, service.CodeContentEmpty,
		service.CodeTitleTooLong, service.CodeContentTooLong:
		return i18n.MsgInvalidInput
	case service.CodeNotFound:
		return i18n.MsgNotFound
	case service.CodeStatusNotReplyable, service.CodeInvalidTransition:
		return i18n.MsgOperationFailed
	case service.CodeDuplicate:
		return i18n.MsgAlreadyExists
	case service.CodeRateLimited:
		return i18n.MsgRateLimitReached
	case service.CodeDbError:
		return i18n.MsgDatabaseError
	}
	return i18n.MsgOperationFailed
}

func failTicketError(c *gin.Context, err error) {
	var te *service.TicketError
	if errors.As(err, &te) {
		ticketFail(c, te.Code, ticketMessageKey(te.Code))
		return
	}
	ticketFail(c, service.CodeDbError, i18n.MsgDatabaseError)
}

func parseTicketID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return 0, false
	}
	return id, true
}

// ---------------------------------------------------------------------------
// Local request DTOs (controller-owned; no model structs are ever bound)
// ---------------------------------------------------------------------------

type createTicketReq struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

type replyTicketReq struct {
	Content string `json:"content"`
	Reopen  bool   `json:"reopen"`
}

// userStatusReq deliberately declares status so we can reject U6 receiving one
// of the four status values with ticket.invalid_params (§7.5).
type userStatusReq struct {
	Action string `json:"action"`
	Status string `json:"status"`
}

type adminReplyTicketReq struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

type adminStatusTicketReq struct {
	Status string `json:"status"`
}

// ---------------------------------------------------------------------------
// U1: POST /api/ticket/
// ---------------------------------------------------------------------------

func CreateTicket(c *gin.Context) {
	var req createTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	// First validation pass (the service performs the second one).
	if err := service.ValidateTicketTitle(req.Title); err != nil {
		failTicketError(c, err)
		return
	}
	if err := service.ValidateTicketContent(req.Content); err != nil {
		failTicketError(c, err)
		return
	}
	view, err := service.CreateTicket(c.GetInt("id"), c.GetString("username"),
		req.Title, req.Content)
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// U2: GET /api/ticket/
// ---------------------------------------------------------------------------

func GetTicketList(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	data, err := service.ListMyTickets(c.GetInt("id"), pageInfo, c.Query("status"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

// ---------------------------------------------------------------------------
// U3: GET /api/ticket/unread-count
// ---------------------------------------------------------------------------

func GetTicketUnreadCount(c *gin.Context) {
	// U3 is the user-side route: scope is fixed to "self" by the service entry
	// point, independent of the caller's role (an admin may hit this route too).
	view, err := service.CountSelfUnread(c.GetInt("id"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// U4: GET /api/ticket/item/:id
// ---------------------------------------------------------------------------

func GetTicketDetail(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	// U4 is the user-side route: TicketSelfView + scrubbed admin authors,
	// regardless of the caller's role. viewerRole is used only for ownership.
	data, err := service.LoadSelfTicketDetail(id, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

// ---------------------------------------------------------------------------
// U5: POST /api/ticket/item/:id/reply
// ---------------------------------------------------------------------------

func ReplyTicket(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	var req replyTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	if err := service.ValidateTicketContent(req.Content); err != nil {
		failTicketError(c, err)
		return
	}
	view, err := service.AddReply(id, c.GetInt("id"), c.GetInt("role"),
		c.GetString("username"), req.Content, req.Reopen)
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// U6: PUT /api/ticket/item/:id/status
// ---------------------------------------------------------------------------

func UpdateTicketStatus(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	var req userStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	// U6 accepts action=close|reopen ONLY; a status value is invalid_params.
	if req.Status != "" {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	view, err := service.UpdateUserStatus(id, c.GetInt("id"), c.GetInt("role"),
		c.GetString("username"), req.Action)
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// U7: POST /api/ticket/item/:id/read
// ---------------------------------------------------------------------------

func MarkTicketRead(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	// U7 is the user-side route: moves user_last_read_id, counts the self-side
	// badge and returns scope:"self", regardless of the caller's role.
	view, err := service.MarkSelfTicketRead(id, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// A1: GET /api/ticket/admin/
// ---------------------------------------------------------------------------

func GetAdminTicketList(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	data, err := service.AdminListTickets(pageInfo, c.Query("keyword"),
		c.Query("status"), c.Query("search_by"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

// ---------------------------------------------------------------------------
// A2: GET /api/ticket/admin/unread-count
// ---------------------------------------------------------------------------

func GetAdminTicketUnreadCount(c *gin.Context) {
	// A2 is the admin-side route: scope is fixed to "global" by the service
	// entry point, independent of the caller's role.
	view, err := service.CountAdminUnread()
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// A3: GET /api/ticket/admin/item/:id
// ---------------------------------------------------------------------------

func GetAdminTicketDetail(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	// A3 is the admin-side route: TicketAdminView + real author snapshots and
	// submitter username backfill, regardless of the caller's role.
	data, err := service.LoadAdminTicketDetail(id, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

// ---------------------------------------------------------------------------
// A4: POST /api/ticket/admin/item/:id/reply
// ---------------------------------------------------------------------------

func AdminReplyTicket(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	var req adminReplyTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	if err := service.ValidateTicketContent(req.Content); err != nil {
		failTicketError(c, err)
		return
	}
	view, err := service.AdminAddReply(id, c.GetInt("id"), c.GetString("username"),
		req.Content, req.Status)
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// A5: PUT /api/ticket/admin/item/:id/status
// ---------------------------------------------------------------------------

func AdminUpdateTicketStatus(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	var req adminStatusTicketReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ticketFail(c, service.CodeInvalidParams, i18n.MsgInvalidParams)
		return
	}
	view, err := service.AdminUpdateStatus(id, c.GetInt("id"),
		c.GetString("username"), req.Status)
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ---------------------------------------------------------------------------
// A6: POST /api/ticket/admin/item/:id/read
// ---------------------------------------------------------------------------

func AdminMarkTicketRead(c *gin.Context) {
	id, ok := parseTicketID(c)
	if !ok {
		return
	}
	// A6 is the admin-side route: moves admin_last_read_id, counts the global
	// badge and returns scope:"global", regardless of the caller's role.
	view, err := service.MarkAdminTicketRead(id, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		failTicketError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}
