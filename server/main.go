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

func getSecret(key, fallback string) string {
	// 1. Check if a _FILE path is set (Standard Docker Secrets convention)
	if filePath := os.Getenv(key + "_FILE"); filePath != "" {
		if data, err := os.ReadFile(filePath); err == nil {
			val := strings.TrimSpace(string(data))
			if val != "" {
				return val
			}
		}
	}
	// 2. Check direct environment variable
	if val := os.Getenv(key); val != "" {
		return strings.TrimSpace(val)
	}
	return fallback
}

func findDefaultLinksFile() string {
	if val := getSecret("LINKS_FILE", ""); val != "" {
		return val
	}
	// Check current directory
	if _, err := os.Stat("links.json"); err == nil {
		return "links.json"
	}
	// Check dev relative path when running from server/ directory
	devPath := filepath.Join("..", "src", "lib", "data", "links.json")
	if _, err := os.Stat(devPath); err == nil {
		return devPath
	}
	// Check relative path when running from project root
	rootDevPath := filepath.Join("src", "lib", "data", "links.json")
	if _, err := os.Stat(rootDevPath); err == nil {
		return rootDevPath
	}
	return "links.json"
}

func initAdminHash() string {
	// 1. Try to get precomputed Bcrypt hash
	hash := getSecret("ADMIN_PASSWORD_HASH", "")
	if hash != "" {
		return hash
	}

	// 2. Fallback to plaintext password if provided, and hash it in memory
	plainPassword := getSecret("ADMIN_PASSWORD", "")
	if plainPassword != "" {
		log.Println("[SECURITY] Warning: ADMIN_PASSWORD was provided in plain text. Converting to bcrypt hash in memory.")
		h, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("Failed to hash ADMIN_PASSWORD: %v", err)
		}
		return string(h)
	}

	// 3. Default development fallback
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

func getAdminHash() string {
	if adminHash != "" {
		return adminHash
	}
	hashOnce.Do(func() {
		adminHash = initAdminHash()
	})
	return adminHash
}

type OnlineLink struct {
	Title    string `json:"title"`
	Lecturer string `json:"lecturer,omitempty"`
	Link     string `json:"link"`
}

type LinksCache struct {
	mu   sync.RWMutex
	data []byte
	etag string
}

var cache = &LinksCache{}

func calculateETag(data []byte) string {
	h := sha256.Sum256(data)
	return `"` + hex.EncodeToString(h[:8]) + `"`
}

func etagMatches(clientETag, serverETag string) bool {
	client := strings.TrimSpace(strings.TrimPrefix(clientETag, "W/"))
	server := strings.TrimSpace(strings.TrimPrefix(serverETag, "W/"))
	client = strings.Trim(client, `"`)
	server = strings.Trim(server, `"`)
	return client != "" && client == server
}

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

func (c *LinksCache) Get() ([]byte, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.data) == 0 {
		return []byte("[]"), calculateETag([]byte("[]"))
	}
	return c.data, c.etag
}

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

// SessionStore manages active admin sessions with TTL
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]time.Time // token -> expiresAt
	ttl      time.Duration
}

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

func (s *SessionStore) Create() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = time.Now().Add(s.ttl)
	return token
}

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

func (s *SessionStore) Revoke(token string) {
	s.mu.Lock()
	delete(s.sessions, token)
	s.mu.Unlock()
}

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

// RateLimiter tracks login failures per IP to mitigate brute force attacks
type ClientLimit struct {
	fails       int
	lockedUntil time.Time
	lastAttempt time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	clients  map[string]*ClientLimit
	maxFails int
	window   time.Duration
	lockTime time.Duration
}

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

func (rl *RateLimiter) RecordSuccess(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.clients, ip)
}

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

var loginLimiter = NewRateLimiter(5, 5*time.Minute, 15*time.Minute)

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

type LoginRequest struct {
	Password string `json:"password"`
}

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

	// Bcrypt verification
	if err := bcrypt.CompareHashAndPassword([]byte(getAdminHash()), []byte(req.Password)); err != nil {
		loginLimiter.RecordFail(ip)
		time.Sleep(1 * time.Second) // Delay brute force attempts
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Невірний пароль адміністратора"}`))
		return
	}

	// Login successful
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

func handleLinks(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// 1. GET /api/links — return cached links JSON with ETag support
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

	// 2. POST /api/links — update links JSON (requires valid session or fallback direct password)
	if r.Method == http.MethodPost {
		token := extractSessionToken(r)

		isValidSession := sessionStore.Validate(token)
		// Backwards compatibility check: allow direct password verification
		if !isValidSession && token != "" {
			if err := bcrypt.CompareHashAndPassword([]byte(getAdminHash()), []byte(token)); err == nil {
				isValidSession = true
			}
		}

		if !isValidSession {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Потрібна авторизація адміністратора"}`))
			return
		}

		// Read request body up to 512 KB
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

		// Atomic file update: write to tmp file then rename
		tmpFile := filePath + ".tmp"
		if err := os.WriteFile(tmpFile, formattedData, 0644); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"Не вдалося записати файл на сервері"}`))
			return
		}

		if err := os.Rename(tmpFile, filePath); err != nil {
			if writeErr := os.WriteFile(filePath, formattedData, 0644); writeErr != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"Не вдалося оновити links.json"}`))
				return
			}
			_ = os.Remove(tmpFile)
		}

		// Update in-memory cache and get new ETag
		newETag := cache.Set(formattedData)

		log.Printf("[ADMIN] Успішно оновлено %d посилань (ETag: %s)", len(links), newETag)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", newETag)
		w.Write([]byte(fmt.Sprintf(`{"success":true,"count":%d}`, len(links))))
		return
	}

	http.NotFound(w, r)
}

func monitorParentProcess() {
	// Only monitor stdin if DEV_MODE is explicitly enabled (e.g. spawned by Vite dev plugin).
	// In production with systemd or Docker, stdin is closed or /dev/null, so we must not read it.
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

	// Load initial links from disk into in-memory cache
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
