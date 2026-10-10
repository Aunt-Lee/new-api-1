package service

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIOCopySanitizesErrorsAndRecalculatesContentLength(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "req_123")
	data := []byte(`{"error":{"message":"\u4e0a\u6e38\u9650\u6d41","code":"rate_limit_exceeded"},"detail":"private"}`)
	resp := &http.Response{StatusCode: 429, Header: http.Header{"Content-Type": {"application/json"}, "Content-Length": {"999"}}}
	IOCopyBytesGracefully(c, resp, data)
	assert.Equal(t, 429, recorder.Code)
	assert.Equal(t, strconv.Itoa(recorder.Body.Len()), recorder.Header().Get("Content-Length"))
	assert.Contains(t, recorder.Body.String(), "Upstream rate limit exceeded (request id: req_123)")
	assert.NotContains(t, recorder.Body.String(), "private")
	var envelope map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.Contains(t, envelope, "error")
}

func TestPublicConversionPreservesViolationDetection(t *testing.T) {
	err := types.WithOpenAIError(types.OpenAIError{Message: "\u8fdd\u89c4: " + CSAMViolationMarker}, 400)
	assert.True(t, HasCSAMViolationMarker(err))
	public := err.ToPublicOpenAIError("req_123")
	assert.NotContains(t, public.Message, CSAMViolationMarker)
	assert.True(t, HasCSAMViolationMarker(err))
	normalized := NormalizeViolationFeeError(err)
	require.NotNil(t, normalized)
	assert.Equal(t, types.ErrorCodeViolationFeeGrokCSAM, normalized.GetErrorCode())
	assert.True(t, types.IsSkipRetryError(normalized))
}
