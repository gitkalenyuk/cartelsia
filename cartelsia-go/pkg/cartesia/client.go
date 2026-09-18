package cartesia

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"cartelsia/pkg/models"
)

const (
	DefaultBaseURL  = "https://api.cartesia.ai"
	CartesiaVersion = "2024-06-10"
)

type Client struct {
	httpClient *http.Client
	baseURL    string
}

func NewClient(baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		httpClient: &http.Client{Timeout: 90 * time.Second},
		baseURL:    baseURL,
	}
}

func (c *Client) headers(apiKey string) http.Header {
	h := make(http.Header)
	h.Set("Authorization", "Bearer "+apiKey)
	h.Set("Cartesia-Version", CartesiaVersion)
	h.Set("Content-Type", "application/json")
	return h
}

func (c *Client) ValidateKey(apiKey string) (bool, error) {
	body, _ := json.Marshal(map[string]any{
		"grants":     map[string]bool{"tts": true},
		"expires_in": 60,
	})
	req, err := http.NewRequest("POST", c.baseURL+"/access-token", bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header = c.headers(apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return true, nil
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return false, nil
	}
	return false, fmt.Errorf("unexpected status: %d", resp.StatusCode)
}

type rawVoice struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Language       string `json:"language"`
	Gender         string `json:"gender"`
	IsOwner        bool   `json:"is_owner"`
	IsPublic       bool   `json:"is_public"`
	PreviewFileURL string `json:"preview_file_url"`
	CreatedAt      string `json:"created_at"`
}

type voicesResponse struct {
	Data    []rawVoice `json:"data"`
	HasMore bool       `json:"has_more"`
}

func (c *Client) ListVoices(apiKey string) ([]models.CartesiaVoice, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/voices/?limit=1000&expand[]=preview_file_url", nil)
	if err != nil {
		return nil, err
	}
	req.Header = c.headers(apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list voices failed: status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rawList []rawVoice
	if err := json.Unmarshal(bodyBytes, &rawList); err != nil {
		var res voicesResponse
		if err2 := json.Unmarshal(bodyBytes, &res); err2 == nil {
			rawList = res.Data
		} else {
			return nil, fmt.Errorf("decode voices failed: %v", err)
		}
	}

	voices := make([]models.CartesiaVoice, 0, len(rawList))
	for _, v := range rawList {
		voices = append(voices, models.CartesiaVoice{
			ID:          v.ID,
			Name:        v.Name,
			Description: v.Description,
			Language:    v.Language,
			Gender:      v.Gender,
			IsOwner:     v.IsOwner,
			IsPublic:    v.IsPublic,
			PreviewURL:  v.PreviewFileURL,
			CreatedAt:   v.CreatedAt,
		})
	}
	return voices, nil
}

type TTSResponse struct {
	AudioData   []byte
	Format      string
	DurationSec float64
	Timestamps  *models.WordTimestamps
}

func (c *Client) TTSBytes(apiKey, text string, s models.GenerationSettings) (*TTSResponse, error) {
	container := s.Output.Container
	if container == "" {
		container = "mp3"
	}
	sampleRate := s.Output.SampleRate
	if sampleRate == 0 {
		sampleRate = 44100
	}

	var outputFormat map[string]any
	bitRate := s.Output.BitRate
	if bitRate == 0 {
		bitRate = 128000
	}
	if container == "mp3" {
		outputFormat = map[string]any{
			"container":   "mp3",
			"sample_rate": sampleRate,
			"bit_rate":    bitRate,
		}
	} else {
		outputFormat = map[string]any{
			"container":   "wav",
			"encoding":    "pcm_s16le",
			"sample_rate": sampleRate,
		}
	}

	payload := map[string]any{
		"model_id":      s.ModelID,
		"transcript":    text,
		"voice":         map[string]any{"mode": "id", "id": s.VoiceID},
		"output_format": outputFormat,
	}
	if s.Locale != "" {
		payload["locale"] = s.Locale
	} else if s.Language != "" {
		payload["language"] = s.Language
	}

	genConfig := make(map[string]any)
	if s.Speed > 0 && s.Speed != 1.0 {
		genConfig["speed"] = s.Speed
	}
	if s.Volume > 0 && s.Volume != 1.0 {
		genConfig["volume"] = s.Volume
	}
	if s.Emotion != "" && s.Emotion != "neutral" {
		genConfig["emotion"] = s.Emotion
	}
	if len(genConfig) > 0 {
		payload["generation_config"] = genConfig
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", c.baseURL+"/tts/bytes", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header = c.headers(apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("tts error status %d: %s", resp.StatusCode, string(b))
	}

	audioBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var durationSec float64
	if container == "mp3" {
		durationSec = float64(len(audioBytes)*8) / float64(bitRate)
	} else {
		durationSec = float64(len(audioBytes)-44) / float64(sampleRate*2)
		if durationSec < 0 {
			durationSec = 0
		}
	}

	return &TTSResponse{
		AudioData:   audioBytes,
		Format:      container,
		DurationSec: durationSec,
	}, nil
}

// FetchPreviewAudio downloads an audio preview file from a given URL using the active key
func (c *Client) FetchPreviewAudio(apiKey, previewURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", previewURL, nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header = c.headers(apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch preview error status %d: %s", resp.StatusCode, string(b))
	}

	return io.ReadAll(resp.Body)
}
