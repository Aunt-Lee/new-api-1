package model

import "time"

const (
	PelicanTestStatusSuccess = "success"
	PelicanTestStatusInvalid = "invalid"
)

// PelicanTest stores one "pelican riding a bicycle" probe result for a group.
// The raw SVG is kept so the public page can show the untouched model output.
type PelicanTest struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	Group      string `json:"group" gorm:"column:group;size:64;index:idx_pelican_group_created,priority:1"`
	ModelName  string `json:"model_name" gorm:"size:128"`
	Content    string `json:"content" gorm:"type:text"`
	Status     string `json:"status" gorm:"size:16"`
	FailReason string `json:"fail_reason" gorm:"size:255"`
	CreatedAt  int64  `json:"created_at" gorm:"index:idx_pelican_group_created,priority:2"`
}

func (PelicanTest) TableName() string {
	return "pelican_tests"
}

func InsertPelicanTest(record *PelicanTest) error {
	if record == nil {
		return nil
	}
	if record.CreatedAt == 0 {
		record.CreatedAt = time.Now().Unix()
	}
	return DB.Create(record).Error
}

// GetLatestPelicanTests returns the newest result for each group.
// Per-group deduplication is done in application code instead of a window
// function so the query behaves identically on SQLite, MySQL 5.7 and PostgreSQL.
func GetLatestPelicanTests() ([]PelicanTest, error) {
	var rows []PelicanTest
	err := DB.Model(&PelicanTest{}).
		Order("created_at DESC").
		Order("id DESC").
		Limit(500).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(rows))
	result := make([]PelicanTest, 0, len(rows))
	for _, row := range rows {
		if _, ok := seen[row.Group]; ok {
			continue
		}
		seen[row.Group] = struct{}{}
		result = append(result, row)
	}
	return result, nil
}

// GetLatestSuccessfulPelicanTestTime returns the timestamp of the most recent
// *successful* probe run across all groups. Failed runs are deliberately
// excluded: a failed run must not push the next attempt 18 hours away.
func GetLatestSuccessfulPelicanTestTime() (int64, error) {
	var latest int64
	err := DB.Model(&PelicanTest{}).
		Where("status = ?", PelicanTestStatusSuccess).
		Select("COALESCE(MAX(created_at), 0)").
		Scan(&latest).Error
	return latest, err
}

func DeletePelicanTestsBefore(cutoffTs int64) error {
	if cutoffTs <= 0 {
		return nil
	}
	return DB.Where("created_at < ?", cutoffTs).Delete(&PelicanTest{}).Error
}
