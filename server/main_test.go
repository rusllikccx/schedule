package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHandleLinks(t *testing.T) {
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

	filePath = tmpFile.Name()
	adminPassword = "test-password-123"

	// Initialize cache
	if err := cache.LoadFromDisk(filePath); err != nil {
		t.Fatalf("Failed to load cache: %v", err)
	}

	// 1. Test GET /api/links (200 OK + ETag)
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

	// 2. Test GET /api/links with If-None-Match (304 Not Modified)
	req304 := httptest.NewRequest(http.MethodGet, "/api/links", nil)
	req304.Header.Set("If-None-Match", etag)
	rr304 := httptest.NewRecorder()
	handleLinks(rr304, req304)

	if rr304.Code != http.StatusNotModified {
		t.Errorf("Expected status 304 Not Modified, got %d", rr304.Code)
	}
	if rr304.Body.Len() > 0 {
		t.Errorf("Expected empty body for 304, got %d bytes", rr304.Body.Len())
	}

	// 3. Test POST /api/links with wrong password (401 Unauthorized)
	postBody := []byte(`[{"title":"Математика","link":"https://zoom.us/j/999"}]`)
	reqAuthFail := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(postBody))
	reqAuthFail.Header.Set("Authorization", "Bearer wrong-password")
	rrAuthFail := httptest.NewRecorder()
	handleLinks(rrAuthFail, reqAuthFail)

	if rrAuthFail.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401 Unauthorized, got %d", rrAuthFail.Code)
	}

	// 4. Test POST /api/links with correct password (200 OK + new ETag)
	reqAuthOK := httptest.NewRequest(http.MethodPost, "/api/links", bytes.NewReader(postBody))
	reqAuthOK.Header.Set("Authorization", "Bearer test-password-123")
	rrAuthOK := httptest.NewRecorder()
	handleLinks(rrAuthOK, reqAuthOK)

	if rrAuthOK.Code != http.StatusOK {
		t.Errorf("Expected status 200 OK, got %d. Body: %s", rrAuthOK.Code, rrAuthOK.Body.String())
	}

	newETag := rrAuthOK.Header().Get("ETag")
	if newETag == "" || newETag == etag {
		t.Errorf("Expected new distinct ETag, got: %s (old was: %s)", newETag, etag)
	}

	// 5. Test GET /api/links after POST returns updated cache
	reqUpdated := httptest.NewRequest(http.MethodGet, "/api/links", nil)
	rrUpdated := httptest.NewRecorder()
	handleLinks(rrUpdated, reqUpdated)

	if rrUpdated.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rrUpdated.Code)
	}
	if !bytes.Contains(rrUpdated.Body.Bytes(), []byte("Математика")) {
		t.Errorf("Expected updated body to contain 'Математика', got: %s", rrUpdated.Body.String())
	}

	// 6. Test OPTIONS CORS
	reqOptions := httptest.NewRequest(http.MethodOptions, "/api/links", nil)
	rrOptions := httptest.NewRecorder()
	handleLinks(rrOptions, reqOptions)

	if rrOptions.Code != http.StatusNoContent {
		t.Errorf("Expected status 204 for OPTIONS, got %d", rrOptions.Code)
	}
	if rrOptions.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("Expected CORS Access-Control-Allow-Origin header")
	}
}
