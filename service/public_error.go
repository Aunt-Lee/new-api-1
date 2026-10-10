package service

import (
	"bytes"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// Keep upstream diagnostics in server logs, not in client-facing error events.
func SanitizePublicErrorResponse(c *gin.Context, data []byte, statusCode int) ([]byte, error) {
	public, err := types.SanitizePublicErrorEvent(data, statusCode, c.GetString(common.RequestIdKey))
	if err != nil || !bytes.Equal(public, data) {
		logger.LogWarn(c, "upstream error event: "+common.LocalLogPreview(common.MaskSensitiveInfo(string(data))))
	}
	return public, err
}
