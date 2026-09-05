package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
	adminPassword = getEnv("ADMIN_PASSWORD", "secret123")
	filePath      = findDefaultLinksFile()
)

type OnlineLink struct {
	Title    string `json:"title"`
	Lecturer string `json:"lecturer,omitempty"`
	Link     string `json:"link"`
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

func handleLinks(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// 1. GET /api/links — return current links JSON
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		data, err := os.ReadFile(filePath)
		if err != nil {
			// If file doesn't exist yet, return empty array
			w.Write([]byte("[]"))
			return
		}
		w.Write(data)
		return
	}

	// 2. POST /api/links — update links JSON with admin password
	if r.Method == http.MethodPost {
		auth := r.Header.Get("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))

		if token == "" || token != adminPassword {
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
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"Не вдалося оновити links.json"}`))
			return
		}

		log.Printf("[ADMIN] Успішно оновлено %d посилань", len(links))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(fmt.Sprintf(`{"success":true,"count":%d}`, len(links))))
		return
	}

	http.NotFound(w, r)
}

func monitorParentProcess() {
	// 1. If stdin is closed by parent process, exit immediately
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

	monitorParentProcess()

	http.HandleFunc("/api/links", handleLinks)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server startup failed: %v", err)
	}
}
