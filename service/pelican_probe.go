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
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// The pelican probe asks each target group to draw "a pelican riding a
// bicycle" as a single SVG, then publishes the untouched result as visible
// evidence that the group is really serving the expected model quality.
const (
	pelicanProbeModel  = "gpt-6.1-sol"
	pelicanProbePrompt = "Create a single SVG illustration of a pelican riding a bicycle. " +
		"The image must clearly show a pelican (long beak, wings, body), a bicycle with two round wheels and a frame, " +
		"and the pelican sitting on the saddle pedaling the bicycle. " +
		"Use basic SVG shapes such as circle, ellipse, path, line, polygon and rect, and include a viewBox. " +
		"Output ONLY the SVG markup, starting with <svg and ending with </svg>. " +
		"No explanation, no markdown code fences."

	// Automatic probes are randomized inside [12h, 18h). The lower bound is
	// hard: two automatic runs can never be closer than 12 hours.
	pelicanProbeMinInterval = 12 * time.Hour
	pelicanProbeJitter      = 6 * time.Hour

	pelicanProbeTick          = 15 * time.Minute
	pelicanProbeStartupDelay  = 60 * time.Second
	pelicanProbeRetryCooldown = time.Hour
	pelicanProbeRetention     = 30 * 24 * time.Hour
	pelicanProbeMaxSVG        = 200 << 10
	pelicanProbeHTTPTimeout   = 3 * time.Minute
)

var (
	pelicanProbeGroups = []string{"Gpt Pro", "Gpt Plus&Team"}
	pelicanProbeBusy   atomic.Bool
	// Only touched by the scheduler goroutine, so no lock is needed.
	pelicanProbeLastAttempt time.Time
	// A dedicated client keeps the loopback call away from the shared relay
	// client (proxy settings / SSRF dialer would otherwise interfere).
	pelicanProbeHTTPClient = &http.Client{Timeout: pelicanProbeHTTPTimeout}
	pelicanSVGPattern      = regexp.MustCompile(`(?is)<svg\b.*</svg>`)
)

// PelicanProbeGroups returns a copy of the groups covered by the probe, so
// the public read endpoint and the scheduler always agree on the group list.
func PelicanProbeGroups() []string {
	groups := make([]string, len(pelicanProbeGroups))
	copy(groups, pelicanProbeGroups)
	return groups
}

// StartPelicanProbeScheduler starts the random-interval probe loop. Only the
// master node runs it, matching the other background tasks in this project.
func StartPelicanProbeScheduler() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		// The probe calls our own /v1 endpoint, so let the HTTP server bind first.
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

// RunPelicanProbes runs one probe per target group and always stores a row
// (success or failure) so the UI can show the real outcome. It is also used by
// the admin "run now" endpoint. Returns nil when a run is already in progress.
func RunPelicanProbes(ctx context.Context) []model.PelicanTest {
	if !pelicanProbeBusy.CompareAndSwap(false, true) {
		return nil
	}
	defer pelicanProbeBusy.Store(false)

	results := make([]model.PelicanTest, 0, len(pelicanProbeGroups))
	for _, group := range pelicanProbeGroups {
		record := model.PelicanTest{
			Group:     group,
			ModelName: pelicanProbeModel,
			Status:    model.PelicanTestStatusInvalid,
		}
		svg, err := requestPelicanSVG(ctx, group)
		if err != nil {
			record.FailReason = clipPelicanReason(err.Error())
			common.SysLog(fmt.Sprintf("pelican probe [%s] failed: %v", group, err))
		} else {
			record.Content = svg
			record.Status = model.PelicanTestStatusSuccess
		}
		if err := model.InsertPelicanTest(&record); err != nil {
			common.SysError(fmt.Sprintf("pelican probe [%s]: failed to store result: %v", group, err))
		}
		results = append(results, record)
	}
	return results
}

// requestPelicanSVG goes through the real relay chain (TokenAuth -> Distribute
// -> Relay -> billing/log) by calling our own /v1/chat/completions endpoint
// with a dedicated token bound to the target group.
func requestPelicanSVG(ctx context.Context, group string) (string, error) {
	token, err := ensurePelicanProbeToken(group)
	if err != nil {
		return "", err
	}

	payload, err := common.Marshal(map[string]any{
		"model": pelicanProbeModel,
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

	root := model.GetRootUser()
	if root == nil || root.Id == 0 {
		return nil, errors.New("root user not found, cannot create probe token")
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
	return svg, nil
}

func clipPelicanReason(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	const limit = 250
	if len(s) <= limit {
		return s
	}
	return s[:limit]
}
