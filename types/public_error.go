package types

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/tidwall/gjson"
)

// hiddenPublicErrorKeywords is a case-insensitive deny-list. If any of these
// substrings is present in an error, the whole error content is withheld from
// end users and replaced by a generic message. Internal diagnostics remain
// available for retry decisions, billing rules and administrator logs.
var hiddenPublicErrorKeywords = []string{"billing", "balance", "influence"}

// ContainsHiddenPublicKeyword reports whether text carries a protected keyword
// (billing/balance/influence, case-insensitive). Exported for other layers that
// surface error text to users, such as the user-facing log view.
func ContainsHiddenPublicKeyword(text string) bool {
	return containsHiddenPublicKeyword(text)
}

// containsHiddenPublicKeyword reports whether text carries a protected keyword
// (case-insensitive).
func containsHiddenPublicKeyword(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, keyword := range hiddenPublicErrorKeywords {
		if strings.Contains(lower, keyword) {
			return true
		}
	}
	return false
}

// publicRawMessage returns the diagnostic text safe to expose. WithOpenAIError
// appends the raw upstream metadata ("<msg> (<metadata json>)") to the relay
// message for admin diagnostics; that metadata is internal and is stripped
// here so it is never surfaced to end users.
func publicRawMessage(e *NewAPIError) string {
	if e == nil {
		return ""
	}
	msg := e.ToOpenAIError().Message
	if len(e.Metadata) > 0 {
		suffix := " (" + string(e.Metadata) + ")"
		msg = strings.TrimSuffix(msg, suffix)
	}
	return msg
}

// PublicMessage returns the real diagnostic text to end users. It is withheld
// only when the message carries a protected keyword or is empty; internal
// errors remain available for retry decisions, billing rules and admin logs.
func (e *NewAPIError) PublicMessage() string {
	if e == nil {
		return "Internal server error"
	}
	raw := publicRawMessage(e)
	if containsHiddenPublicKeyword(raw) || containsHiddenPublicKeyword(e.Error()) {
		return e.genericPublicMessage()
	}
	if raw == "" {
		return e.genericPublicMessage()
	}
	return raw
}

// genericPublicMessage is the safe fallback used when public error content is
// withheld.
func (e *NewAPIError) genericPublicMessage() string {
	if e == nil {
		return "Internal server error"
	}
	if e.StatusCode == http.StatusRequestEntityTooLarge {
		return "Request body too large"
	}
	switch e.GetErrorCode() {
	case ErrorCodeInsufficientUserQuota, ErrorCodePreConsumeTokenQuotaFailed, "insufficient_quota":
		return "Insufficient quota"
	case ErrorCodePromptBlocked, ErrorCodeSensitiveWordsDetected, ErrorCodeViolationFeeGrokCSAM, "content_policy_violation", "content_moderation_failed":
		return "Content policy violation"
	case ErrorCodeInvalidRequest, ErrorCodeBadRequestBody, ErrorCodeReadRequestBodyFailed, "invalid_request_error", "context_length_exceeded":
		return "Invalid request"
	case ErrorCodeModelNotFound, ErrorCodeGetChannelFailed, ErrorCodeChannelNoAvailableKey, "model_not_available", "overloaded_error":
		return "Model temporarily unavailable"
	case ErrorCodeAccessDenied:
		return "Access denied"
	case "rate_limit_exceeded", "rate_limit_error":
		return "Upstream rate limit exceeded"
	}
	switch e.ToOpenAIError().Type {
	case "rate_limit_error":
		return "Upstream rate limit exceeded"
	case "invalid_request_error":
		return "Invalid request"
	case "authentication_error", "permission_error":
		return "Upstream authentication failed"
	case "overloaded_error", "not_found_error":
		return "Model temporarily unavailable"
	}
	switch e.StatusCode {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "Invalid request"
	case http.StatusUnauthorized, http.StatusForbidden:
		if e.GetErrorType() == ErrorTypeNewAPIError {
			return "Authentication failed"
		}
		return "Upstream authentication failed"
	case http.StatusNotFound, http.StatusServiceUnavailable:
		return "Model temporarily unavailable"
	case http.StatusTooManyRequests:
		if e.GetErrorType() == ErrorTypeNewAPIError {
			return "Rate limit exceeded"
		}
		return "Upstream rate limit exceeded"
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return "Upstream request timed out"
	}
	if e.GetErrorType() == ErrorTypeNewAPIError {
		return "Internal server error"
	}
	return "Upstream request failed"
}

// Only machine identifiers may accompany the public message. In particular,
// upstream metadata can contain the original response body and is not public.
func publicErrorIdentifier(value string) string {
	if len(value) > 128 {
		return ""
	}
	for _, ch := range value {
		if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("_.:-[]", ch) {
			continue
		}
		return ""
	}
	return value
}

// exposesProtectedKeyword checks every raw field that may be surfaced to a
// user, before identifier sanitization can strip suspicious characters.
func exposesProtectedKeyword(err OpenAIError) bool {
	if containsHiddenPublicKeyword(err.Message) {
		return true
	}
	if containsHiddenPublicKeyword(err.Type) || containsHiddenPublicKeyword(err.Param) {
		return true
	}
	switch code := err.Code.(type) {
	case string:
		return containsHiddenPublicKeyword(code)
	case ErrorCode:
		return containsHiddenPublicKeyword(string(code))
	}
	return false
}

func (e *NewAPIError) ToPublicOpenAIError(requestID string) OpenAIError {
	var result OpenAIError
	if e != nil {
		result = e.ToOpenAIError()
		result.Message = publicRawMessage(e)
	}
	// Inspect the raw error (including fields other than the message) before
	// sanitizing. A protected keyword anywhere hides the entire error.
	hideAll := exposesProtectedKeyword(result) || containsHiddenPublicKeyword(e.Error())
	result.Message = e.PublicMessage()
	if requestID = publicErrorIdentifier(requestID); requestID != "" {
		result.Message = common.MessageWithRequestId(result.Message, requestID)
	}
	result.Type = publicErrorIdentifier(result.Type)
	if result.Type == "" {
		result.Type = "upstream_error"
	}
	result.Param = publicErrorIdentifier(result.Param)
	switch code := result.Code.(type) {
	case string:
		result.Code = publicErrorIdentifier(code)
	case ErrorCode:
		result.Code = publicErrorIdentifier(string(code))
	case nil, int, int64, float64:
	default:
		result.Code = "upstream_error"
	}
	result.Metadata = nil
	if hideAll {
		result.Message = e.genericPublicMessage()
		if requestID != "" {
			result.Message = common.MessageWithRequestId(result.Message, requestID)
		}
		result.Type = "upstream_error"
		result.Param = ""
		result.Code = "upstream_error"
	}
	return result
}

func (e *NewAPIError) ToPublicClaudeError(requestID string) ClaudeError {
	var result ClaudeError
	if e != nil {
		result = e.ToClaudeError()
	}
	result.Message = e.ToPublicOpenAIError(requestID).Message
	result.Type = publicErrorIdentifier(result.Type)
	if result.Type == "" || containsHiddenPublicKeyword(result.Type) {
		result.Type = "api_error"
	}
	return result
}

// IsPublicErrorEvent inspects only protocol-level fields, never model text or
// tool arguments. Normal streaming chunks do not need full JSON decoding.
func IsPublicErrorEvent(data []byte) bool {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '{' {
		return false
	}
	values := gjson.GetManyBytes(data, "type", "error", "response.error")
	switch values[0].String() {
	case "error", "upstream_error", "response.error", "response.failed":
		return true
	}
	return values[1].Exists() && values[1].Type != gjson.Null || values[2].Exists() && values[2].Type != gjson.Null
}

// SanitizePublicErrorEvent allows only protocol fields on error envelopes.
// Successful model output, including Chinese text, remains byte-for-byte intact.
func SanitizePublicErrorEvent(data []byte, statusCode int, requestID string) ([]byte, error) {
	if !IsPublicErrorEvent(data) {
		return data, nil
	}
	var envelope map[string]json.RawMessage
	if err := common.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	var eventType string
	_ = common.Unmarshal(envelope["type"], &eventType)
	public := make(map[string]any)
	for _, key := range []string{"type", "event_id", "sequence_number", "id", "object", "created_at", "status", "model", "output", "usage"} {
		if value, ok := envelope[key]; ok {
			public[key] = value
		}
	}
	if eventType != "" {
		public["type"] = publicErrorIdentifier(eventType)
	}
	if nested := gjson.GetBytes(data, "response.error"); nested.Exists() && nested.Type != gjson.Null || eventType == "response.failed" {
		var response map[string]json.RawMessage
		_ = common.Unmarshal(envelope["response"], &response)
		publicResponse := make(map[string]any)
		for _, key := range []string{"id", "object", "created_at", "status", "model", "output", "usage"} {
			if value, ok := response[key]; ok {
				publicResponse[key] = value
			}
		}
		publicResponse["error"] = publicErrorValue(response["error"], statusCode, requestID)
		public["response"] = publicResponse
	}
	if upstream := gjson.GetBytes(data, "error"); upstream.Exists() && upstream.Type != gjson.Null {
		publicError := publicErrorValue(envelope["error"], statusCode, requestID)
		public["error"] = publicError
		// Claude's error contract contains only type and message.
		if eventType == "error" && !upstream.Get("code").Exists() && !upstream.Get("param").Exists() {
			public["error"] = ClaudeError{Type: publicError.Type, Message: publicError.Message}
		}
	} else if public["response"] == nil {
		// Responses API also uses flattened error events (message/code/param).
		publicError := publicErrorValue(data, statusCode, requestID)
		public["message"] = publicError.Message
		public["code"] = publicError.Code
		public["param"] = publicError.Param
	}
	return common.Marshal(public)
}

func publicErrorValue(encoded []byte, statusCode int, requestID string) OpenAIError {
	var upstream OpenAIError
	if err := common.Unmarshal(encoded, &upstream); err != nil {
		upstream.Message = ""
	}
	if statusCode < 400 {
		statusCode = http.StatusInternalServerError
	}
	return WithOpenAIError(upstream, statusCode).ToPublicOpenAIError(requestID)
}
