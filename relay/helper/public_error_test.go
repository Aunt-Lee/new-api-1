package helper

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWritePublicRelayErrorRespectsResponseProtocol(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatOpenAIResponses} {
		for _, started := range []bool{false, true} {
			t.Run(string(format)+map[bool]string{false: "/json", true: "/stream"}[started], func(t *testing.T) {
				recorder := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(recorder)
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
				c.Set(common.RequestIdKey, "req_123")
				SetEventStreamHeaders(c)
				if started {
					_, err := c.Writer.Write([]byte(": ping\n\n"))
					require.NoError(t, err)
				}
				original := types.NewErrorWithStatusCode(errors.New("\u4e0a\u6e38\u9519\u8bef"), types.ErrorCodeInvalidRequest, 400)
				WritePublicRelayError(c, format, original)
				assert.Contains(t, recorder.Body.String(), "Invalid request (request id: req_123)")
				assert.NotContains(t, recorder.Body.String(), "\u4e0a\u6e38\u9519\u8bef")
				assert.Equal(t, "\u4e0a\u6e38\u9519\u8bef", original.Error())
				if started {
					assert.Equal(t, 200, recorder.Code)
					assert.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))
					assert.Contains(t, recorder.Body.String(), "\ndata: {")
					if format != types.RelayFormatOpenAI {
						assert.Contains(t, recorder.Body.String(), "event: error\n")
					}
				} else {
					assert.Equal(t, 400, recorder.Code)
					assert.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
					assert.Empty(t, recorder.Header().Get("Transfer-Encoding"))
					var envelope map[string]any
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &envelope))
					assert.Contains(t, envelope, "error")
				}
			})
		}
	}
}

func TestStreamOutputHelpersSanitizeOnlyErrors(t *testing.T) {
	for _, output := range []string{"chat", "claude", "responses"} {
		t.Run(output, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
			c.Set(common.RequestIdKey, "req_123")
			SetEventStreamHeaders(c)
			data := `{"type":"error","error":{"message":"\u9519\u8bef","type":"rate_limit_error"},"detail":"private"}`
			switch output {
			case "chat":
				require.NoError(t, StringData(c, data))
			case "claude":
				ClaudeChunkData(c, dto.ClaudeResponse{Type: "error"}, data)
			case "responses":
				require.NoError(t, ResponseChunkData(c, dto.ResponsesStreamResponse{Type: "error"}, data))
			}
			assert.Contains(t, recorder.Body.String(), "Upstream rate limit exceeded (request id: req_123)")
			assert.NotContains(t, recorder.Body.String(), "private")
			assert.NotContains(t, recorder.Body.String(), `\u9519`)
		})
	}
}
