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

// RunPelicanTestsNow starts an admin-triggered probe task and returns
// immediately with 202 + a task snapshot. The task runs in the background with
// bounded concurrency; poll GET /admin/run/status for progress. Each result is
// stored as pending until an admin publishes it.
//
// Request body: {"targets": [{"group":"Gpt Pro","model":"gpt-6.1-sol"}, ...]}.
// The legacy {"groups": [...]} form is still accepted (default probe model).
// A malformed JSON body or an empty target list is a 400 — it must never
// silently trigger the slow default probe run.
func RunPelicanTestsNow(c *gin.Context) {
	var req struct {
		Targets []service.ProbeTarget `json:"targets"`
		Groups  []string              `json:"groups"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid request body",
		})
		return
	}

	targets := req.Targets
	if len(targets) == 0 && len(req.Groups) > 0 {
		targets = make([]service.ProbeTarget, 0, len(req.Groups))
		for _, group := range req.Groups {
			targets = append(targets, service.ProbeTarget{Group: group})
		}
	}
	if len(targets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "no probe targets selected",
		})
		return
	}

	status, started := service.StartPelicanProbes(targets...)
	if !started {
		c.JSON(http.StatusConflict, gin.H{
			"success":    false,
			"message":    "a model degradation probe is already running",
			"retry_after": 30,
			"data":       status,
		})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"success": true,
		"message": "probe task started",
		"data":    status,
	})
}

// GetPelicanProbeRunStatus returns the current probe task status so the admin
// UI can show progress instead of blindly retrying on a timeout.
func GetPelicanProbeRunStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    service.GetPelicanProbeTaskStatus(),
	})
}

// ListPelicanTestsForAdmin returns recent results for every group that has an
// enabled channel (dynamic, not the hardcoded defaults), including pending
// (unreviewed) ones, so an admin can review raw SVG before publishing. Groups
// with historical results but no enabled channel are included as well.
func ListPelicanTestsForAdmin(c *gin.Context) {
	groupInfos, err := model.GetProbeGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	groups := make([]string, 0, len(groupInfos))
	for _, info := range groupInfos {
		groups = append(groups, info.Group)
	}
	extra, err := model.GetPelicanTestGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	seen := make(map[string]bool, len(groups))
	for _, g := range groups {
		seen[g] = true
	}
	for _, g := range extra {
		if !seen[g] {
			groups = append(groups, g)
		}
	}

	rows, err := model.GetAdminReviewablePelicanTests(groups, pelicanTestsPerGroup, 500)
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
	ok, err := model.PublishPelicanTest(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "only a pending, successful result can be published",
		})
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
	ok, err := model.DeletePelicanTest(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "only a pending result can be discarded",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
