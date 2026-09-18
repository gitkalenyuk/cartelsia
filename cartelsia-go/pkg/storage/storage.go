package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"cartelsia/pkg/models"
)

type Storage struct {
	mu        sync.RWMutex
	dataDir   string
	outputDir string
	portable  bool
}

func NewStorage(portable bool) (*Storage, error) {
	var dataDir, outputDir string
	if portable {
		exe, err := os.Executable()
		exeDir := ""
		if err == nil {
			exeDir = filepath.Dir(exe)
		}
		cwd, _ := os.Getwd()

		if exeDir != "" {
			if fi, err := os.Stat(filepath.Join(exeDir, "data")); err == nil && fi.IsDir() {
				dataDir = filepath.Join(exeDir, "data")
				outputDir = filepath.Join(exeDir, "output")
			}
		}
		if dataDir == "" {
			dataDir = filepath.Join(cwd, "data")
			outputDir = filepath.Join(cwd, "output")
		}
	} else {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		dataDir = filepath.Join(appData, "cartelsia")
		outputDir = filepath.Join(os.Getenv("USERPROFILE"), "Downloads", "Cartelsia")
	}

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "chats"), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}

	return &Storage{
		dataDir:   dataDir,
		outputDir: outputDir,
		portable:  portable,
	}, nil
}

func (s *Storage) DataDir() string   { return s.dataDir }
func (s *Storage) OutputDir() string { return s.outputDir }
func (s *Storage) Portable() bool    { return s.portable }

func (s *Storage) LoadKeys() ([]models.ApiKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := filepath.Join(s.dataDir, "keys.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return []models.ApiKey{}, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var keys []models.ApiKey
	if err := json.Unmarshal(data, &keys); err != nil {
		return []models.ApiKey{}, nil
	}
	return keys, nil
}

func (s *Storage) SaveKeys(keys []models.ApiKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := filepath.Join(s.dataDir, "keys.json")
	data, err := json.MarshalIndent(keys, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) LoadSettings() (models.Settings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	defaults := models.Settings{
		Defaults: models.GenerationSettings{
			ModelID:   "sonic-3.6",
			VoiceID:   "a0e99841-438c-4a64-b679-ae501e7d6091",
			ChunkSize: 500,
			Output: models.OutputFormatSetting{
				Container:  "mp3",
				SampleRate: 44100,
				BitRate:    128000,
			},
			SilenceMs: 300,
			AutoMerge: false,
		},
		GlobalConcurrencyCap: 6,
		NotifySystem:         true,
		NotifySound:          true,
	}

	p := filepath.Join(s.dataDir, "settings.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return defaults, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return defaults, nil
	}
	var loaded models.Settings
	if err := json.Unmarshal(data, &loaded); err != nil {
		return defaults, nil
	}
	if loaded.Defaults.ModelID == "" {
		loaded.Defaults = defaults.Defaults
	}
	return loaded, nil
}

func (s *Storage) SaveSettings(settings models.Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := filepath.Join(s.dataDir, "settings.json")
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) LoadChats() ([]models.Chat, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var chats []models.Chat
	seen := make(map[string]bool)

	chatsDir := filepath.Join(s.dataDir, "chats")
	if entries, err := os.ReadDir(chatsDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			chatFile := filepath.Join(chatsDir, entry.Name(), "chat.json")
			data, err := os.ReadFile(chatFile)
			if err != nil {
				continue
			}
			var c models.Chat
			if err := json.Unmarshal(data, &c); err == nil && c.ID != "" {
				for i := range c.Chunks {
					if c.Chunks[i].Status == "running" || c.Chunks[i].Status == "waiting-key" {
						c.Chunks[i].Status = "pending"
					}
				}
				if c.Status == "running" {
					c.Status = "paused"
				}
				chats = append(chats, c)
				seen[c.ID] = true
			}
		}
	}

	chatsJsonPath := filepath.Join(s.dataDir, "chats.json")
	if _, err := os.Stat(chatsJsonPath); err == nil {
		if data, err := os.ReadFile(chatsJsonPath); err == nil {
			var flatList []models.Chat
			if err := json.Unmarshal(data, &flatList); err == nil {
				for _, c := range flatList {
					if !seen[c.ID] {
						chats = append(chats, c)
						seen[c.ID] = true
					}
				}
			}
		}
	}

	sort.Slice(chats, func(i, j int) bool {
		return chats[i].CreatedAt > chats[j].CreatedAt
	})

	return chats, nil
}

func (s *Storage) SaveChat(chat models.Chat) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.dataDir, "chats", chat.ID)
	_ = os.MkdirAll(dir, 0755)
	_ = os.MkdirAll(filepath.Join(dir, "audio"), 0755)

	p := filepath.Join(dir, "chat.json")
	data, err := json.MarshalIndent(chat, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) SaveChunkAudio(chatID, fileName string, data []byte) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.dataDir, "chats", chatID, "audio")
	_ = os.MkdirAll(dir, 0755)

	p := filepath.Join(dir, fileName)
	err := os.WriteFile(p, data, 0644)
	return p, err
}

func (s *Storage) GetChat(id string) (*models.Chat, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := filepath.Join(s.dataDir, "chats", id, "chat.json")
	if data, err := os.ReadFile(p); err == nil {
		var c models.Chat
		if err := json.Unmarshal(data, &c); err == nil {
			return &c, nil
		}
	}

	chats, err := s.LoadChats()
	if err == nil {
		for _, c := range chats {
			if c.ID == id {
				return &c, nil
			}
		}
	}
	return nil, fmt.Errorf("chat not found: %s", id)
}

func (s *Storage) DeleteChat(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.dataDir, "chats", id)
	return os.RemoveAll(dir)
}

func (s *Storage) LoadSharedVoices() ([]models.SharedVoiceEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := filepath.Join(s.dataDir, "shared_voices.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return []models.SharedVoiceEntry{}, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var reg models.SharedVoicesRegistry
	if err := json.Unmarshal(data, &reg); err == nil && len(reg.Entries) > 0 {
		return reg.Entries, nil
	}
	var list []models.SharedVoiceEntry
	if err := json.Unmarshal(data, &list); err == nil {
		return list, nil
	}
	return []models.SharedVoiceEntry{}, nil
}

func (s *Storage) SaveSharedVoices(entries []models.SharedVoiceEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := filepath.Join(s.dataDir, "shared_voices.json")
	reg := models.SharedVoicesRegistry{Entries: entries}
	data, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) LoadClones() ([]models.ClonedVoiceMeta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := filepath.Join(s.dataDir, "clones.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return []models.ClonedVoiceMeta{}, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var clones []models.ClonedVoiceMeta
	if err := json.Unmarshal(data, &clones); err != nil {
		return []models.ClonedVoiceMeta{}, nil
	}
	return clones, nil
}

func (s *Storage) SaveClones(clones []models.ClonedVoiceMeta) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := filepath.Join(s.dataDir, "clones.json")
	data, err := json.MarshalIndent(clones, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) LoadFavorites() ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	p := filepath.Join(s.dataDir, "favorites.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return []string{}, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var favs []string
	if err := json.Unmarshal(data, &favs); err != nil {
		return []string{}, nil
	}
	return favs, nil
}

func (s *Storage) SaveFavorites(favs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := filepath.Join(s.dataDir, "favorites.json")
	data, err := json.MarshalIndent(favs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (s *Storage) SaveAudio(filename string, data []byte) (string, error) {
	p := filepath.Join(s.outputDir, filename)
	err := os.WriteFile(p, data, 0644)
	return p, err
}

func (s *Storage) AudioPath(filename string) string {
	candidate := filepath.Join(s.outputDir, filename)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}

	chatsDir := filepath.Join(s.dataDir, "chats")
	if entries, err := os.ReadDir(chatsDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				chatAudio := filepath.Join(chatsDir, entry.Name(), "audio", filename)
				if _, err := os.Stat(chatAudio); err == nil {
					return chatAudio
				}
			}
		}
	}
	return candidate
}

// NewStorageCustom creates a Storage instance with explicitly provided directories
func NewStorageCustom(dataDir, outputDir string) *Storage {
	_ = os.MkdirAll(dataDir, 0755)
	_ = os.MkdirAll(filepath.Join(dataDir, "chats"), 0755)
	_ = os.MkdirAll(outputDir, 0755)
	return &Storage{
		dataDir:   dataDir,
		outputDir: outputDir,
		portable:  true,
	}
}
