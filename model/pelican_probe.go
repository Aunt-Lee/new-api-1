package model

import "time"

const (
	PelicanTestStatusSuccess = "success"
	PelicanTestStatusInvalid = "invalid"
)

type PelicanTest struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	Group      string `json:"group" gorm:"column:group;size:64;index:idx_pelican_group_created,priority:1"`
	ModelName  string `json:"model_name" gorm:"size:128"`
	Content    string `json:"content" gorm:"type:text"`
	Status     string `json:"status" gorm:"size:16"`
	FailReason string `json:"fail_reason" gorm:"size:255"`
	CreatedAt  int64  `json:"created_at" gorm:"index:idx_pelican_group_created,priority:2"`
}

func (PelicanTest) TableName() string { return "pelican_tests" }

func InsertPelicanTest(record *PelicanTest) error {
	if record == nil {
		return nil
	}
	if record.CreatedAt == 0 {
		record.CreatedAt = time.Now().Unix()
	}
	return DB.Create(record).Error
}

func GetLatestPelicanTests(groups []string, perGroup int) ([]PelicanTest, error) {
	if perGroup <= 0 {
		perGroup = 4
	}
	result := make([]PelicanTest, 0, len(groups)*perGroup)
	for _, group := range groups {
		var rows []PelicanTest
		err := DB.Model(&PelicanTest{}).
			Where(commonGroupCol+" = ?", group).
			Order("created_at DESC").Order("id DESC").Limit(perGroup).Find(&rows).Error
		if err != nil {
			return nil, err
		}
		result = append(result, rows...)
	}
	return result, nil
}

func GetLatestSuccessfulPelicanTestTime() (int64, error) {
	var latest int64
	err := DB.Model(&PelicanTest{}).Where("status = ?", PelicanTestStatusSuccess).
		Select("COALESCE(MAX(created_at), 0)").Scan(&latest).Error
	return latest, err
}

func DeletePelicanTestsBefore(cutoffTs int64) error {
	if cutoffTs <= 0 {
		return nil
	}
	return DB.Where("created_at < ?", cutoffTs).Delete(&PelicanTest{}).Error
}
