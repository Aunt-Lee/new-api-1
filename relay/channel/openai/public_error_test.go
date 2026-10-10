package openai

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestForcedStreamFormattingPreservesPublicError(t *testing.T) {
	for _, thinking := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		helper.SetEventStreamHeaders(c)
		data := `{"error":{"message":"\u4e0a\u6e38\u9519\u8bef","code":"rate_limit_exceeded"}}`
		require.NoError(t, sendStreamData(c, &relaycommon.RelayInfo{}, data, true, thinking))
		assert.Contains(t, recorder.Body.String(), "Upstream rate limit exceeded")
		assert.Contains(t, recorder.Body.String(), `"error":`)
		assert.NotContains(t, recorder.Body.String(), `\u4e0a`)
	}
}

func TestRealtimePublicErrorsDoNotChangeClientMessages(t *testing.T) {
	original := `{"type":"error","event_id":"evt_1","error":{"message":"\u4e0a\u6e38\u9519\u8bef","code":"rate_limit_exceeded"},"metadata":"private"}`
	result := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _ := gin.CreateTestContext(w)
		c.Request = r
		c.Set(common.RequestIdKey, "req_123")
		conn, err := (&websocket.Upgrader{}).Upgrade(c.Writer, r, nil)
		if err != nil {
			result <- err
			return
		}
		defer conn.Close()
		_, received, err := conn.ReadMessage()
		if err != nil {
			result <- err
			return
		}
		// The shared WebSocket writer must not sanitize messages to upstream.
		if string(received) != original {
			result <- assert.AnError
			return
		}
		public, err := service.SanitizePublicErrorResponse(c, received, 500)
		if err == nil {
			err = helper.WssString(c, conn, string(public))
		}
		result <- err
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+server.URL[4:], nil)
	require.NoError(t, err)
	defer client.Close()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.NoError(t, helper.WssString(c, client, original))
	_, message, err := client.ReadMessage()
	require.NoError(t, err)
	require.NoError(t, <-result)
	assert.Contains(t, string(message), "Upstream rate limit exceeded (request id: req_123)")
	assert.Contains(t, string(message), `"event_id":"evt_1"`)
	assert.NotContains(t, string(message), "private")
	assert.NotContains(t, string(message), `\u4e0a`)
}
