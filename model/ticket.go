package model

// Ticket status enumeration (four states). Status only changes via explicit
// actions; there is no automatic transition on reply (contract v3.1 §5.1).
const (
	TicketStatusPending    = "pending"
	TicketStatusProcessing = "processing"
	TicketStatusResolved   = "resolved"
	TicketStatusClosed     = "closed"
)

// Ticket is the aggregate root of a support conversation.
//
// All four watermark columns (last_user_notify_id / last_admin_notify_id /
// user_last_read_id / admin_last_read_id) are ROW-LEVEL fields of the tickets
// table: each ticket owns exactly one set. admin_last_read_id is shared by all
// administrators for this ticket; it is NOT a system-wide single value and is
// NOT partitioned per administrator (contract §4.1 / §6.1).
//
// Times are int64 Unix seconds assigned explicitly by the service layer.
// autoCreateTime / autoUpdateTime are disabled on purpose so that Updates(map)
// never implicitly bumps updated_at (GORM 1.25.2 would otherwise treat a
// CreatedAt/UpdatedAt int64 field as an auto timestamp).
//
// id and every watermark/count column share the same Go type (int) and thus the
// same physical column type, so column-to-column comparisons
// (last_admin_notify_id > admin_last_read_id) and column-to-column assignments
// (SET user_last_read_id = last_message_id) never need implicit casts (§3.3).
type Ticket struct {
	Id                int    `json:"id" gorm:"primaryKey"`
	UserId            int    `json:"user_id" gorm:"index:idx_ticket_user_status,priority:1"`
	Title             string `json:"title" gorm:"type:varchar(200)"`
	Status            string `json:"status" gorm:"type:varchar(16);index:idx_ticket_user_status,priority:2;index:idx_ticket_status_activity,priority:1"`
	MessageCount      int    `json:"message_count"`
	LastMessageId     int    `json:"last_message_id"`
	LastMessageAt     int64  `json:"last_message_at" gorm:"index:idx_ticket_user_status,priority:3;index:idx_ticket_status_activity,priority:2"`
	LastUserNotifyId  int    `json:"last_user_notify_id"`
	LastAdminNotifyId int    `json:"last_admin_notify_id"`
	UserLastReadId    int    `json:"user_last_read_id"`
	AdminLastReadId   int    `json:"admin_last_read_id"`
	CreatedAt         int64  `json:"created_at" gorm:"autoCreateTime:false"`
	UpdatedAt         int64  `json:"updated_at" gorm:"autoUpdateTime:false"`
}

func (Ticket) TableName() string {
	return "tickets"
}
