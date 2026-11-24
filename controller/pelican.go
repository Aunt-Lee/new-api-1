package controller

import (
	"net/http"
	"strconv"

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

// adminPelicanTestView is the admin shape: it additionally exposes the record
// id (for publish/discard actions), fail reason and review state.
type adminPelicanTestView struct {
	Id         int    `json:"id"`
	Group      string `json:"group"`
	ModelName  string `json:"model_name"`
	Content    string `json:"content,omitempty"`
	Status     string `json:"status"`
	FailReason string `json:"fail_reason,omitempty"`
	Pending    bool   `json:"pending"`
	CreatedAt  int64  `json:"created_at"`
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

// GetProbeGroups returns the groups that currently have enabled channels, so
// the admin page can render a dynamic, refreshable selection list instead of
// a hardcoded set of groups.
func GetProbeGroups(c *gin.Context) {
	groups, err := model.GetProbeGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	if groups == nil {
		groups = make([]model.ProbeGroupInfo, 0)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": groups})
}

// RunPelicanTestsNow lets an administrator trigger a probe for the selected
// groups. The request body may contain {"groups": ["Gpt Pro", ...]}; when
// omitted, the configured default groups are used. Each run creates pending
// results that must be reviewed before appearing on the public page.
func RunPelicanTestsNow(c *gin.Context) {
	var req struct {
		Groups []string `json:"groups"`
	}
	// Body is optional: an empty body must not be treated as a bad request.
	_ = c.ShouldBindJSON(&req)

	results := service.RunPelicanProbes(c.Request.Context(), req.Groups...)
	if results == nil {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "a model degradation probe is already running",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    results,
	})
}

// ListPelicanTestsForAdmin returns recent results for every group, including
// pending (unreviewed) ones, so an admin can review raw SVG before publishing.
func ListPelicanTestsForAdmin(c *gin.Context) {
	rows, err := model.GetLatestPelicanTestsForAdmin(service.PelicanProbeGroups(), pelicanTestsPerGroup)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	views := make([]adminPelicanTestView, 0, len(rows))
	for _, row := range rows {
		views = append(views, adminPelicanTestView{
			Id:         row.Id,
			Group:      row.Group,
			ModelName:  row.ModelName,
			Content:    row.Content,
			Status:     row.Status,
			FailReason: row.FailReason,
			Pending:    row.Pending,
			CreatedAt:  row.CreatedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

// PublishPelicanTest marks a pending result as published so it appears on the
// public pricing page.
func PublishPelicanTest(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.PublishPelicanTest(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DiscardPelicanTest permanently removes a pending result the admin rejects.
func DiscardPelicanTest(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DeletePelicanTest(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
