package helper

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// WritePublicRelayError respects the protocol of an already-started stream.
// A committed response must never be followed by a second JSON response.
func WritePublicRelayError(c *gin.Context, format types.RelayFormat, err *types.NewAPIError) {
	requestID := c.GetString(common.RequestIdKey)
	if c.Writer.Written() {
		if !strings.HasPrefix(c.Writer.Header().Get("Content-Type"), "text/event-stream") {
			return
		}
		envelope := gin.H{"error": err.ToPublicOpenAIError(requestID)}
		prefix := ""
		if format == types.RelayFormatClaude {
			envelope["error"] = err.ToPublicClaudeError(requestID)
		}
		if format == types.RelayFormatClaude || format == types.RelayFormatOpenAIResponses {
			envelope["type"] = "error"
			prefix = "event: error\n"
		}
		data, marshalErr := common.Marshal(envelope)
		if marshalErr == nil {
			c.Render(-1, common.CustomEvent{Data: prefix + "data: " + string(data)})
			_ = FlushWriter(c)
		}
		return
	}
	// Stream headers may have been prepared without any bytes being sent yet.
	c.Writer.Header().Del("Content-Type")
	c.Writer.Header().Del("Transfer-Encoding")
	if format == types.RelayFormatClaude {
		c.JSON(err.StatusCode, gin.H{"type": "error", "error": err.ToPublicClaudeError(requestID)})
		return
	}
	c.JSON(err.StatusCode, gin.H{"error": err.ToPublicOpenAIError(requestID)})
}
