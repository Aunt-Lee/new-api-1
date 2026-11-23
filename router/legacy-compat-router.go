package router

// Legacy UI compatibility routes. Registered inside SetApiRouter so the same
// middleware stack (Access Token Audit, rate limit, gzip, body cleanup) applies.

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// registerLegacyCompatRoutes restores the handful of endpoints/verbs that the
// official rc51 router changed and the restored legacy front-end still calls.
// All of these are read-only or best-effort operations; the one sensitive
// endpoint (GET /api/user/token) enforces a real rc51 security proof in its
// controller (controller.LegacyAccessToken).
func registerLegacyCompatRoutes(apiRouter *gin.RouterGroup) {
	// Legacy sign-out used GET; rc51 exposes POST /api/user/auth/logout.
	apiRouter.GET("/user/logout", middleware.RouteTag("api"), controller.LegacyLogout)

	// Legacy OAuth state bootstrap used GET; rc51 registers POST /api/oauth/state.
	apiRouter.GET("/oauth/state", middleware.RouteTag("api"), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.LegacyOAuthState)

	// Legacy access token generation (proof-protected shim). UserAuth populates
	// the session/identity context that GetStepUpIdentity and proof consumption
	// rely on.
	apiRouter.GET("/user/token", middleware.RouteTag("api"), middleware.UserAuth(), middleware.DisableCache(), controller.LegacyAccessToken)

	// NOTE: the legacy GET /api/subscription/plans alias is provided by making
	// rc51's existing plans route public in api-router.go (no duplicate here).
}
