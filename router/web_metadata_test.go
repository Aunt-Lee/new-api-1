package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPublicPageMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		path      string
		canonical string
		robots    string
	}{
		{path: "/", canonical: "<https://newtonrouter.com/>; rel=\"canonical\""},
		{path: "/pricing?group=example", canonical: "<https://newtonrouter.com/pricing>; rel=\"canonical\""},
		{path: "/plans/", canonical: "<https://newtonrouter.com/plans>; rel=\"canonical\""},
		{path: "/privacy-policy", canonical: "<https://newtonrouter.com/privacy-policy>; rel=\"canonical\""},
		{path: "/guides/getting-started.html"},
		{path: "/robots.txt"},
		{path: "/sitemap.xml"},
		{path: "/llms.txt"},
		{path: "/static/js/index.js"},
		{path: "/logo.png"},
		{path: "/keys", robots: "noindex, nofollow"},
		{path: "/sign-in", robots: "noindex, nofollow"},
		{path: "/unknown", robots: "noindex, nofollow"},
		{path: "/index.html", robots: "noindex, nofollow"},
	} {
		t.Run(test.path, func(t *testing.T) {
			engine := gin.New()
			engine.Use(publicPageMetadata())
			engine.NoRoute(func(c *gin.Context) { c.Status(http.StatusOK) })
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			require.Equal(t, http.StatusOK, response.Code)
			assert.Equal(t, test.canonical, response.Header().Get("Link"))
			assert.Equal(t, test.robots, response.Header().Get("X-Robots-Tag"))
		})
	}
}
