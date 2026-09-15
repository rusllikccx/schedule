package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestAuthAndLinks(t *testing.T) {
	// Setup temporary links file for testing
	tmpFile, err := os.CreateTemp("", "links-test-*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	initialLinks := []OnlineLink{
		{Title: "Фізика", Lecturer: "Іванов І.І.", Link: "https://zoom.us/j/123"},
	}
	initialBytes, _ := json.MarshalIndent(initialLinks, "", "  ")
	if err := os.WriteFile(tmpFile.Name(), initialBytes, 0644); err != nil {
		t.Fatalf("Failed to write initial links: %v", err)
	}

	oldFilePath := filePath
	oldAdminHash := adminHash
	defer func() {
		filePath = oldFilePath
		adminHash = oldAdminHash
	}()

	filePath = tmpFile.Name()
	testPassword := "super-secure-pass-456"
	h, err := bcrypt.GenerateFromPassword([]byte(testPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("Failed to generate test hash: %v", err)
	}
	adminHash = string(h)

	// Initialize cache
	if err := cache.LoadFromDisk(filePath); err != nil {
		t.Fatalf("Failed to load cache: %v", err)
	}

	// 1. Test GET /api/links without auth (public read)
	req := httptest.NewRequest(http.MethodGet, "/api/links", nil)
	rr := httptest.NewRecorder()
	handleLinks(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}
	etag := rr.Header().Get("ETag")
	if etag == "" {
		t.Errorf("Expected ETag header to be set")
	}

	// 2. Test GET /api/links with matching ETag (304 Not Modified)
	req304 := httptest.NewRequest(http.MethodGet, "/api/links", nil)
	req304.Header.Set("If-None-Match", etag)
	rr304 := httptest.NewRecorder()
	handleLinks(rr304, req304)
	if rr304.Code != http.StatusNotModified {
		t.Errorf("Expected status 304, got %d", rr304.Code)
	}

	// 3. Test POST /api/links without session/auth (401 Unauthorized)
	postBody := []byte(`[{"title":"Математика","link":"https://zoom.us/j/999"}]`)
	reqNoAuth := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(postBody))
	rrNoAuth := httptest.NewRecorder()
	handleLinks(rrNoAuth, reqNoAuth)
	if rrNoAuth.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401 Unauthorized, got %d", rrNoAuth.Code)
	}

	// 4. Test POST /api/auth/login with wrong password (401 Unauthorized)
	badLoginBody := []byte(`{"password":"wrong-password"}`)
	reqBadLogin := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(badLoginBody))
	reqBadLogin.RemoteAddr = "192.168.1.50:12345"
	rrBadLogin := httptest.NewRecorder()
	handleAuthLogin(rrBadLogin, reqBadLogin)
	if rrBadLogin.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401 Unauthorized for bad login, got %d", rrBadLogin.Code)
	}

	// 5. Test POST /api/auth/login with correct password (200 OK + cookie + token)
	okLoginBody := []byte(`{"password":"super-secure-pass-456"}`)
	reqOkLogin := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(okLoginBody))
	reqOkLogin.RemoteAddr = "192.168.1.50:12345"
	rrOkLogin := httptest.NewRecorder()
	handleAuthLogin(rrOkLogin, reqOkLogin)
	if rrOkLogin.Code != http.StatusOK {
		t.Errorf("Expected status 200 OK for login, got %d. Body: %s", rrOkLogin.Code, rrOkLogin.Body.String())
	}

	cookies := rrOkLogin.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "admin_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil || sessionCookie.Value == "" {
		t.Fatalf("Expected admin_session cookie to be set")
	}
	if !sessionCookie.HttpOnly {
		t.Errorf("Expected admin_session cookie to be HttpOnly")
	}

	// 6. Test GET /api/auth/check with session cookie (200 OK + authenticated: true)
	reqCheck := httptest.NewRequest(http.MethodGet, "/api/auth/check", nil)
	reqCheck.AddCookie(sessionCookie)
	rrCheck := httptest.NewRecorder()
	handleAuthCheck(rrCheck, reqCheck)
	if rrCheck.Code != http.StatusOK {
		t.Errorf("Expected status 200 for check, got %d", rrCheck.Code)
	}
	var checkResp struct {
		Authenticated bool `json:"authenticated"`
	}
	_ = json.Unmarshal(rrCheck.Body.Bytes(), &checkResp)
	if !checkResp.Authenticated {
		t.Errorf("Expected authenticated: true")
	}

	// 7. Test POST /api/links with session cookie (200 OK + update cache)
	reqSave := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(postBody))
	reqSave.AddCookie(sessionCookie)
	rrSave := httptest.NewRecorder()
	handleLinks(rrSave, reqSave)
	if rrSave.Code != http.StatusOK {
		t.Errorf("Expected status 200 for authenticated save, got %d. Body: %s", rrSave.Code, rrSave.Body.String())
	}

	// 8. Test POST /api/auth/logout (revokes session)
	reqLogout := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	reqLogout.AddCookie(sessionCookie)
	rrLogout := httptest.NewRecorder()
	handleAuthLogout(rrLogout, reqLogout)
	if rrLogout.Code != http.StatusOK {
		t.Errorf("Expected status 200 for logout, got %d", rrLogout.Code)
	}

	// 9. Test GET /api/auth/check after logout (authenticated: false)
	reqCheckAfter := httptest.NewRequest(http.MethodGet, "/api/auth/check", nil)
	reqCheckAfter.AddCookie(sessionCookie)
	rrCheckAfter := httptest.NewRecorder()
	handleAuthCheck(rrCheckAfter, reqCheckAfter)
	_ = json.Unmarshal(rrCheckAfter.Body.Bytes(), &checkResp)
	if checkResp.Authenticated {
		t.Errorf("Expected authenticated: false after logout")
	}

	// 10. Test Rate Limiting on /api/auth/login
	attackerIP := "10.0.0.99:54321"
	loginLimiter.RecordSuccess("10.0.0.99") // reset first
	for i := 0; i < 5; i++ {
		loginLimiter.RecordFail("10.0.0.99")
	}
	reqLocked := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(okLoginBody))
	reqLocked.RemoteAddr = attackerIP
	rrLocked := httptest.NewRecorder()
	handleAuthLogin(rrLocked, reqLocked)
	if rrLocked.Code != http.StatusTooManyRequests {
		t.Errorf("Expected 429 Too Many Requests after 5 failures, got %d", rrLocked.Code)
	}
}
