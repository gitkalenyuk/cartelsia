package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"cartelsia/pkg/storage"
)

func TestSampleTextFor(t *testing.T) {
	ukText := sampleTextFor("uk")
	if ukText != "Привіт! Ось так звучить мій голос." {
		t.Fatalf("unexpected uk sample text: %s", ukText)
	}
	enText := sampleTextFor("en")
	if enText != "Hi there! This is how I sound." {
		t.Fatalf("unexpected en sample text: %s", enText)
	}
	defaultText := sampleTextFor("unknown_lang")
	if defaultText != ukText {
		t.Fatalf("expected fallback to uk, got: %s", defaultText)
	}
}

func TestMediaSampleEndpoint(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cartelsia-preview-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	previewsDir := filepath.Join(tempDir, "data", "previews")
	if err := os.MkdirAll(previewsDir, 0755); err != nil {
		t.Fatal(err)
	}

	testFile := "test-voice-id.uk.mp3"
	testContent := []byte("fake-mp3-audio-bytes-for-test")
	if err := os.WriteFile(filepath.Join(previewsDir, testFile), testContent, 0644); err != nil {
		t.Fatal(err)
	}

	store := storage.NewStorageCustom(filepath.Join(tempDir, "data"), tempDir)

	srv := &Server{
		storage: store,
	}

	req := httptest.NewRequest("GET", "/media/sample/"+testFile, nil)
	rec := httptest.NewRecorder()

	srv.handleMedia(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got: %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Fatalf("expected Content-Type audio/mpeg, got: %s", ct)
	}
	if rec.Body.String() != string(testContent) {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestVoicesGetPreviewCached(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cartelsia-cached-preview-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	previewsDir := filepath.Join(tempDir, "data", "previews")
	if err := os.MkdirAll(previewsDir, 0755); err != nil {
		t.Fatal(err)
	}

	voiceID := "myvoice"
	fileName := voiceID + ".uk.mp3"
	if err := os.WriteFile(filepath.Join(previewsDir, fileName), []byte("dummy-audio"), 0644); err != nil {
		t.Fatal(err)
	}

	store := storage.NewStorageCustom(filepath.Join(tempDir, "data"), tempDir)

	srv := &Server{
		storage: store,
	}

	reqPayload, _ := json.Marshal(map[string]any{
		"voiceId":  voiceID,
		"language": "uk",
	})
	res, err := srv.dispatch("voices:getPreview", []json.RawMessage{reqPayload})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m, ok := res.(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %T", res)
	}
	if m["file"] != fileName {
		t.Fatalf("expected file %s, got %v", fileName, m["file"])
	}
	if m["generated"] != true {
		t.Fatalf("expected generated true, got %v", m["generated"])
	}
}
