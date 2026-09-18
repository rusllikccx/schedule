package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

	// 7. Test POST /api/links with session cookie (200 OK + update cache + creates .bak)
	reqSave := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(postBody))
	reqSave.AddCookie(sessionCookie)
	rrSave := httptest.NewRecorder()
	handleLinks(rrSave, reqSave)
	if rrSave.Code != http.StatusOK {
		t.Errorf("Expected status 200 for authenticated save, got %d. Body: %s", rrSave.Code, rrSave.Body.String())
	}

	// Verify .bak file created
	bakPath := filePath + ".bak"
	if _, err := os.Stat(bakPath); err != nil {
		t.Errorf("Expected backup file %s to be created, got error: %v", bakPath, err)
	} else {
		_ = os.Remove(bakPath)
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
	// 11. Test GET /api/backups (authenticated)
	reqBackups := httptest.NewRequest(http.MethodGet, "/api/backups", nil)
	// Create new session for testing backups
	newSession := sessionStore.Create()
	cookieBackups := &http.Cookie{Name: "admin_session", Value: newSession}
	reqBackups.AddCookie(cookieBackups)
	rrBackups := httptest.NewRecorder()
	handleBackups(rrBackups, reqBackups)
	if rrBackups.Code != http.StatusOK {
		t.Errorf("Expected status 200 for GET /api/backups, got %d", rrBackups.Code)
	}
	var backupList []BackupInfo
	if err := json.Unmarshal(rrBackups.Body.Bytes(), &backupList); err != nil {
		t.Errorf("Failed to parse backups list: %v", err)
	}
	if len(backupList) == 0 {
		t.Errorf("Expected at least 1 backup in list")
	}

	// 12. Test POST /api/backups/rollback (authenticated)
	if len(backupList) > 0 {
		rollbackReqBody, _ := json.Marshal(map[string]string{
			"filename": backupList[0].Filename,
		})
		reqRollback := httptest.NewRequest(http.MethodPost, "/api/backups/rollback", bytes.NewReader(rollbackReqBody))
		reqRollback.AddCookie(cookieBackups)
		rrRollback := httptest.NewRecorder()
		handleBackups(rrRollback, reqRollback)
		if rrRollback.Code != http.StatusOK {
			t.Errorf("Expected status 200 for rollback, got %d. Body: %s", rrRollback.Code, rrRollback.Body.String())
		}
	}
}

func TestSecurityAndEdgeCases(t *testing.T) {
	// 1. Test Directory Traversal prevention on rollback
	authSession := sessionStore.Create()
	authCookie := &http.Cookie{Name: "admin_session", Value: authSession}

	traversalFilenames := []string{
		"../../etc/passwd",
		"../links.json",
		"evil.json",
		"links_evil.txt",
		"something/links_20260915_120000.json",
	}

	for _, badName := range traversalFilenames {
		body, _ := json.Marshal(map[string]string{"filename": badName})
		req := httptest.NewRequest(http.MethodPost, "/api/backups/rollback", bytes.NewReader(body))
		req.AddCookie(authCookie)
		rr := httptest.NewRecorder()
		handleBackups(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected 400 Bad Request for traversal attempt '%s', got %d", badName, rr.Code)
		}
	}

	// 2. Test rollback with non-existent file
	missingBackupBody, _ := json.Marshal(map[string]string{"filename": "links_99991231_235959.json"})
	reqMissing := httptest.NewRequest(http.MethodPost, "/api/backups/rollback", bytes.NewReader(missingBackupBody))
	reqMissing.AddCookie(authCookie)
	rrMissing := httptest.NewRecorder()
	handleBackups(rrMissing, reqMissing)
	if rrMissing.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for missing backup file, got %d", rrMissing.Code)
	}

	// 3. Test sending corrupted JSON to POST /api/links
	corruptedBody := []byte(`{ not a valid json array }`)
	reqCorrupted := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(corruptedBody))
	reqCorrupted.AddCookie(authCookie)
	rrCorrupted := httptest.NewRecorder()
	handleLinks(rrCorrupted, reqCorrupted)
	if rrCorrupted.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request for corrupted links JSON, got %d", rrCorrupted.Code)
	}

	// 4. Test OPTIONS CORS preflight on /api/links
	reqOptions := httptest.NewRequest(http.MethodOptions, "/api/links", nil)
	rrOptions := httptest.NewRecorder()
	handleLinks(rrOptions, reqOptions)
	if rrOptions.Code != http.StatusNoContent {
		t.Errorf("Expected 204 No Content for OPTIONS, got %d", rrOptions.Code)
	}
	if rrOptions.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Errorf("Expected CORS headers on OPTIONS response")
	}

	// 5. Test Invalid HTTP Method on /api/auth/login (GET instead of POST)
	reqBadMethod := httptest.NewRequest(http.MethodGet, "/api/auth/login", nil)
	rrBadMethod := httptest.NewRecorder()
	handleAuthLogin(rrBadMethod, reqBadMethod)
	if rrBadMethod.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for GET on login endpoint, got %d", rrBadMethod.Code)
	}

	// 6. Test saveLimiter rate limiting on POST /api/links
	attackerSaveIP := "192.0.2.77:4321"
	saveLimiter.RecordSuccess("192.0.2.77")
	for i := 0; i < 25; i++ {
		saveLimiter.RecordFail("192.0.2.77")
	}
	reqSaveLocked := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader([]byte(`[]`)))
	reqSaveLocked.RemoteAddr = attackerSaveIP
	rrSaveLocked := httptest.NewRecorder()
	handleLinks(rrSaveLocked, reqSaveLocked)
	if rrSaveLocked.Code != http.StatusTooManyRequests {
		t.Errorf("Expected 429 for saveLimiter lockout, got %d", rrSaveLocked.Code)
	}
	saveLimiter.RecordSuccess("192.0.2.77") // reset

	// 7. Test SessionStore TTL expiration and cleanup
	shortTTLStore := NewSessionStore(10 * time.Millisecond)
	shortToken := shortTTLStore.Create()
	if !shortTTLStore.Validate(shortToken) {
		t.Errorf("Expected fresh token to be valid")
	}
	time.Sleep(25 * time.Millisecond)
	if shortTTLStore.Validate(shortToken) {
		t.Errorf("Expected expired token to be invalid")
	}
	shortTTLStore.cleanup()

	// 8. Test getClientIP proxy headers
	reqXFF := httptest.NewRequest(http.MethodGet, "/", nil)
	reqXFF.Header.Set("X-Forwarded-For", "203.0.113.195, 70.41.3.18")
	if ip := getClientIP(reqXFF); ip != "203.0.113.195" {
		t.Errorf("Expected 203.0.113.195 from XFF, got %s", ip)
	}

	reqXReal := httptest.NewRequest(http.MethodGet, "/", nil)
	reqXReal.Header.Set("X-Real-IP", "198.51.100.22")
	if ip := getClientIP(reqXReal); ip != "198.51.100.22" {
		t.Errorf("Expected 198.51.100.22 from X-Real-IP, got %s", ip)
	}

	// 9. Test calculateETag and etagMatches
	dataA := []byte(`[{"title":"Math"}]`)
	etagA := calculateETag(dataA)
	if !etagMatches(etagA, etagA) {
		t.Errorf("Expected ETag to match itself")
	}
	if !etagMatches("W/"+etagA, etagA) {
		t.Errorf("Expected weak ETag to match")
	}
	if etagMatches(`"wrong"`, etagA) {
		t.Errorf("Expected different ETags not to match")
	}
}

func TestInternalUtilitiesAndEdgeCases(t *testing.T) {
	// 1. Test getSecret with direct env, file env, and fallback
	if val := getSecret("NON_EXISTENT_KEY_12345", "my_fallback"); val != "my_fallback" {
		t.Errorf("Expected my_fallback, got %s", val)
	}

	os.Setenv("TEST_DIRECT_ENV", "direct_value")
	defer os.Unsetenv("TEST_DIRECT_ENV")
	if val := getSecret("TEST_DIRECT_ENV", "fallback"); val != "direct_value" {
		t.Errorf("Expected direct_value, got %s", val)
	}

	tmpSecretFile, err := os.CreateTemp("", "secret-*.txt")
	if err == nil {
		tmpSecretFile.WriteString("file_secret_value\n")
		tmpSecretFile.Close()
		defer os.Remove(tmpSecretFile.Name())

		os.Setenv("TEST_FILE_ENV_FILE", tmpSecretFile.Name())
		defer os.Unsetenv("TEST_FILE_ENV_FILE")
		if val := getSecret("TEST_FILE_ENV", "fallback"); val != "file_secret_value" {
			t.Errorf("Expected file_secret_value from file, got %s", val)
		}
	}

	// 2. Test findDefaultLinksFile with LINKS_FILE env var
	os.Setenv("LINKS_FILE", "custom_links_path.json")
	defer os.Unsetenv("LINKS_FILE")
	if path := findDefaultLinksFile(); path != "custom_links_path.json" {
		t.Errorf("Expected custom_links_path.json, got %s", path)
	}

	// 3. Test atomicWriteFile
	tmpTargetDir, err := os.MkdirTemp("", "atomic-test-*")
	if err == nil {
		defer os.RemoveAll(tmpTargetDir)
		targetFile := filepath.Join(tmpTargetDir, "atomic.json")
		err = atomicWriteFile(targetFile, []byte(`{"atomic":true}`))
		if err != nil {
			t.Errorf("atomicWriteFile failed: %v", err)
		}
		data, _ := os.ReadFile(targetFile)
		if string(data) != `{"atomic":true}` {
			t.Errorf("Unexpected content after atomicWriteFile: %s", string(data))
		}
	}

	// 4. Test createTimestampedBackup pruning (>10 files)
	tmpBackupSrc, err := os.CreateTemp("", "src-links-*.json")
	if err == nil {
		tmpBackupSrc.WriteString(`[{"title":"BackupTest"}]`)
		tmpBackupSrc.Close()
		defer os.Remove(tmpBackupSrc.Name())

		// Create backups directory and prefill with 12 fake backups
		backupsDir := filepath.Join(filepath.Dir(tmpBackupSrc.Name()), "backups")
		os.MkdirAll(backupsDir, 0755)
		defer os.RemoveAll(backupsDir)

		for i := 0; i < 12; i++ {
			name := filepath.Join(backupsDir, fmt.Sprintf("links_20260101_0000%02d.json", i))
			os.WriteFile(name, []byte(`[]`), 0644)
		}

		createTimestampedBackup(tmpBackupSrc.Name())

		// Verify count is pruned to maxBackupsCount (10)
		entries, _ := os.ReadDir(backupsDir)
		count := 0
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "links_") && strings.HasSuffix(e.Name(), ".json") {
				count++
			}
		}
		if count > 10 {
			t.Errorf("Expected at most 10 backups, found %d", count)
		}
	}

	// 5. Test handleBackups unauthorized request (401)
	reqNoAuth := httptest.NewRequest(http.MethodGet, "/api/backups", nil)
	rrNoAuth := httptest.NewRecorder()
	handleBackups(rrNoAuth, reqNoAuth)
	if rrNoAuth.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 for unauthorized handleBackups, got %d", rrNoAuth.Code)
	}

	// 6. Test rollback with corrupted backup file JSON content
	authSession := sessionStore.Create()
	authCookie := &http.Cookie{Name: "admin_session", Value: authSession}

	dir := filepath.Dir(filePath)
	backupsDir := filepath.Join(dir, "backups")
	os.MkdirAll(backupsDir, 0755)
	corruptBackupName := "links_20260915_999999.json"
	corruptBackupPath := filepath.Join(backupsDir, corruptBackupName)
	os.WriteFile(corruptBackupPath, []byte(`{broken json`), 0644)
	defer os.Remove(corruptBackupPath)

	corruptReqBody, _ := json.Marshal(map[string]string{"filename": corruptBackupName})
	reqCorrupt := httptest.NewRequest(http.MethodPost, "/api/backups/rollback", bytes.NewReader(corruptReqBody))
	reqCorrupt.AddCookie(authCookie)
	rrCorrupt := httptest.NewRecorder()
	handleBackups(rrCorrupt, reqCorrupt)
	if rrCorrupt.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for corrupted backup rollback, got %d", rrCorrupt.Code)
	}

	// 7. Test initAdminHash resolution branches
	os.Setenv("ADMIN_PASSWORD_HASH", "$2a$10$fakehashfortestingonly")
	defer os.Unsetenv("ADMIN_PASSWORD_HASH")
	if h := initAdminHash(); h != "$2a$10$fakehashfortestingonly" {
		t.Errorf("Expected ADMIN_PASSWORD_HASH to be used, got %s", h)
	}
	os.Unsetenv("ADMIN_PASSWORD_HASH")

	os.Setenv("ADMIN_PASSWORD", "plain-test-pass")
	defer os.Unsetenv("ADMIN_PASSWORD")
	hPlain := initAdminHash()
	if err := bcrypt.CompareHashAndPassword([]byte(hPlain), []byte("plain-test-pass")); err != nil {
		t.Errorf("Failed to verify bcrypt hash from plain ADMIN_PASSWORD: %v", err)
	}
	os.Unsetenv("ADMIN_PASSWORD")

	hDev := initAdminHash()
	if err := bcrypt.CompareHashAndPassword([]byte(hDev), []byte("secret123")); err != nil {
		t.Errorf("Failed to verify dev fallback password: %v", err)
	}
}
