package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayDoesNotRetryAfterOutputStarted(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	err := types.InitOpenAIError(types.ErrorCodeChannelNoAvailableKey, 503)
	assert.True(t, shouldRetry(c, err, 1))
	_, writeErr := c.Writer.Write([]byte("data: {}\n\n"))
	require.NoError(t, writeErr)
	assert.False(t, shouldRetry(c, err, 1))
}
