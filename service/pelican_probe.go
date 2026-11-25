package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// The model-degradation probe asks each target group to draw an ANIMATED SVG
// of a little crocodile riding a bicycle, then publishes the untouched result
// as visible evidence that the group is really serving the expected model
// quality. The internal "pelican" identifiers are deliberately kept for the
// existing table / endpoint / symbol names; only the subject changed
// (2026-11-09).
const (
	pelicanProbeModel  = "gpt-6.1-sol"
	pelicanProbePrompt = "Create a single ANIMATED SVG of a cute little crocodile riding a bicycle. " +
		"The scene must clearly show: a small green crocodile with a long snout, visible eyes, " +
		"a row of triangular back scutes and a swinging tail, sitting on the saddle and pedaling " +
		"with its little legs, and a bicycle with two round wheels, spokes and a frame. " +
		"It MUST be a looping animation, NOT a still image. Use SMIL elements <animate> and <animateTransform> " +
		"with repeatCount=\"indefinite\": rotate both wheels (with visible spokes), bob or move the bicycle " +
		"slightly, pedal the crocodile's legs back and forth, and swing its tail. " +
		"Use basic SVG shapes such as circle, ellipse, path, line, polygon, rect and text, and include a viewBox. " +
		"Self-contained only: no scripts, no external links or images, no <foreignObject>, no markdown fences. " +
		"Output ONLY the SVG markup, starting with <svg and ending with </svg>. No explanation."

	// Automatic probes are randomized inside [12h, 18h). The lower bound is
	// hard: two automatic runs can never be closer than 12 hours.
	pelicanProbeMinInterval = 12 * time.Hour
	pelicanProbeJitter      = 6 * time.Hour

	pelicanProbeTick          = 15 * time.Minute
	pelicanProbeStartupDelay  = 60 * time.Second
	pelicanProbeRetryCooldown = time.Hour
	pelicanProbeRetention     = 30 * 24 * time.Hour
	pelicanProbeMaxSVG        = 200 << 10
	// A single probe used to allow 3 minutes, so a handful of targets blocked
	// the HTTP handler for many minutes and the browser/gateway timed out
	// (502). Cap both the per-request wait and the whole task budget, and run
	// targets with bounded concurrency.
	pelicanProbeHTTPTimeout  = 75 * time.Second
	pelicanProbeTaskDeadline = 10 * time.Minute
	pelicanProbeMaxConcurrent = 4
)

var (
	pelicanProbeGroups = []string{"Gpt Cheap", "Gpt Pro", "Gpt Plus&Team"}
	pelicanProbeBusy   atomic.Bool
	// Only touched by the scheduler goroutine, so no lock is needed.
	pelicanProbeLastAttempt time.Time
	// A dedicated client keeps the loopback call away from the shared relay
	// client (proxy settings / SSRF dialer would otherwise interfere).
	pelicanProbeHTTPClient = &http.Client{Timeout: pelicanProbeHTTPTimeout}
	pelicanSVGPattern      = regexp.MustCompile(`(?is)<svg\b.*</svg>`)

	// Async task state. probeTaskStateMu guards every field of probeTaskState;
	// the task itself is immutable after creation except through this mutex.
	probeTaskStateMu sync.RWMutex
	probeTaskState   = PelicanProbeTaskStatus{Status: "idle"}
)

// PelicanProbeTaskStatus is the public, JSON-safe snapshot of the current
// admin-triggered probe task. Status is one of idle|running|done.
type PelicanProbeTaskStatus struct {
	TaskID     string `json:"task_id"`
	Status     string `json:"status"`
	Total      int    `json:"total"`
	Completed  int    `json:"completed"`
	Succeeded  int    `json:"succeeded"`
	Failed     int    `json:"failed"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt int64  `json:"finished_at,omitempty"`
}

// GetPelicanProbeTaskStatus returns a snapshot of the current probe task.
func GetPelicanProbeTaskStatus() PelicanProbeTaskStatus {
	probeTaskStateMu.RLock()
	defer probeTaskStateMu.RUnlock()
	return probeTaskState
}

func setProbeTaskState(update func(*PelicanProbeTaskStatus)) {
	probeTaskStateMu.Lock()
	defer probeTaskStateMu.Unlock()
	update(&probeTaskState)
}

// PelicanProbeGroups returns a copy of the groups covered by the probe, so
// the public read endpoint and the scheduler always agree on the group list.
func PelicanProbeGroups() []string {
	groups := make([]string, len(pelicanProbeGroups))
	copy(groups, pelicanProbeGroups)
	return groups
}

// StartPelicanProbeScheduler is intentionally a no-op. Probe runs are now
// admin-triggered only (manual detection + review + publish); automatic
// background runs were removed so nothing reaches the public page without an
// admin's approval. Kept for call-site compatibility.
func StartPelicanProbeScheduler() {
	common.SysLog("pelican probe: automatic scheduler disabled (admin-triggered only)")
}

// startPelicanProbeSchedulerLegacy retains the former loop body for reference
// only; it is not called.
func startPelicanProbeSchedulerLegacy() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		time.Sleep(pelicanProbeStartupDelay)
		for {
			runPelicanSchedulerTick()
			time.Sleep(pelicanProbeTick)
		}
	}()
}

func runPelicanSchedulerTick() {
	lastSuccess, err := model.GetLatestSuccessfulPelicanTestTime()
	if err != nil {
		common.SysError("pelican probe: failed to read last run time: " + err.Error())
		return
	}
	if lastSuccess > 0 && time.Now().Before(nextPelicanProbeTime(lastSuccess)) {
		return
	}
	// A fully failed run does not advance the schedule; back off briefly so a
	// broken upstream does not get hammered every 15 minutes.
	if !pelicanProbeLastAttempt.IsZero() &&
		time.Since(pelicanProbeLastAttempt) < pelicanProbeRetryCooldown {
		return
	}

	pelicanProbeLastAttempt = time.Now()
	RunPelicanProbes(context.Background())

	if err := model.DeletePelicanTestsBefore(
		time.Now().Add(-pelicanProbeRetention).Unix(),
	); err != nil {
		common.SysError("pelican probe: failed to clean old results: " + err.Error())
	}
}

// nextPelicanProbeTime derives the next run time deterministically from the
// last successful run. Deriving it (instead of storing a random value) keeps
// the target stable across restarts, so restarting the process can never be
// used to dodge the 12-hour minimum interval.
func nextPelicanProbeTime(lastSuccessTs int64) time.Time {
	h := fnv.New64a()
	var buf [8]byte
	binary.LittleEndian.PutUint64(buf[:], uint64(lastSuccessTs))
	_, _ = h.Write(buf[:])
	jitter := time.Duration(h.Sum64() % uint64(pelicanProbeJitter))
	return time.Unix(lastSuccessTs, 0).Add(pelicanProbeMinInterval + jitter)
}

// ProbeTarget is one (group, model) pair selected in the admin UI. The group
// decides which channel pool the relay picks from; the model is sent verbatim
// in the request body so every enabled model can be checked independently.
type ProbeTarget struct {
	Group string `json:"group"`
	Model string `json:"model"`
}

// StartPelicanProbes starts an admin-triggered probe task in the background and
// returns immediately, so the HTTP handler never waits for slow upstreams.
// Returns (status, false) when a task is already running.
//
// The task uses its own context with a hard deadline: detaching from the
// request context means a browser/gateway timeout can no longer cancel the
// remaining targets, and the deadline bounds a stuck upstream.
func StartPelicanProbes(targets ...ProbeTarget) (PelicanProbeTaskStatus, bool) {
	if !pelicanProbeBusy.CompareAndSwap(false, true) {
		return GetPelicanProbeTaskStatus(), false
	}

	if len(targets) == 0 {
		targets = make([]ProbeTarget, 0, len(pelicanProbeGroups))
		for _, group := range pelicanProbeGroups {
			targets = append(targets, ProbeTarget{Group: group, Model: pelicanProbeModel})
		}
	}

	taskID := fmt.Sprintf("probe-%d", common.GetTimestamp())
	setProbeTaskState(func(s *PelicanProbeTaskStatus) {
		*s = PelicanProbeTaskStatus{
			TaskID:    taskID,
			Status:    "running",
			Total:     len(targets),
			StartedAt: common.GetTimestamp(),
		}
	})

	go runPelicanProbeTask(targets)
	return GetPelicanProbeTaskStatus(), true
}

// runPelicanProbeTask executes the targets with bounded concurrency. It owns
// the pelicanProbeBusy flag for its whole lifetime and always publishes a
// terminal status, so a client can poll for completion.
func runPelicanProbeTask(targets []ProbeTarget) {
	defer pelicanProbeBusy.Store(false)

	ctx, cancel := context.WithTimeout(context.Background(), pelicanProbeTaskDeadline)
	defer cancel()

	sem := make(chan struct{}, pelicanProbeMaxConcurrent)
	var wg sync.WaitGroup
	for _, target := range targets {
		select {
		case <-ctx.Done():
			// Task budget exhausted; skip the rest instead of creating rows
			// that would all fail with "context canceled".
			common.SysError("pelican probe: task deadline reached, skipping remaining targets")
			break
		case sem <- struct{}{}:
		}
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(t ProbeTarget) {
			defer wg.Done()
			defer func() { <-sem }()
			runOnePelicanProbe(ctx, t)
		}(target)
	}
	wg.Wait()

	setProbeTaskState(func(s *PelicanProbeTaskStatus) {
		if s.TaskID == "" {
			return
		}
		if s.Status == "running" {
			s.Status = "done"
			s.FinishedAt = common.GetTimestamp()
		}
	})
	common.SysLog(fmt.Sprintf("pelican probe: task finished: %+v", GetPelicanProbeTaskStatus()))
}

// runOnePelicanProbe performs a single (group, model) probe and stores the row
// whether it succeeded or failed, then advances the task counters.
func runOnePelicanProbe(ctx context.Context, target ProbeTarget) {
	group := strings.TrimSpace(target.Group)
	modelName := strings.TrimSpace(target.Model)
	if group == "" {
		setProbeTaskState(func(s *PelicanProbeTaskStatus) { s.Failed++; s.Completed++ })
		return
	}
	if modelName == "" {
		modelName = pelicanProbeModel
	}
	record := model.PelicanTest{
		Group:     group,
		ModelName: modelName,
		Status:    model.PelicanTestStatusInvalid,
		Pending:   true,
	}
	svg, err := requestPelicanSVG(ctx, group, modelName)
	if err != nil {
		record.FailReason = clipPelicanReason(err.Error())
		common.SysLog(fmt.Sprintf("pelican probe [%s/%s] failed: %v", group, modelName, err))
	} else {
		record.Content = svg
		record.Status = model.PelicanTestStatusSuccess
	}
	storeErr := model.InsertPelicanTest(&record)
	if storeErr != nil {
		common.SysError(fmt.Sprintf("pelican probe [%s/%s]: failed to store result: %v", group, modelName, storeErr))
	}
	setProbeTaskState(func(s *PelicanProbeTaskStatus) {
		s.Completed++
		if record.Status == model.PelicanTestStatusSuccess && storeErr == nil {
			s.Succeeded++
		} else {
			s.Failed++
		}
	})
}

// RunPelicanProbes is kept for the legacy scheduler call site (which is a
// no-op today). Admin triggers go through StartPelicanProbes instead.
func RunPelicanProbes(ctx context.Context, targets ...ProbeTarget) []model.PelicanTest {
	StartPelicanProbes(targets...)
	return nil
}

// requestPelicanSVG goes through the real relay chain (TokenAuth -> Distribute
// -> Relay -> billing/log) by calling our own /v1/chat/completions endpoint
// with a dedicated token bound to the target group. modelName is the model the
// admin selected; the group on the token still scopes the channel pool.
func requestPelicanSVG(ctx context.Context, group string, modelName string) (string, error) {
	token, err := ensurePelicanProbeToken(group)
	if err != nil {
		return "", err
	}
	if modelName == "" {
		modelName = pelicanProbeModel
	}

	payload, err := common.Marshal(map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "user", "content": pelicanProbePrompt},
		},
		"temperature": 0.7,
		"max_tokens":  4096,
	})
	if err != nil {
		return "", err
	}

	port := os.Getenv("PORT")
	if port == "" {
		if common.Port != nil {
			port = strconv.Itoa(*common.Port)
		} else {
			port = "3000"
		}
	}
	url := fmt.Sprintf("http://127.0.0.1:%s/v1/chat/completions", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer sk-"+token.Key)

	resp, err := pelicanProbeHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("relay returned HTTP %d: %s", resp.StatusCode, clipPelicanReason(string(body)))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := common.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("invalid relay response: %w", err)
	}
	if result.Error != nil {
		return "", errors.New("relay error: " + result.Error.Message)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", errors.New("relay returned an empty completion")
	}
	return extractPelicanSVG(result.Choices[0].Message.Content)
}

// ensurePelicanProbeToken reuses (or lazily creates) an internal token whose
// Group is the probed group. The group on the token is what makes the relay
// pick that group's channel pool (see middleware.TokenAuth).
func ensurePelicanProbeToken(group string) (*model.Token, error) {
	name := "system-pelican-probe:" + group
	var token model.Token
	err := model.DB.Where("name = ?", name).First(&token).Error
	if err == nil {
		return &token, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var root model.User
	if err := model.DB.Where("role = ?", common.RoleRootUser).First(&root).Error; err != nil {
		return nil, fmt.Errorf("root user not found, cannot create probe token: %w", err)
	}
	if !GroupInUserUsableGroups(root.Group, group) {
		return nil, fmt.Errorf("group %q is not available to the probe user", group)
	}
	key, err := common.GenerateKey()
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	newToken := model.Token{
		UserId:         root.Id,
		Name:           name,
		Key:            key,
		CreatedTime:    now,
		AccessedTime:   now,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
		Status:         common.TokenStatusEnabled,
		Group:          group,
	}
	if err := newToken.Insert(); err != nil {
		return nil, err
	}
	common.SysLog("pelican probe: created internal token for group " + group)
	return &newToken, nil
}

func extractPelicanSVG(raw string) (string, error) {
	svg := pelicanSVGPattern.FindString(raw)
	if svg == "" {
		return "", errors.New("model response contains no <svg> element")
	}
	if len(svg) > pelicanProbeMaxSVG {
		return "", fmt.Errorf("svg too large: %d bytes", len(svg))
	}
	lower := strings.ToLower(svg)
	if strings.Contains(lower, "<script") || strings.Contains(lower, "<foreignobject") {
		return "", errors.New("svg contains unsafe elements")
	}
	// The probe subject is explicitly a looping animation. A still SVG means
	// the model ignored the instruction; publishing it as "success" would hide
	// a real quality regression. "<animate" also covers <animateTransform>
	// and <animateMotion>, the SMIL elements the prompt asks for.
	if !strings.Contains(lower, "<animate") {
		return "", errors.New("svg is not animated")
	}
	return svg, nil
}

func clipPelicanReason(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	const limitChars = 250
	// Slice by runes so a cut in the middle of a multi-byte character cannot
	// produce invalid UTF-8 (upstream errors are often in Chinese).
	runes := []rune(s)
	if len(runes) <= limitChars {
		return s
	}
	return string(runes[:limitChars])
}
