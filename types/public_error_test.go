package types

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPublicErrorPreservesInternalDiagnostics(t *testing.T) {
	upstream := OpenAIError{
		Message: "\u4e0a\u6e38\u9650\u6d41",
		Type:    "rate_limit_error", Code: "rate_limit_exceeded", Param: "model",
		Metadata: []byte(`{"raw":"\u4e0a\u6e38\u8be6\u60c5"}`),
	}
	err := WithOpenAIError(upstream, http.StatusTooManyRequests)
	original := err.Error()
	originalRelay := err.ToOpenAIError()
	public := err.ToPublicOpenAIError("req_123")
	// Real diagnostic text is now exposed to users, including the request id.
	assert.Contains(t, public.Message, "\u4e0a\u6e38\u9650\u6d41")
	assert.Contains(t, public.Message, "request id: req_123")
	assert.Equal(t, "rate_limit_error", public.Type)
	assert.Equal(t, "rate_limit_exceeded", public.Code)
	assert.Equal(t, "model", public.Param)
	assert.Nil(t, public.Metadata)
	assert.Equal(t, http.StatusTooManyRequests, err.StatusCode)
	assert.Equal(t, original, err.Error())
	assert.Equal(t, originalRelay, err.ToOpenAIError())
	assert.Contains(t, err.ToPublicClaudeError("req_123").Message, "\u4e0a\u6e38\u9650\u6d41")
}

func TestPublicErrorMessages(t *testing.T) {
	cases := []struct {
		name string
		err  *NewAPIError
		want string
	}{
		{"quota", NewError(errors.New("\u4f59\u989d\u4e0d\u8db3"), ErrorCodeInsufficientUserQuota), "\u4f59\u989d\u4e0d\u8db3"},
		{"body size", NewErrorWithStatusCode(errors.New("too large"), ErrorCodeReadRequestBodyFailed, 413), "too large"},
		{"local rate limit", NewErrorWithStatusCode(errors.New("\u9650\u6d41"), "", 429), "\u9650\u6d41"},
		{"authentication", NewErrorWithStatusCode(errors.New("bad token"), "", 401), "bad token"},
		{"invalid request", NewError(errors.New("\u8bf7\u6c42\u9519\u8bef"), ErrorCodeInvalidRequest), "\u8bf7\u6c42\u9519\u8bef"},
		{"timeout", WithOpenAIError(OpenAIError{Message: "\u8d85\u65f6"}, 504), "\u8d85\u65f6"},
		{"claude rate limit", WithClaudeError(ClaudeError{Type: "rate_limit_error", Message: "\u9650\u6d41"}, 500), "\u9650\u6d41"},
		{"fallback", WithOpenAIError(OpenAIError{Message: "private diagnostic"}, 500), "private diagnostic"},
		{"nil", nil, "Internal server error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.err.ToPublicOpenAIError("").Message)
			assert.Equal(t, tc.want, tc.err.ToPublicClaudeError("").Message)
		})
	}
}

func TestPublicErrorHidesProtectedKeywords(t *testing.T) {
	// Protected keywords are hidden regardless of case, in any exposed field.
	cases := []struct {
		name    string
		message string
		code    string
		typ     string
	}{
		{"message lower", "billing failed", "", ""},
		{"message upper", "BILLING FAILED", "", ""},
		{"message mixed", "BiLLiNg failed", "", ""},
		{"balance", "insufficient balance", "", ""},
		{"balance upper", "BALANCE too low", "", ""},
		{"influence", "influence limit", "", ""},
		{"influence mixed", "InFlUeNce limit", "", ""},
		{"code field", "real error", "billing_error", ""},
		{"type field", "real error", "", "balance_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := WithOpenAIError(OpenAIError{Message: tc.message, Code: tc.code, Type: tc.typ}, 500)
			public := err.ToPublicOpenAIError("")
			assert.NotContains(t, strings.ToLower(public.Message), "billing")
			assert.NotContains(t, strings.ToLower(public.Message), "balance")
			assert.NotContains(t, strings.ToLower(public.Message), "influence")
			assert.NotContains(t, strings.ToLower(fmt.Sprint(public.Code)), "billing")
			assert.NotContains(t, strings.ToLower(fmt.Sprint(public.Code)), "balance")
			assert.NotContains(t, strings.ToLower(fmt.Sprint(public.Code)), "influence")
			assert.NotContains(t, strings.ToLower(public.Type), "billing")
			assert.NotContains(t, strings.ToLower(public.Type), "balance")
			assert.NotContains(t, strings.ToLower(public.Type), "influence")
			// Internal error remains intact for retry/billing/admin use.
			assert.Contains(t, err.Error(), tc.message)
		})
	}
}

func TestPublicErrorRemovesNonIdentifierFields(t *testing.T) {
	err := WithOpenAIError(OpenAIError{Message: "private", Type: "\u4e0a\u6e38", Code: map[string]any{"detail": "private"}, Param: "\u5bc6\u94a5"}, 500)
	public := err.ToPublicOpenAIError("\u4e2d\u6587")
	// The message text is public now; identifier fields still sanitized.
	assert.Equal(t, "private", public.Message)
	assert.Equal(t, "upstream_error", public.Type)
	assert.Equal(t, "upstream_error", public.Code)
	assert.Empty(t, public.Param)
}

func TestSanitizePublicErrorEvents(t *testing.T) {
	cases := []struct {
		name, input string
	}{
		{"chat", `{"error":{"message":"\u9519\u8bef","type":"rate_limit_error","code":"rate_limit_exceeded","metadata":{"raw":"private"}},"reason":"private","msg":"private"}`},
		{"claude", `{"type":"error","error":{"type":"overloaded_error","message":"\u9519\u8bef","detail":"private"},"body":"private"}`},
		{"responses flattened", `{"type":"error","message":"\u9519\u8bef","code":"invalid_request_error","sequence_number":3,"detail":"private"}`},
		{"responses nested", `{"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"message":"\u9519\u8bef","code":"rate_limit_exceeded"},"metadata":{"raw":"private"},"reason":"private","usage":{"output_tokens":2}},"metadata":"private"}`},
		{"responses nonstream", `{"id":"resp_1","object":"response","status":"failed","error":{"message":"\u9519\u8bef","code":"rate_limit_exceeded"},"usage":{"output_tokens":2},"metadata":"private"}`},
		{"nested with root null", `{"error":null,"response":{"error":{"message":"\u9519\u8bef"},"metadata":"private"}}`},
		{"failed without error", `{"type":"response.failed","response":{"id":"resp_2","error":null,"reason":"private"}}`},
		{"realtime", `{"type":"error","event_id":"evt_1","error":{"message":"\u9519\u8bef","code":"invalid_request_error","param":"model"},"diagnostics":"private"}`},
		{"image", `{"type":"upstream_error","error":{"message":"\u9519\u8bef"},"error_msg":"private"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			public, err := SanitizePublicErrorEvent([]byte(tc.input), 500, "req_123")
			require.NoError(t, err)
			// Non-sensitive error text is public; only structural/private
			// fields are stripped, not the diagnostic message.
			assert.Contains(t, string(public), "req_123")
			assert.NotContains(t, string(public), "private")
			assert.NotContains(t, string(public), `detail`)
			assert.NotContains(t, string(public), `reason`)
			assert.NotContains(t, string(public), `msg":`)
			assert.NotContains(t, string(public), `body":`)
			assert.NotContains(t, string(public), `diagnostics`)
			var envelope map[string]any
			require.NoError(t, common.Unmarshal(public, &envelope))
			if tc.name == "responses nested" {
				response := envelope["response"].(map[string]any)
				assert.Equal(t, "resp_1", response["id"])
				assert.Equal(t, "failed", response["status"])
				assert.Equal(t, map[string]any{"output_tokens": float64(2)}, response["usage"])
			}
			if tc.name == "responses nonstream" {
				assert.Equal(t, "resp_1", envelope["id"])
				assert.Equal(t, "failed", envelope["status"])
				assert.Equal(t, map[string]any{"output_tokens": float64(2)}, envelope["usage"])
			}
			if tc.name == "claude" {
				assert.Len(t, envelope["error"], 2)
			}
			if tc.name == "realtime" {
				assert.Equal(t, "evt_1", envelope["event_id"])
			}
		})
	}
}

func TestSanitizePublicErrorEventHidesProtectedKeywords(t *testing.T) {
	input := []byte(`{"error":{"message":"Your BILLING quota exceeded","code":"balance_error","detail":"private"}}`)
	public, err := SanitizePublicErrorEvent(input, 402, "req_123")
	require.NoError(t, err)
	lower := strings.ToLower(string(public))
	assert.NotContains(t, lower, "billing")
	assert.NotContains(t, lower, "balance")
	assert.NotContains(t, lower, "private")
}

func TestSanitizePublicErrorEventKeepsChineseText(t *testing.T) {
	input := []byte(`{"error":{"message":"\u4f60\u597d\uff0c\u8bf7\u6c42\u8d85\u65f6"}}`)
	public, err := SanitizePublicErrorEvent(input, 504, "req_123")
	require.NoError(t, err)
	assert.Contains(t, string(public), "\u4f60\u597d")
}

func TestSanitizePublicErrorLeavesSuccessfulOutputUntouched(t *testing.T) {
	for _, input := range []string{
		`{"choices":[{"delta":{"content":"\u4f60\u597d"}}]}`,
		`{"type":"response.output_text.delta","delta":"error: \u9519\u8bef"}`,
		`{"type":"response.function_call_arguments.delta","delta":"{\"error\":\"\u9519\u8bef\"}"}`,
		`{"type":"response.completed","response":{"error":null,"metadata":{"title":"\u4f60\u597d"}}}`,
		`{"error":null,"choices":[]}`,
		`[DONE]`,
	} {
		public, err := SanitizePublicErrorEvent([]byte(input), 200, "req_123")
		require.NoError(t, err)
		assert.Equal(t, input, string(public))
	}
}
