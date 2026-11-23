package controller

// Backend compatibility layer for the restored legacy front-end.
//
// The official rc51 backend changed a handful of endpoint paths/verbs that the
// legacy UI still calls. These thin adapters reuse rc51 controllers wherever
// possible and only add the genuinely missing pieces. No security check is
// relaxed: the access-token shim still consumes a real rc51 security proof.

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// LegacyLogout forwards the legacy GET /api/user/logout to rc51's session-aware
// AuthLogout handler. The legacy UI calls it on sign-out and after account
// deletion; it is intentionally best-effort on the client side.
func LegacyLogout(c *gin.Context) {
	AuthLogout(c)
}

// LegacyOAuthState forwards the legacy GET /api/oauth/state to rc51's
// GenerateOAuthCode (registered as POST in the official router).
func LegacyOAuthState(c *gin.Context) {
	GenerateOAuthCode(c)
}

// SHARED CONTRACT — access_token.generate proof context.
//
// The restored legacy UI (features/profile/hooks/use-access-token.ts) requests
// its proof with this EXACT literal:
//
//	{"scopes":["usage","token.read"],"expires_at":0}
//
// BindVerificationOperation normalizes the scopes as a sorted, de-duplicated
// set on BOTH the proof-issuing and proof-consuming sides, so the resulting
// context hash is identical. Do not change these values without changing the
// frontend constant ACCESS_TOKEN_GENERATE_CONTEXT in lockstep.
var legacyAccessTokenProofContext = service.AccessTokenGenerateContext{
	Scopes:    []string{"usage", "token.read"},
	ExpiresAt: 0,
}

// LegacyAccessToken restores the legacy GET /api/user/token. It requires a real
// rc51 security proof bound to the fixed context above, then issues a
// legacy-format access token string exactly as the old controller did.
//
// Security note: this does NOT relax verification. The proof is consumed by
// middleware.RequireSecurityProof; a missing/invalid/mismatched proof is
// rejected with the standard SECURITY_PROOF_* error.
func LegacyAccessToken(c *gin.Context) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "The current sign-in method does not support security verification",
		})
		return
	}

	proofContext, err := common.Marshal(legacyAccessTokenProofContext)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{
		Scope:   service.VerificationScopeAccessTokenGenerate,
		Context: proofContext,
	}) == nil {
		return
	}

	user, err := model.GetUserById(identity.UserID, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Generate a legacy-format token string (same shape the old UI expects).
	key, err := common.GenerateRandomKey(29 + common.GetRandomInt(4))
	if err != nil {
		common.ApiErrorT(c, "Failed to generate token")
		return
	}
	user.SetAccessToken(key)
	if model.DB.Where("access_token = ?", user.AccessToken).First(user).RowsAffected != 0 {
		common.ApiErrorT(c, "Duplicate token")
		return
	}
	if err := user.Update(false); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, user.GetAccessToken())
}
