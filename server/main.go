package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func findDefaultLinksFile() string {
	if val := os.Getenv("LINKS_FILE"); val != "" {
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

var (
	port          = getEnv("PORT", "3001")
	adminPassword = strings.TrimSpace(getEnv("ADMIN_PASSWORD", "secret123"))
	filePath      = findDefaultLinksFile()
)

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

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, If-None-Match")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Expose-Headers", "ETag")
}

func handleLinks(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

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

	// 2. POST /api/links — update links JSON with admin password
	if r.Method == http.MethodPost {
		auth := r.Header.Get("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))

		// Timing-attack safe comparison
		if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(adminPassword)) != 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Невірний пароль адміністратора"}`))
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
