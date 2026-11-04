package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// pelicanTestView is the public shape of a probe result. Internal failure
// details (which may contain upstream/channel information) are intentionally
// left out; the frontend only needs to know whether the last run succeeded.
type pelicanTestView struct {
	Group     string `json:"group"`
	ModelName string `json:"model_name"`
	Content   string `json:"content,omitempty"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"created_at"`
}

const pelicanTestsPerGroup = 4

// GetPelicanTests returns recent probe results for each group (newest first).
func GetPelicanTests(c *gin.Context) {
	rows, err := model.GetLatestPelicanTests(service.PelicanProbeGroups(), pelicanTestsPerGroup)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	views := make([]pelicanTestView, 0, len(rows))
	for _, row := range rows {
		views = append(views, pelicanTestView{
			Group:     row.Group,
			ModelName: row.ModelName,
			Content:   row.Content,
			Status:    row.Status,
			CreatedAt: row.CreatedAt,
		})
	}

	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    views,
	})
}

// RunPelicanTestsNow lets an administrator trigger a probe immediately (e.g.
// right after deployment) without waiting for the randomized schedule.
// It resets the schedule because a fresh successful row becomes the new anchor.
func RunPelicanTestsNow(c *gin.Context) {
	results := service.RunPelicanProbes(c.Request.Context())
	if results == nil {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "a pelican probe is already running",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    results,
	})
}
