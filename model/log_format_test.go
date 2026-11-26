package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

func TestUserErrorLogsShowRealMessage(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"error_type": "upstream_error", "error_code": "rate_limit_exceeded", "status_code": 429,
		"admin_info": map[string]interface{}{"upstream_error": "\u4e0a\u6e38\u9650\u6d41"},
	})
	logs := []*Log{{Type: LogTypeError, Content: "\u4e0a\u6e38\u9650\u6d41", Other: other}, {Type: LogTypeConsume, Content: "billing details"}}
	formatUserLogs(logs, 0)
	// Non-sensitive error text is now shown to users.
	assert.Equal(t, "\u4e0a\u6e38\u9650\u6d41", logs[0].Content)
	assert.NotContains(t, logs[0].Other, "admin_info")
	// Non-error logs are untouched.
	assert.Equal(t, "billing details", logs[1].Content)
}

func TestUserErrorLogsHideProtectedKeywords(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"error_type": "upstream_error", "error_code": "billing_error", "status_code": 402,
	})
	logs := []*Log{{Type: LogTypeError, Content: "Your BILLING limit reached", Other: other}}
	formatUserLogs(logs, 0)
	lower := strings.ToLower(logs[0].Content)
	assert.NotContains(t, lower, "billing")
	assert.NotContains(t, lower, "balance")
	assert.NotContains(t, lower, "influence")
	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.Equal(t, "upstream_error", parsed["error_code"])
}
