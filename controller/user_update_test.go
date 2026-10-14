package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateUserWithExistingLongDisplayName(t *testing.T) {
	const originalName = "JIANGZHAOKUN1067517323"
	for _, tc := range []struct {
		name        string
		displayName string
		password    string
		targetRole  int
		wantSuccess bool
	}{
		{"unchanged OAuth name", originalName, "", common.RoleCommonUser, true},
		{"changed oversized name", originalName + "x", "", common.RoleCommonUser, false},
		{"valid replacement", "New name", "", common.RoleCommonUser, true},
		{"Unicode boundary", strings.Repeat("名", 20), "", common.RoleCommonUser, true},
		{"Unicode oversized", strings.Repeat("名", 21), "", common.RoleCommonUser, false},
		{"invalid password remains rejected", originalName, "short", common.RoleCommonUser, false},
		{"role permissions remain enforced", originalName, "", common.RoleRootUser, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupModelListControllerTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.Log{}))
			require.NoError(t, i18n.Init())
			operator := model.User{Username: "admin", Role: common.RoleAdminUser, AffCode: "admin-code"}
			require.NoError(t, db.Create(&operator).Error)
			user := model.User{
				Username: "github_336", DisplayName: originalName, Role: tc.targetRole,
				Group: "default", Password: "existing-hash", Quota: 12345,
				GitHubId: "336", AffCode: "user-code",
			}
			require.NoError(t, db.Create(&user).Error)
			payload, err := common.Marshal(map[string]any{
				"id": user.Id, "username": user.Username, "display_name": tc.displayName,
				"group": "auto", "password": tc.password, "quota": 99999,
			})
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPut, "/api/user/", bytes.NewReader(payload))
			c.Set("id", operator.Id)
			c.Set("role", operator.Role)
			c.Set("username", operator.Username)
			UpdateUser(c)
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, tc.wantSuccess, response.Success, recorder.Body.String())
			var saved model.User
			require.NoError(t, db.First(&saved, user.Id).Error)
			if tc.wantSuccess {
				assert.Equal(t, "auto", saved.Group)
				assert.Equal(t, tc.displayName, saved.DisplayName)
			} else {
				assert.Equal(t, "default", saved.Group)
				assert.Equal(t, originalName, saved.DisplayName)
			}
			assert.Equal(t, user.Password, saved.Password)
			assert.Equal(t, user.Quota, saved.Quota)
			assert.Equal(t, user.Role, saved.Role)
			assert.Equal(t, user.GitHubId, saved.GitHubId)
		})
	}
}
