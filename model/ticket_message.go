package model

// Stream entry kinds. message and event share ONE table and ONE auto-increment
// id sequence (contract §4.2). A kind='event' row is the system event; there
// is no separate actor identity for it.
const (
	TicketKindMessage = "message"
	TicketKindEvent   = "event"
)

// Actor roles. actor_role stores the ACTUAL triggering party. "system" is a
// reserved enumeration value kept for forward compatibility but is NEVER
// written during the MVP (contract §4.2 / §5.3).
const (
	TicketActorUser   = "user"
	TicketActorAdmin  = "admin"
	TicketActorSystem = "system"
)

// event_type values (MVP has exactly one).
const (
	TicketEventTypeStatusChanged = "status_changed"
)

// notify_target drives which notify watermark column a stream row advances.
// 'none' is used ONLY by the user-close action (U6 action=close): neither
// notify column moves, so the administrator unread badge is unchanged.
const (
	TicketNotifyTargetUser  = "user"
	TicketNotifyTargetAdmin = "admin"
	TicketNotifyTargetNone  = "none"
)

// TicketMessage is an append-only stream row. It has no updated_at / deleted_at.
// content keeps the naked `type:text` tag (with no DEFAULT clause — MySQL
// < 8.0.13 forbids a DEFAULT on TEXT/BLOB). For kind='event' the service writes an
// explicit empty string "" (never NULL), with status info carried by the
// structured event_type / from_status / to_status columns (no JSON, no prose).
type TicketMessage struct {
	Id             int    `json:"id" gorm:"primaryKey;index:idx_message_ticket,priority:2"`
	TicketId       int    `json:"ticket_id" gorm:"index:idx_message_ticket,priority:1"`
	Kind           string `json:"kind" gorm:"type:varchar(16)"`
	ActorRole      string `json:"actor_role" gorm:"type:varchar(16)"`
	AuthorUserId   int    `json:"author_user_id"`
	AuthorUsername string `json:"author_username" gorm:"type:varchar(64)"`
	Content        string `json:"content" gorm:"type:text"`
	EventType      string `json:"event_type" gorm:"type:varchar(32)"`
	FromStatus     string `json:"from_status" gorm:"type:varchar(16)"`
	ToStatus       string `json:"to_status" gorm:"type:varchar(16)"`
	NotifyTarget   string `json:"notify_target" gorm:"type:varchar(16)"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime:false"`
}

func (TicketMessage) TableName() string {
	return "ticket_messages"
}
