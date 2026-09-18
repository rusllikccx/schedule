// Package main serves the schedule sync API.
//
// It stores conference links (Zoom, Google Meet, Teams) in links.json,
// caches them in memory with ETag validation, and provides endpoints
// for the admin dashboard to update links or roll back to previous backups.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// getSecret checks Docker Secrets file convention (<key>_FILE) first,
// then falls back to regular env vars, and finally returns the fallback value.
func getSecret(key, fallback string) string {
	// 1. Check Docker Secrets path
	if filePath := os.Getenv(key + "_FILE"); filePath != "" {
		if data, err := os.ReadFile(filePath); err == nil {
			val := strings.TrimSpace(string(data))
			if val != "" {
				return val
			}
		}
	}
	// 2. Check standard environment variable
	if val := os.Getenv(key); val != "" {
		return strings.TrimSpace(val)
	}
	return fallback
}

// findDefaultLinksFile hunts down links.json depending on where the binary was run from
// (project root, server/ subdirectory, or explicit LINKS_FILE env var).
func findDefaultLinksFile() string {
	if val := getSecret("LINKS_FILE", ""); val != "" {
		return val
	}
	// Current working directory
	if _, err := os.Stat("links.json"); err == nil {
		return "links.json"
	}
	// Running from server/ folder during local dev
	devPath := filepath.Join("..", "src", "lib", "data", "links.json")
	if _, err := os.Stat(devPath); err == nil {
		return devPath
	}
	// Running from project root
	rootDevPath := filepath.Join("src", "lib", "data", "links.json")
	if _, err := os.Stat(rootDevPath); err == nil {
		return rootDevPath
	}
	return "links.json"
}

// initAdminHash grabs the bcrypt hash from env. If someone passed a plaintext password,
// we hash it once on startup so comparisons stay constant-time.
func initAdminHash() string {
	// 1. Check precomputed bcrypt hash
	hash := getSecret("ADMIN_PASSWORD_HASH", "")
	if hash != "" {
		return hash
	}

	// 2. Hash plaintext password if provided
	plainPassword := getSecret("ADMIN_PASSWORD", "")
	if plainPassword != "" {
		log.Println("[SECURITY] Warning: ADMIN_PASSWORD was provided in plain text. Converting to bcrypt hash in memory.")
		h, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("Failed to hash ADMIN_PASSWORD: %v", err)
		}
		return string(h)
	}

	// 3. Fallback for local development
	log.Println("[SECURITY] Notice: No ADMIN_PASSWORD_HASH or ADMIN_PASSWORD set. Using dev default password 'secret123'.")
	h, _ := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	return string(h)
}

var (
	port      = getSecret("PORT", "3001")
	filePath  = findDefaultLinksFile()
	adminHash = ""
	hashOnce  sync.Once
)

// getAdminHash memoizes the bcrypt hash so we don't re-hash or re-read env on every request.
func getAdminHash() string {
	if adminHash != "" {
		return adminHash
	}
	hashOnce.Do(func() {
		adminHash = initAdminHash()
	})
	return adminHash
}

// OnlineLink is a single class link entry stored in links.json.
type OnlineLink struct {
	Title    string `json:"title"`
	Lecturer string `json:"lecturer,omitempty"`
	Link     string `json:"link"`
	Password string `json:"password,omitempty"`
}

// LinksCache holds the raw JSON payload and its ETag in memory so GET /api/links
// doesn't touch the disk on every page reload.
type LinksCache struct {
	mu   sync.RWMutex
	data []byte
	etag string
}

var cache = &LinksCache{}

// calculateETag returns the first 8 bytes of sha256 as a quoted hex string (e.g. "a1b2c3d4e5f60718").
func calculateETag(data []byte) string {
	h := sha256.Sum256(data)
	return `"` + hex.EncodeToString(h[:8]) + `"`
}

// etagMatches does a loose comparison so weak ETags (W/"...") and missing quotes don't break 304 handling.
func etagMatches(clientETag, serverETag string) bool {
	client := strings.TrimSpace(strings.TrimPrefix(clientETag, "W/"))
	server := strings.TrimSpace(strings.TrimPrefix(serverETag, "W/"))
	client = strings.Trim(client, `"`)
	server = strings.Trim(server, `"`)
	return client != "" && client == server
}

// LoadFromDisk populates the cache on startup. If the file is missing or empty, it defaults to [].
func (c *LinksCache) LoadFromDisk(path string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		c.data = []byte("[]")
		c.etag = calculateETag(c.data)
		return err
	}

	c.data = data
	c.etag = calculateETag(data)
	return nil
}

// Get returns the current JSON data and its ETag under a read lock.
func (c *LinksCache) Get() ([]byte, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.data) == 0 {
		return []byte("[]"), calculateETag([]byte("[]"))
	}
	return c.data, c.etag
}

// Set swaps the cached bytes and recomputes the ETag after a successful save or rollback.
func (c *LinksCache) Set(data []byte) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(data) == 0 {
		data = []byte("[]")
	}
	c.data = data
	c.etag = calculateETag(data)
	return c.etag
}

// SessionStore keeps logged-in admin tokens in memory. Good enough for single-instance deploys.
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]time.Time // token -> expiresAt
	ttl      time.Duration
}

// NewSessionStore creates a session store and kicks off a background sweep every 10 mins.
func NewSessionStore(ttl time.Duration) *SessionStore {
	s := &SessionStore{
		sessions: make(map[string]time.Time),
		ttl:      ttl,
	}
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		for range ticker.C {
			s.cleanup()
		}
	}()
	return s
}

// Create generates a 32-byte random hex token with the configured TTL.
func (s *SessionStore) Create() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = time.Now().Add(s.ttl)
	return token
}

// Validate returns true if the token is known and still within its TTL.
func (s *SessionStore) Validate(token string) bool {
	if token == "" {
		return false
	}
	s.mu.RLock()
	expiresAt, exists := s.sessions[token]
	s.mu.RUnlock()

	if !exists || time.Now().After(expiresAt) {
		if exists {
			s.Revoke(token)
		}
		return false
	}
	return true
}

// Revoke deletes the token on logout.
func (s *SessionStore) Revoke(token string) {
	s.mu.Lock()
	delete(s.sessions, token)
	s.mu.Unlock()
}

// cleanup drops dead sessions so the map doesn't leak memory over time.
func (s *SessionStore) cleanup() {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for t, exp := range s.sessions {
		if now.After(exp) {
			delete(s.sessions, t)
		}
	}
}

var sessionStore = NewSessionStore(24 * time.Hour)

// ClientLimit tracks bad attempts and timeout state for a single IP.
type ClientLimit struct {
	fails       int
	lockedUntil time.Time
	lastAttempt time.Time
}

// RateLimiter blocks IPs that spam failed logins or updates.
type RateLimiter struct {
	mu       sync.Mutex
	clients  map[string]*ClientLimit
	maxFails int
	window   time.Duration
	lockTime time.Duration
}

// NewRateLimiter creates a limiter and starts a janitor goroutine to drop stale IPs.
func NewRateLimiter(maxFails int, window, lockTime time.Duration) *RateLimiter {
	rl := &RateLimiter{
		clients:  make(map[string]*ClientLimit),
		maxFails: maxFails,
		window:   window,
		lockTime: lockTime,
	}
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

// IsLocked reports if the IP is currently in timeout, plus how much time is left.
func (rl *RateLimiter) IsLocked(ip string) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	c, ok := rl.clients[ip]
	if !ok {
		return false, 0
	}
	now := time.Now()
	if now.Before(c.lockedUntil) {
		return true, c.lockedUntil.Sub(now)
	}
	return false, 0
}

// RecordFail bumps the failure counter. If it hits maxFails within the window, locks out the IP.
func (rl *RateLimiter) RecordFail(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	c, ok := rl.clients[ip]
	if !ok || now.Sub(c.lastAttempt) > rl.window {
		c = &ClientLimit{fails: 1, lastAttempt: now}
		rl.clients[ip] = c
		return
	}
	c.fails++
	c.lastAttempt = now
	if c.fails >= rl.maxFails {
		c.lockedUntil = now.Add(rl.lockTime)
	}
}

// RecordSuccess resets the counter when the user finally logs in or saves cleanly.
func (rl *RateLimiter) RecordSuccess(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.clients, ip)
}

// cleanup frees memory for IPs that stopped failing long ago.
func (rl *RateLimiter) cleanup() {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for ip, c := range rl.clients {
		if now.After(c.lockedUntil) && now.Sub(c.lastAttempt) > rl.window {
			delete(rl.clients, ip)
		}
	}
}

var (
	// 5 bad passwords in 5 mins = 15 min ban
	loginLimiter = NewRateLimiter(5, 5*time.Minute, 15*time.Minute)
	// 25 failed saves in 5 mins = 5 min cooldown (protects against buggy scripts or brute-force)
	saveLimiter = NewRateLimiter(25, 5*time.Minute, 5*time.Minute)
)

// getClientIP extracts the client IP, inspecting common reverse proxy headers first.
func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xrip := r.Header.Get("X-Real-IP"); xrip != "" {
		return strings.TrimSpace(xrip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// enableCORS sets headers so the frontend can hit the Go API across ports during dev or subdomains.
func enableCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, If-None-Match")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Expose-Headers", "ETag")
}

// extractSessionToken checks the HttpOnly cookie first, then falls back to Authorization: Bearer.
func extractSessionToken(r *http.Request) string {
	// 1. From HttpOnly Cookie
	if cookie, err := r.Cookie("admin_session"); err == nil && cookie.Value != "" {
		return strings.TrimSpace(cookie.Value)
	}
	// 2. From Authorization: Bearer <token>
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return strings.TrimSpace(auth)
}

// LoginRequest is the JSON payload expected on POST /api/auth/login.
type LoginRequest struct {
	Password string `json:"password"`
}

// handleAuthLogin checks the admin password with bcrypt and sets an HttpOnly session cookie.
func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}

	ip := getClientIP(r)
	if locked, remaining := loginLimiter.IsLocked(ip); locked {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		mins := int(remaining.Minutes()) + 1
		w.Write([]byte(fmt.Sprintf(`{"error":"Забагато невдалих спроб. Доступ тимчасово заблоковано на %d хв"}`, mins)))
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"Помилка читання запиту"}`))
		return
	}

	var req LoginRequest
	if err := json.Unmarshal(body, &req); err != nil || req.Password == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"Введіть пароль"}`))
		return
	}

	// Verify against the bcrypt hash
	if err := bcrypt.CompareHashAndPassword([]byte(getAdminHash()), []byte(req.Password)); err != nil {
		loginLimiter.RecordFail(ip)
		// Small sleep to slow down brute-force attacks even before rate limit threshold
		time.Sleep(1 * time.Second)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Невірний пароль адміністратора"}`))
		return
	}

	// Credentials are good
	loginLimiter.RecordSuccess(ip)
	token := sessionStore.Create()

	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "admin_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure,
		MaxAge:   int(24 * time.Hour.Seconds()),
	})

	log.Printf("[AUTH] Успішний вхід адміністратора з IP %s", ip)
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"success":true,"token":"%s"}`, token)))
}

// handleAuthLogout revokes the session token and expires the cookie.
func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}

	token := extractSessionToken(r)
	if token != "" {
		sessionStore.Revoke(token)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "admin_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// handleAuthCheck lets the frontend verify if it is already logged in without triggering an error.
func handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}

	token := extractSessionToken(r)
	authenticated := sessionStore.Validate(token)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"authenticated":%t}`, authenticated)))
}

// atomicWriteFile writes data to a temporary file first, then renames it over targetPath.
// This guarantees we never end up with an empty or half-written file if something crashes.
func atomicWriteFile(targetPath string, data []byte) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmpFile := targetPath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}

	if err := os.Rename(tmpFile, targetPath); err != nil {
		// Fallback for Windows cross-volume rename issues
		if writeErr := os.WriteFile(targetPath, data, 0644); writeErr != nil {
			return writeErr
		}
		_ = os.Remove(tmpFile)
	}
	return nil
}

const maxBackupsCount = 10

// createTimestampedBackup copies sourcePath to backups/links_YYYYMMDD_HHMMSS.json
// and also overwrites links.json.bak for quick inspection.
// It keeps at most 10 revisions to avoid filling up the disk.
func createTimestampedBackup(sourcePath string) {
	data, err := os.ReadFile(sourcePath)
	if err != nil || len(data) == 0 {
		return
	}

	dir := filepath.Dir(sourcePath)
	backupsDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupsDir, 0755); err != nil {
		return
	}

	timestamp := time.Now().Format("20060102_150405")
	backupFileName := fmt.Sprintf("links_%s.json", timestamp)
	backupFilePath := filepath.Join(backupsDir, backupFileName)
	_ = os.WriteFile(backupFilePath, data, 0644)

	// Keep a single .bak in the same directory for quick manual recovery
	_ = os.WriteFile(sourcePath+".bak", data, 0644)

	// Prune older backups beyond maxBackupsCount
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		return
	}

	var backupFiles []os.DirEntry
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "links_") && strings.HasSuffix(e.Name(), ".json") {
			backupFiles = append(backupFiles, e)
		}
	}

	if len(backupFiles) > maxBackupsCount {
		// Filenames use YYYYMMDD_HHMMSS, so alphabetical order is chronological
		toDelete := len(backupFiles) - maxBackupsCount
		for i := 0; i < toDelete; i++ {
			_ = os.Remove(filepath.Join(backupsDir, backupFiles[i].Name()))
		}
	}
}

// BackupInfo is returned by GET /api/backups so the admin UI can show a restore list.
type BackupInfo struct {
	Filename  string `json:"filename"`
	CreatedAt string `json:"createdAt"`
	Size      int64  `json:"size"`
}

// handleBackups handles listing backups (GET) and restoring an older version (POST).
func handleBackups(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	token := extractSessionToken(r)
	if !sessionStore.Validate(token) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Потрібна авторизація адміністратора"}`))
		return
	}

	dir := filepath.Dir(filePath)
	backupsDir := filepath.Join(dir, "backups")

	// GET /api/backups — List available snapshots
	if r.Method == http.MethodGet {
		entries, err := os.ReadDir(backupsDir)
		var list []BackupInfo
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() && strings.HasPrefix(e.Name(), "links_") && strings.HasSuffix(e.Name(), ".json") {
					info, _ := e.Info()
					size := int64(0)
					if info != nil {
						size = info.Size()
					}
					// Parse timestamp from filename: links_YYYYMMDD_HHMMSS.json
					name := e.Name()
					rawTs := strings.TrimSuffix(strings.TrimPrefix(name, "links_"), ".json")
					t, err := time.Parse("20060102_150405", rawTs)
					formattedTs := rawTs
					if err == nil {
						formattedTs = t.Format("02.01.2006 15:04:05")
					}
					list = append(list, BackupInfo{
						Filename:  name,
						CreatedAt: formattedTs,
						Size:      size,
					})
				}
			}
		}

		if list == nil {
			list = []BackupInfo{}
		}

		w.Header().Set("Content-Type", "application/json")
		resp, _ := json.Marshal(list)
		w.Write(resp)
		return
	}

	// POST /api/backups/rollback — Restore a previous backup file
	if r.Method == http.MethodPost {
		var req struct {
			Filename string `json:"filename"`
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 2048))
		if err := json.Unmarshal(body, &req); err != nil || req.Filename == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"Вкажіть файл бекапу для відновлення"}`))
			return
		}

		// Don't let users pass relative paths or directory traversal strings
		safeName := filepath.Base(req.Filename)
		if req.Filename != safeName || !strings.HasPrefix(safeName, "links_") || !strings.HasSuffix(safeName, ".json") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"Некоректне ім'я файлу бекапу"}`))
			return
		}

		targetBackup := filepath.Join(backupsDir, safeName)
		data, err := os.ReadFile(targetBackup)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"Файл бекапу не знайдено"}`))
			return
		}

		// Ensure the file is actually valid links JSON before overwriting current data
		var links []OnlineLink
		if err := json.Unmarshal(data, &links); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"Пошкоджений файл бекапу"}`))
			return
		}

		// Backup the current state first so this rollback can itself be undone
		createTimestampedBackup(filePath)

		// Overwrite current file atomically
		if err := atomicWriteFile(filePath, data); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"Не вдалося відновити файл"}`))
			return
		}

		newETag := cache.Set(data)
		log.Printf("[ADMIN] Успішно відновлено розклад з бекапу %s (посилань: %d)", safeName, len(links))

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", newETag)
		w.Write([]byte(fmt.Sprintf(`{"success":true,"count":%d}`, len(links))))
		return
	}

	http.NotFound(w, r)
}

// handleLinks serves the links JSON:
//   - GET: returns cached data. Responds with 304 if client ETag matches.
//   - POST: verifies admin session, saves new links atomically, and takes a backup snapshot.
func handleLinks(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// 1. GET /api/links — return cached links
	if r.Method == http.MethodGet {
		data, etag := cache.Get()

		// If client sent If-None-Match matching our current ETag, return 304 Not Modified
		if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch != "" && etagMatches(ifNoneMatch, etag) {
			w.Header().Set("ETag", etag)
			w.WriteHeader(http.StatusNotModified)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", etag)
		w.Write(data)
		return
	}

	// 2. POST /api/links — update links
	if r.Method == http.MethodPost {
		ip := getClientIP(r)
		if locked, remaining := saveLimiter.IsLocked(ip); locked {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			mins := int(remaining.Minutes()) + 1
			w.Write([]byte(fmt.Sprintf(`{"error":"Забагато спроб оновлення. Спробуйте через %d хв"}`, mins)))
			return
		}

		token := extractSessionToken(r)

		isValidSession := sessionStore.Validate(token)
		// Allow direct password as fallback for automated CLI scripts or older clients
		if !isValidSession && token != "" {
			if err := bcrypt.CompareHashAndPassword([]byte(getAdminHash()), []byte(token)); err == nil {
				isValidSession = true
			}
		}

		if !isValidSession {
			saveLimiter.RecordFail(ip)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Потрібна авторизація адміністратора"}`))
			return
		}

		// Cap body at 512 KB — links.json is typically just a few kilobytes
		body, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"Помилка читання запиту"}`))
			return
		}

		var links []OnlineLink
		if err := json.Unmarshal(body, &links); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"Некоректний формат JSON"}`))
			return
		}

		formattedData, err := json.MarshalIndent(links, "", "  ")
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"Помилка форматування даних"}`))
			return
		}

		// Save a backup snapshot before writing the new content
		createTimestampedBackup(filePath)

		// Write atomically to avoid corrupting links.json if interrupted
		if err := atomicWriteFile(filePath, formattedData); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"Не вдалося записати файл на сервері"}`))
			return
		}

		newETag := cache.Set(formattedData)
		saveLimiter.RecordSuccess(ip)

		log.Printf("[ADMIN] Успішно оновлено %d посилань (ETag: %s)", len(links), newETag)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", newETag)
		w.Write([]byte(fmt.Sprintf(`{"success":true,"count":%d}`, len(links))))
		return
	}

	http.NotFound(w, r)
}

// monitorParentProcess shuts down the server when the Vite dev server exits.
// Vite dev plugin pipes stdin; when Vite dies, stdin receives EOF and we exit.
// Only active when DEV_MODE=1 to avoid issues in production (Docker, systemd).
func monitorParentProcess() {
	if os.Getenv("DEV_MODE") != "1" {
		return
	}

	go func() {
		buf := make([]byte, 1)
		for {
			_, err := os.Stdin.Read(buf)
			if err != nil {
				os.Exit(0)
			}
		}
	}()
}

// main wires up routes, warms the cache from disk, and handles graceful shutdown on SIGINT/SIGTERM.
func main() {
	hashFlag := flag.String("hash", "", "Generate a bcrypt hash for the provided password and exit")
	flag.Parse()

	if *hashFlag != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*hashFlag), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("Failed to generate bcrypt hash: %v", err)
		}
		fmt.Println(string(hash))
		os.Exit(0)
	}

	absPath, _ := filepath.Abs(filePath)
	log.Printf("Schedule Links API (Go) running on :%s", port)
	log.Printf("Path to links file: %s", absPath)

	// Pre-load links into cache
	if err := cache.LoadFromDisk(filePath); err != nil {
		log.Printf("Warning: Failed to load links from disk: %v", err)
	} else {
		_, etag := cache.Get()
		log.Printf("Links cache initialized (ETag: %s)", etag)
	}

	monitorParentProcess()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/links", handleLinks)
	mux.HandleFunc("/api/auth/login", handleAuthLogin)
	mux.HandleFunc("/api/auth/logout", handleAuthLogout)
	mux.HandleFunc("/api/auth/check", handleAuthCheck)
	mux.HandleFunc("/api/backups", handleBackups)
	mux.HandleFunc("/api/backups/rollback", handleBackups)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server startup failed: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down Schedule Links API server gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown warning: %v", err)
	}
	log.Println("Server exited cleanly.")
}
