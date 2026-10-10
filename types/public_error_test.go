package types

import (
	"errors"
	"net/http"
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
	assert.Equal(t, "Upstream rate limit exceeded (request id: req_123)", public.Message)
	assert.Equal(t, "rate_limit_error", public.Type)
	assert.Equal(t, "rate_limit_exceeded", public.Code)
	assert.Equal(t, "model", public.Param)
	assert.Nil(t, public.Metadata)
	assert.Equal(t, http.StatusTooManyRequests, err.StatusCode)
	assert.Equal(t, original, err.Error())
	assert.Equal(t, originalRelay, err.ToOpenAIError())
	assert.Equal(t, "Upstream rate limit exceeded (request id: req_123)", err.ToPublicClaudeError("req_123").Message)
}

func TestPublicErrorMessages(t *testing.T) {
	cases := []struct {
		name string
		err  *NewAPIError
		want string
	}{
		{"quota", NewError(errors.New("\u4f59\u989d\u4e0d\u8db3"), ErrorCodeInsufficientUserQuota), "Insufficient quota"},
		{"body size", NewErrorWithStatusCode(errors.New("too large"), ErrorCodeReadRequestBodyFailed, 413), "Request body too large"},
		{"local rate limit", NewErrorWithStatusCode(errors.New("\u9650\u6d41"), "", 429), "Rate limit exceeded"},
		{"authentication", NewErrorWithStatusCode(errors.New("bad token"), "", 401), "Authentication failed"},
		{"invalid request", NewError(errors.New("\u8bf7\u6c42\u9519\u8bef"), ErrorCodeInvalidRequest), "Invalid request"},
		{"timeout", WithOpenAIError(OpenAIError{Message: "\u8d85\u65f6"}, 504), "Upstream request timed out"},
		{"claude rate limit", WithClaudeError(ClaudeError{Type: "rate_limit_error", Message: "\u9650\u6d41"}, 500), "Upstream rate limit exceeded"},
		{"fallback", WithOpenAIError(OpenAIError{Message: "private diagnostic"}, 500), "Upstream request failed"},
		{"nil", nil, "Internal server error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.err.ToPublicOpenAIError("").Message)
			assert.Equal(t, tc.want, tc.err.ToPublicClaudeError("").Message)
		})
	}
}

func TestPublicErrorRemovesNonIdentifierFields(t *testing.T) {
	err := WithOpenAIError(OpenAIError{Message: "private", Type: "\u4e0a\u6e38", Code: map[string]any{"detail": "private"}, Param: "\u5bc6\u94a5"}, 500)
	public := err.ToPublicOpenAIError("\u4e2d\u6587")
	assert.Equal(t, "Upstream request failed", public.Message)
	assert.Equal(t, "upstream_error", public.Type)
	assert.Equal(t, "upstream_error", public.Code)
	assert.Empty(t, public.Param)
}

func TestSanitizePublicErrorEvents(t *testing.T) {
	cases := []struct {
		name, input, message string
	}{
		{"chat", `{"error":{"message":"\u9519\u8bef","type":"rate_limit_error","code":"rate_limit_exceeded","metadata":{"raw":"private"}},"reason":"private","msg":"private"}`, "Upstream rate limit exceeded"},
		{"claude", `{"type":"error","error":{"type":"overloaded_error","message":"\u9519\u8bef","detail":"private"},"body":"private"}`, "Model temporarily unavailable"},
		{"responses flattened", `{"type":"error","message":"\u9519\u8bef","code":"invalid_request_error","sequence_number":3,"detail":"private"}`, "Invalid request"},
		{"responses nested", `{"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"message":"\u9519\u8bef","code":"rate_limit_exceeded"},"metadata":{"raw":"private"},"reason":"private","usage":{"output_tokens":2}},"metadata":"private"}`, "Upstream rate limit exceeded"},
		{"responses nonstream", `{"id":"resp_1","object":"response","status":"failed","error":{"message":"\u9519\u8bef","code":"rate_limit_exceeded"},"usage":{"output_tokens":2},"metadata":"private"}`, "Upstream rate limit exceeded"},
		{"nested with root null", `{"error":null,"response":{"error":{"message":"\u9519\u8bef"},"metadata":"private"}}`, "Upstream request failed"},
		{"failed without error", `{"type":"response.failed","response":{"id":"resp_2","error":null,"reason":"private"}}`, "Upstream request failed"},
		{"realtime", `{"type":"error","event_id":"evt_1","error":{"message":"\u9519\u8bef","code":"invalid_request_error","param":"model"},"diagnostics":"private"}`, "Invalid request"},
		{"image", `{"type":"upstream_error","error":{"message":"\u9519\u8bef"},"error_msg":"private"}`, "Upstream request failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			public, err := SanitizePublicErrorEvent([]byte(tc.input), 500, "req_123")
			require.NoError(t, err)
			assert.Contains(t, string(public), tc.message+" (request id: req_123)")
			assert.NotContains(t, string(public), "private")
			assert.NotContains(t, string(public), "\u9519\u8bef")
			assert.NotContains(t, string(public), `\u9519`)
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
