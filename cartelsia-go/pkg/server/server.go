package server

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cartelsia/pkg/cartesia"
	"cartelsia/pkg/chunker"
	"cartelsia/pkg/keys"
	"cartelsia/pkg/models"
	"cartelsia/pkg/orchestrator"
	"cartelsia/pkg/storage"
)

type Server struct {
	port         int
	storage      *storage.Storage
	keys         *keys.PoolManager
	cartesia     *cartesia.Client
	orchestrator *orchestrator.Orchestrator
	sseClients   map[chan []byte]bool
	sseMu        sync.Mutex
	rendererDir  string
}

func NewServer(port int, s *storage.Storage, k *keys.PoolManager, c *cartesia.Client, orch *orchestrator.Orchestrator, rendererDir string) *Server {
	return &Server{
		port:         port,
		storage:      s,
		keys:         k,
		cartesia:     c,
		orchestrator: orch,
		sseClients:   make(map[chan []byte]bool),
		rendererDir:  rendererDir,
	}
}

func (srv *Server) KeysPublic() []models.ApiKeyPublic {
	return srv.keys.ListPublic()
}

func (srv *Server) BroadcastEvent(evt any) {
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	msg := []byte("data: " + string(data) + "\n\n")

	srv.sseMu.Lock()
	defer srv.sseMu.Unlock()
	for client := range srv.sseClients {
		select {
		case client <- msg:
		default:
		}
	}
}

func (srv *Server) Start() error {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/events", srv.handleSSE)
	mux.HandleFunc("/api/ipc", srv.handleIPC)
	mux.HandleFunc("/media/", srv.handleMedia)
	mux.HandleFunc("/", srv.handleStatic)

	addr := fmt.Sprintf("127.0.0.1:%d", srv.port)
	fmt.Printf("[Cartelsia-Go] Server listening on http://%s\n", addr)
	return http.ListenAndServe(addr, mux)
}

func (srv *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	clientChan := make(chan []byte, 64)
	srv.sseMu.Lock()
	srv.sseClients[clientChan] = true
	srv.sseMu.Unlock()

	defer func() {
		srv.sseMu.Lock()
		delete(srv.sseClients, clientChan)
		close(clientChan)
		srv.sseMu.Unlock()
	}()

	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	w.Write([]byte(": connected\n\n"))
	flusher.Flush()

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case msg := <-clientChan:
			w.Write(msg)
			flusher.Flush()
		}
	}
}

func (srv *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Accept-Ranges", "bytes")

	rel := strings.TrimPrefix(r.URL.Path, "/media/")
	var targetFile string

	if strings.HasPrefix(rel, "chunk/") {
		parts := strings.SplitN(strings.TrimPrefix(rel, "chunk/"), "/", 2)
		if len(parts) == 2 {
			chatId, file := parts[0], parts[1]
			// Candidate 1: data/chats/<chatId>/<file>
			c1 := filepath.Join(srv.storage.DataDir(), "chats", chatId, file)
			// Candidate 2: data/chats/<chatId>/audio/<base>
			c2 := filepath.Join(srv.storage.DataDir(), "chats", chatId, "audio", filepath.Base(file))
			// Candidate 3: outputDir / fallback
			c3 := srv.storage.AudioPath(filepath.Base(file))

			if _, err := os.Stat(c1); err == nil {
				targetFile = c1
			} else if _, err := os.Stat(c2); err == nil {
				targetFile = c2
			} else if _, err := os.Stat(c3); err == nil {
				targetFile = c3
			}
		}
	} else if strings.HasPrefix(rel, "sample/") {
		file := strings.TrimPrefix(rel, "sample/")
		if unescaped, err := url.PathUnescape(file); err == nil && unescaped != "" {
			file = unescaped
		}
		candidate := filepath.Join(srv.storage.DataDir(), "previews", file)
		if _, err := os.Stat(candidate); err == nil {
			targetFile = candidate
		} else {
			targetFile = srv.storage.AudioPath(file)
		}
	} else {
		targetFile = srv.storage.AudioPath(rel)
	}

	if targetFile == "" {
		targetFile = srv.storage.AudioPath(rel)
	}

	if _, err := os.Stat(targetFile); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	if strings.HasSuffix(strings.ToLower(targetFile), ".mp3") {
		w.Header().Set("Content-Type", "audio/mpeg")
	} else if strings.HasSuffix(strings.ToLower(targetFile), ".wav") {
		w.Header().Set("Content-Type", "audio/wav")
	}

	http.ServeFile(w, r, targetFile)
}

type ipcRequest struct {
	Channel string            `json:"channel"`
	Args    []json.RawMessage `json:"args"`
}

type ipcResponse struct {
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (srv *Server) handleIPC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req ipcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ipcResponse{Error: err.Error()})
		return
	}

	res, err := srv.dispatch(req.Channel, req.Args)
	if err != nil {
		json.NewEncoder(w).Encode(ipcResponse{Error: err.Error()})
		return
	}
	json.NewEncoder(w).Encode(ipcResponse{Result: res})
}

func (srv *Server) dispatch(channel string, args []json.RawMessage) (any, error) {
	switch channel {
	// Keys
	case "keys:list":
		return srv.keys.ListPublic(), nil

	case "keys:add":
		var p struct {
			Keys  []string `json:"keys"`
			Key   string   `json:"key"`
			Label string   `json:"label"`
			Role  string   `json:"role"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		rawKeys := p.Keys
		if len(rawKeys) == 0 && p.Key != "" {
			rawKeys = []string{p.Key}
		}
		res := srv.keys.AddKeys(rawKeys, p.Label, p.Role)
		srv.BroadcastEvent(models.MainEvent{
			"type": "keys-replaced",
			"keys": srv.keys.ListPublic(),
		})
		return res, nil

	case "keys:importTxt":
		var p struct {
			Content string `json:"content"`
			Text    string `json:"text"`
			Label   string `json:"label"`
			Role    string `json:"role"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		raw := p.Content
		if raw == "" {
			raw = p.Text
		}
		lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
		var keysList []string
		for _, l := range lines {
			t := strings.TrimSpace(l)
			if t != "" {
				keysList = append(keysList, t)
			}
		}
		res := srv.keys.AddKeys(keysList, p.Label, p.Role)
		srv.BroadcastEvent(models.MainEvent{
			"type": "keys-replaced",
			"keys": srv.keys.ListPublic(),
		})
		return res, nil

	case "keys:update":
		var p struct {
			ID    string `json:"id"`
			Patch struct {
				Label *string `json:"label,omitempty"`
				Limit *int    `json:"limit,omitempty"`
			} `json:"patch"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		res, err := srv.keys.UpdateKey(p.ID, p.Patch.Label, p.Patch.Limit)
		if err == nil {
			srv.BroadcastEvent(models.MainEvent{
				"type": "key-updated",
				"key":  *res,
			})
		}
		return res, err

	case "keys:remove":
		var p struct {
			ID string `json:"id"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ID == "" {
				_ = json.Unmarshal(args[0], &p.ID)
			}
		}
		ok := srv.keys.RemoveKey(p.ID)
		srv.BroadcastEvent(models.MainEvent{
			"type": "keys-replaced",
			"keys": srv.keys.ListPublic(),
		})
		return ok, nil

	case "keys:probe":
		var p struct {
			ID         string `json:"id"`
			QuotaProbe bool   `json:"quotaProbe"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.keys.ProbeKey(p.ID, p.QuotaProbe)

	case "keys:freeze":
		var p struct {
			ID          string `json:"id"`
			Reason      string `json:"reason"`
			DurationSec int    `json:"durationSec"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		srv.keys.FreezeKey(p.ID, p.Reason, time.Duration(p.DurationSec)*time.Second)
		srv.BroadcastEvent(models.MainEvent{
			"type": "keys-replaced",
			"keys": srv.keys.ListPublic(),
		})
		return true, nil

	case "keys:unfreeze":
		var id string
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &id)
		}
		srv.keys.UnfreezeKey(id)
		srv.BroadcastEvent(models.MainEvent{
			"type": "keys-replaced",
			"keys": srv.keys.ListPublic(),
		})
		return true, nil

	case "keys:revalidate-all":
		go func() {
			srv.keys.RevalidateAll()
			srv.BroadcastEvent(models.MainEvent{
				"type": "keys-replaced",
				"keys": srv.keys.ListPublic(),
			})
		}()
		return true, nil

	// Chats
	case "chats:list":
		chats, err := srv.storage.LoadChats()
		if err != nil {
			return []models.ChatSummary{}, nil
		}
		summaries := []models.ChatSummary{}
		for _, c := range chats {
			doneCount := 0
			for _, ch := range c.Chunks {
				if ch.Status == "done" {
					doneCount++
				}
			}
			summaries = append(summaries, models.ChatSummary{
				ID:         c.ID,
				Title:      c.Title,
				CreatedAt:  c.CreatedAt,
				Status:     c.Status,
				ChunkCount: len(c.Chunks),
				DoneCount:  doneCount,
			})
		}
		return summaries, nil

	case "chats:get":
		var p struct {
			ID string `json:"id"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ID == "" {
				_ = json.Unmarshal(args[0], &p.ID)
			}
		}
		return srv.storage.GetChat(p.ID)

	case "chats:create":
		var p struct {
			Title    string                    `json:"title"`
			Text     string                    `json:"text"`
			Settings models.GenerationSettings `json:"settings"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		idBytes := make([]byte, 8)
		rand.Read(idBytes)
		id := hex.EncodeToString(idBytes)

		rawChunks := chunker.ChunkText(p.Text, p.Settings.ChunkSize)
		var chunks []models.Chunk
		for i, txt := range rawChunks {
			cIDBytes := make([]byte, 6)
			rand.Read(cIDBytes)
			chunks = append(chunks, models.Chunk{
				ID:       hex.EncodeToString(cIDBytes),
				Index:    i,
				Text:     txt,
				Status:   "pending",
				Versions: []models.ChunkVersion{},
			})
		}

		title := p.Title
		if title == "" {
			runes := []rune(p.Text)
			if len(runes) > 28 {
				title = string(runes[:28]) + "..."
			} else {
				title = string(runes)
			}
		}

		chat := models.Chat{
			ID:         id,
			Title:      title,
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			SourceText: p.Text,
			Status:     "draft",
			Settings:   p.Settings,
			Chunks:     chunks,
		}
		_ = srv.storage.SaveChat(chat)

		estimate := srv.orchestrator.Estimate(p.Text, p.Settings)
		return models.ChatCreateResult{
			Chat:     chat,
			Estimate: estimate,
		}, nil

	case "chats:rename":
		var p struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		chat, err := srv.storage.GetChat(p.ID)
		if err != nil {
			return nil, err
		}
		chat.Title = p.Title
		_ = srv.storage.SaveChat(*chat)
		srv.BroadcastEvent(models.MainEvent{
			"type": "chat-updated",
			"chat": *chat,
		})
		return chat, nil

	case "chats:updateChunkText":
		var p struct {
			ChatID  string `json:"chatId"`
			ChunkID string `json:"chunkId"`
			Text    string `json:"text"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.orchestrator.UpdateChunkText(p.ChatID, p.ChunkID, p.Text)

	case "chats:selectVersion":
		var p struct {
			ChatID    string `json:"chatId"`
			ChunkID   string `json:"chunkId"`
			VersionID string `json:"versionId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.orchestrator.SelectVersion(p.ChatID, p.ChunkID, p.VersionID)

	case "chats:delete":
		var p struct {
			ID string `json:"id"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ID == "" {
				_ = json.Unmarshal(args[0], &p.ID)
			}
		}
		err := srv.storage.DeleteChat(p.ID)
		return err == nil, err

	// TTS
	case "tts:estimate", "tts:preflight":
		var p struct {
			Text     string                    `json:"text"`
			Settings models.GenerationSettings `json:"settings"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.orchestrator.Estimate(p.Text, p.Settings), nil

	case "tts:start":
		var p struct {
			ChatID string `json:"chatId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ChatID == "" {
				_ = json.Unmarshal(args[0], &p.ChatID)
			}
		}
		return true, srv.orchestrator.Start(p.ChatID)

	case "tts:pause":
		var p struct {
			ChatID string `json:"chatId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ChatID == "" {
				_ = json.Unmarshal(args[0], &p.ChatID)
			}
		}
		srv.orchestrator.Pause(p.ChatID)
		return true, nil

	case "tts:resume":
		var p struct {
			ChatID string `json:"chatId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ChatID == "" {
				_ = json.Unmarshal(args[0], &p.ChatID)
			}
		}
		srv.orchestrator.Resume(p.ChatID)
		return true, nil

	case "tts:cancel":
		var p struct {
			ChatID string `json:"chatId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.ChatID == "" {
				_ = json.Unmarshal(args[0], &p.ChatID)
			}
		}
		srv.orchestrator.Cancel(p.ChatID)
		return true, nil

	case "tts:retryChunk":
		var p struct {
			ChatID  string `json:"chatId"`
			ChunkID string `json:"chunkId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.orchestrator.RetryChunk(p.ChatID, p.ChunkID)

	case "tts:revoiceChunk":
		var p struct {
			ChatID    string                     `json:"chatId"`
			ChunkID   string                     `json:"chunkId"`
			Overrides *models.GenerationSettings `json:"overrides"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		return srv.orchestrator.RevoiceChunk(p.ChatID, p.ChunkID, p.Overrides)

	// Audio
	case "audio:saveMerged":
		var p struct {
			ChatID        string `json:"chatId"`
			DataBase64    string `json:"dataBase64"`
			Format        string `json:"format"`
			SuggestedName string `json:"suggestedName"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		filename := p.SuggestedName
		if filename == "" {
			fmtExt := p.Format
			if fmtExt == "" {
				fmtExt = "wav"
			}
			filename = fmt.Sprintf("%s_merged.%s", p.ChatID, fmtExt)
		}
		data, _ := base64.StdEncoding.DecodeString(p.DataBase64)
		outPath, err := srv.storage.SaveAudio(filename, data)
		if err != nil {
			return nil, err
		}
		return map[string]any{"path": outPath}, nil

	case "audio:saveChunk":
		var p struct {
			ChatID string `json:"chatId"`
			File   string `json:"file"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		pPath := srv.storage.AudioPath(p.File)
		return map[string]any{"path": pPath}, nil

	case "audio:readChunk":
		var p struct {
			ChatID string `json:"chatId"`
			File   string `json:"file"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		target := filepath.Join(srv.storage.DataDir(), "chats", p.ChatID, p.File)
		data, err := os.ReadFile(target)
		if err != nil {
			target = filepath.Join(srv.storage.DataDir(), "chats", p.ChatID, "audio", filepath.Base(p.File))
			data, err = os.ReadFile(target)
		}
		if err != nil {
			return nil, err
		}
		return base64.StdEncoding.EncodeToString(data), nil

	case "audio:revealInFolder", "audio:reveal":
		var p struct {
			Path string `json:"path"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.Path == "" {
				_ = json.Unmarshal(args[0], &p.Path)
			}
		}
		target := p.Path
		if !filepath.IsAbs(target) {
			target = srv.storage.AudioPath(target)
		}
		exec.Command("explorer.exe", "/select,", target).Start()
		return true, nil

	// Voices
	case "voices:list":
		activeKey := srv.keys.GetFirstActiveKey()
		if activeKey == "" {
			return models.VoicesListResponse{Data: []models.CartesiaVoice{}}, nil
		}
		voices, err := srv.cartesia.ListVoices(activeKey)
		if err != nil {
			return models.VoicesListResponse{Data: []models.CartesiaVoice{}}, nil
		}
		return models.VoicesListResponse{Data: voices, HasMore: false}, nil

	case "voices:clones:list":
		clones, _ := srv.storage.LoadClones()
		return clones, nil

	case "voices:clone":
		return map[string]any{"error": "Cloning requires active Master Key"}, nil

	case "voices:localize":
		return map[string]any{"error": "Localization requires active Master Key"}, nil

	case "voices:getPreview":
		var p struct {
			VoiceID    string `json:"voiceId"`
			PreviewURL string `json:"previewUrl"`
			Language   string `json:"language"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		if p.VoiceID == "" {
			return map[string]any{"error": "voiceId is required"}, nil
		}
		lang := p.Language
		if lang == "" {
			lang = "uk"
		}
		previewsDir := filepath.Join(srv.storage.DataDir(), "previews")
		_ = os.MkdirAll(previewsDir, 0o755)

		// 1. If previewUrl is provided, download and cache original sample
		if p.PreviewURL != "" {
			fileName := fmt.Sprintf("%s.orig.mp3", p.VoiceID)
			dest := filepath.Join(previewsDir, fileName)
			if _, err := os.Stat(dest); err == nil {
				return map[string]any{"file": fileName, "generated": false}, nil
			}
			activeKey := srv.keys.GetFirstActiveKey()
			if activeKey != "" {
				if data, err := srv.cartesia.FetchPreviewAudio(activeKey, p.PreviewURL); err == nil && len(data) > 0 {
					_ = os.WriteFile(dest, data, 0o644)
					return map[string]any{"file": fileName, "generated": false}, nil
				}
			}
		}

		// 2. Shared voices or voices without previewUrl: generate short sample phrase
		fileName := fmt.Sprintf("%s.%s.mp3", p.VoiceID, lang)
		dest := filepath.Join(previewsDir, fileName)
		if _, err := os.Stat(dest); err == nil {
			return map[string]any{"file": fileName, "generated": true}, nil
		}

		sampleText := sampleTextFor(lang)
		activeKey, keyID := srv.keys.GetFirstActiveKeyAndID()
		if activeKey == "" {
			return nil, fmt.Errorf("немає активного ключа для генерації семплу")
		}
		settings := models.GenerationSettings{
			ModelID:  "sonic-3.6",
			VoiceID:  p.VoiceID,
			Language: lang,
			Output:   models.OutputFormatSetting{Container: "mp3", SampleRate: 44100, BitRate: 128000},
		}
		resp, err := srv.cartesia.TTSBytes(activeKey, sampleText, settings)
		if err != nil {
			return nil, err
		}
		_ = os.WriteFile(dest, resp.AudioData, 0o644)
		if keyID != "" {
			srv.keys.RecordUsage(keyID, len([]rune(sampleText)))
		}
		return map[string]any{"file": fileName, "generated": true}, nil

	case "voices:scanClones":
		return models.ScanClonesResponse{
			Clones:      []models.ClonedVoiceMeta{},
			ScannedKeys: srv.keys.ActiveKeysCount(),
			Errors:      []models.ScanCloneError{},
		}, nil

	case "voices:deleteClone":
		var p struct {
			VoiceID string `json:"voiceId"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
			if p.VoiceID == "" {
				_ = json.Unmarshal(args[0], &p.VoiceID)
			}
		}
		clones, _ := srv.storage.LoadClones()
		var filtered []models.ClonedVoiceMeta
		for _, cl := range clones {
			if cl.ID != p.VoiceID {
				filtered = append(filtered, cl)
			}
		}
		_ = srv.storage.SaveClones(filtered)
		return true, nil

	case "voices:favorites:list":
		favs, _ := srv.storage.LoadFavorites()
		return favs, nil

	case "voices:favorites:toggle":
		var voiceID string
		if len(args) > 0 {
			var p struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(args[0], &p); err == nil && p.ID != "" {
				voiceID = p.ID
			} else {
				_ = json.Unmarshal(args[0], &voiceID)
			}
		}
		favs, _ := srv.storage.LoadFavorites()
		found := false
		var updated []string
		for _, f := range favs {
			if f == voiceID {
				found = true
			} else {
				updated = append(updated, f)
			}
		}
		if !found {
			updated = append(updated, voiceID)
		}
		_ = srv.storage.SaveFavorites(updated)
		return updated, nil

	// Shared Voices (2.1)
	case "shared:list":
		voices, err := srv.storage.LoadSharedVoices()
		if err != nil {
			return []models.SharedVoiceEntry{}, nil
		}
		return voices, nil

	case "shared:add":
		var p struct {
			VoiceID string `json:"voiceId"`
			Alias   string `json:"alias"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		list, _ := srv.storage.LoadSharedVoices()
		entry := models.SharedVoiceEntry{
			Alias:        p.Alias,
			VoiceID:      p.VoiceID,
			RemoteName:   p.Alias,
			Language:     "uk",
			IsOwner:      false,
			Access:       "public",
			AddedAt:      time.Now().UTC().Format(time.RFC3339),
			LastVerified: time.Now().UTC().Format(time.RFC3339),
			Status:       "ok",
		}
		list = append(list, entry)
		_ = srv.storage.SaveSharedVoices(list)
		return map[string]any{"ok": true, "entry": entry}, nil

	case "shared:remove":
		var p struct {
			Alias string `json:"alias"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		list, _ := srv.storage.LoadSharedVoices()
		var filtered []models.SharedVoiceEntry
		for _, v := range list {
			if v.Alias != p.Alias {
				filtered = append(filtered, v)
			}
		}
		_ = srv.storage.SaveSharedVoices(filtered)
		return true, nil

	case "shared:check":
		var p struct {
			Alias string `json:"alias"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		list, _ := srv.storage.LoadSharedVoices()
		var results []models.SharedCheckResult
		for _, v := range list {
			if p.Alias == "" || v.Alias == p.Alias {
				results = append(results, models.SharedCheckResult{
					Alias:   v.Alias,
					VoiceID: v.VoiceID,
					Status:  "ok",
				})
			}
		}
		return results, nil

	// Master Voice Status
	case "master:status":
		settings, _ := srv.storage.LoadSettings()
		configured := settings.MasterApiKey != ""
		return models.MasterStatus{
			Configured: configured,
			Valid:      configured,
			Plan:       "pro",
		}, nil

	case "master:list":
		clones, _ := srv.storage.LoadClones()
		return clones, nil

	case "master:clone":
		return map[string]any{"error": "Master key cloning unavailable"}, nil

	case "master:togglePublic":
		return true, nil

	// Settings & Paths
	case "settings:get":
		return srv.storage.LoadSettings()

	case "settings:set", "settings:save":
		var p struct {
			Patch models.Settings `json:"patch"`
		}
		if len(args) > 0 {
			if err := json.Unmarshal(args[0], &p); err == nil && p.Patch.Defaults.ModelID != "" {
				_ = srv.storage.SaveSettings(p.Patch)
				return p.Patch, nil
			}
			var s models.Settings
			if err := json.Unmarshal(args[0], &s); err == nil {
				_ = srv.storage.SaveSettings(s)
				return s, nil
			}
		}
		return srv.storage.LoadSettings()

	case "paths:get", "settings:get-paths":
		return models.AppPaths{
			DataDir:   srv.storage.DataDir(),
			OutputDir: srv.storage.OutputDir(),
			Portable:  srv.storage.Portable(),
		}, nil

	case "stats:get":
		// 1. Prepare key labels map
		keyLabels := make(map[string]string)
		for _, k := range srv.keys.ListPublic() {
			label := k.Label
			if label == "" {
				label = k.KeyMasked
			}
			keyLabels[k.ID] = label
		}

		// 2. Prepare 30 days array
		const numDays = 30
		now := time.Now().UTC()
		days := make([]models.UsageStatDay, numDays)
		dayIndex := make(map[string]int)
		for i := numDays - 1; i >= 0; i-- {
			d := now.AddDate(0, 0, -(numDays - 1 - i))
			dayStr := d.Format("2006-01-02")
			days[i] = models.UsageStatDay{
				Day:    dayStr,
				PerKey: make(map[string]int),
				Total:  0,
			}
			dayIndex[dayStr] = i
		}

		// 3. Read events from data/usage.jsonl
		totalChars := 0
		monthChars := 0
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

		usageFile := filepath.Join(srv.storage.DataDir(), "usage.jsonl")
		if data, err := os.ReadFile(usageFile); err == nil {
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				var ev struct {
					Ts    string `json:"ts"`
					KeyID string `json:"keyId"`
					Chars int    `json:"chars"`
				}
				if err := json.Unmarshal([]byte(line), &ev); err == nil {
					totalChars += ev.Chars
					t, tErr := time.Parse(time.RFC3339, ev.Ts)
					if tErr == nil && !t.Before(monthStart) {
						monthChars += ev.Chars
					}
					dayStr := ev.Ts
					if len(dayStr) >= 10 {
						dayStr = dayStr[:10]
					}
					if idx, exists := dayIndex[dayStr]; exists {
						days[idx].PerKey[ev.KeyID] += ev.Chars
						days[idx].Total += ev.Chars
					}
				}
			}
		}

		// Fallback to chats if usage.jsonl was empty
		if totalChars == 0 {
			chats, _ := srv.storage.LoadChats()
			for _, c := range chats {
				for _, ch := range c.Chunks {
					if ch.Status == "done" {
						chars := len([]rune(ch.Text))
						totalChars += chars
						monthChars += chars
					}
				}
			}
		}

		// 4. Calculate average per active day
		sumDaysTotal := 0
		activeDays := 0
		for _, d := range days {
			if d.Total > 0 {
				activeDays++
			}
			sumDaysTotal += d.Total
		}
		if activeDays == 0 {
			activeDays = 1
		}
		avgPerDay := sumDaysTotal / activeDays

		return models.StatsSummary{
			TotalChars: totalChars,
			MonthChars: monthChars,
			ActiveKeys: srv.keys.ActiveKeysCount(),
			AvgPerDay:  avgPerDay,
			Days:       days,
			KeyLabels:  keyLabels,
		}, nil

	case "subtitles:export":
		var p struct {
			ChatID string `json:"chatId"`
			Format string `json:"format"`
		}
		if len(args) > 0 {
			_ = json.Unmarshal(args[0], &p)
		}
		srtFile := fmt.Sprintf("%s_subtitles.srt", p.ChatID)
		target := srv.storage.AudioPath(srtFile)
		return models.SubtitlesExportResult{Path: &target}, nil

	// Email & Autoreg stubs
	case "email:testImap":
		return map[string]any{"ok": true}, nil
	case "autoreg:status":
		return map[string]any{"status": "idle", "active": false}, nil
	case "autoreg:stop":
		return true, nil

	// Proxy stubs
	case "proxy:list":
		return []any{}, nil

	case "debug:setKeyUsage":
		return true, nil

	default:
		fmt.Printf("[Cartelsia-Go IPC] Unhandled channel: %s\n", channel)
		return nil, fmt.Errorf("unknown IPC channel: %s", channel)
	}
}

func (srv *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	cleanPath := filepath.Clean(r.URL.Path)
	if cleanPath == "/" || cleanPath == "\\" || cleanPath == "index.html" {
		indexPath := filepath.Join(srv.rendererDir, "index.html")
		http.ServeFile(w, r, indexPath)
		return
	}

	target := filepath.Join(srv.rendererDir, strings.TrimPrefix(cleanPath, "/"))
	if _, err := os.Stat(target); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, target)
}
