package orchestrator

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cartelsia/pkg/audio"
	"cartelsia/pkg/cartesia"
	"cartelsia/pkg/chunker"
	"cartelsia/pkg/keys"
	"cartelsia/pkg/models"
	"cartelsia/pkg/storage"
	"cartelsia/pkg/subtitles"
)

type Orchestrator struct {
	mu           sync.Mutex
	client       *cartesia.Client
	pool         *keys.PoolManager
	storage      *storage.Storage
	activeJobs   map[string]*Job
	eventEmitter func(models.MainEvent)
}

type Job struct {
	ChatID   string
	CancelCh chan struct{}
	Paused   bool
}

func NewOrchestrator(c *cartesia.Client, p *keys.PoolManager, s *storage.Storage, emitter func(models.MainEvent)) *Orchestrator {
	return &Orchestrator{
		client:       c,
		pool:         p,
		storage:      s,
		activeJobs:   make(map[string]*Job),
		eventEmitter: emitter,
	}
}

func (o *Orchestrator) emitEvent(ev models.MainEvent) {
	if o.eventEmitter != nil {
		o.eventEmitter(ev)
	}
}

func (o *Orchestrator) emitQueueState(chatID, state string, chat *models.Chat, charsUsed int) {
	total := len(chat.Chunks)
	done := 0
	failed := 0
	charsTotal := 0
	for _, c := range chat.Chunks {
		charsTotal += len([]rune(c.Text))
		if c.Status == "done" {
			done++
		} else if c.Status == "failed" || c.Status == "blocked" {
			failed++
		}
	}
	o.emitEvent(models.MainEvent{
		"type": "queue-state",
		"snapshot": models.QueueStateSnapshot{
			ChatID:     chatID,
			State:      state,
			Total:      total,
			Done:       done,
			Failed:     failed,
			CharsUsed:  charsUsed,
			CharsTotal: charsTotal,
		},
	})
}

func (o *Orchestrator) emitChunkStatus(chatID string, chunk models.Chunk) {
	o.emitEvent(models.MainEvent{
		"type":    "chunk-status",
		"chatId":  chatID,
		"chunkId": chunk.ID,
		"chunk":   chunk,
	})
}

func (o *Orchestrator) Preflight(text string, s models.GenerationSettings) models.PreflightEstimate {
	return o.Estimate(text, s)
}

func (o *Orchestrator) Estimate(text string, s models.GenerationSettings) models.PreflightEstimate {
	chunks := chunker.ChunkText(text, s.ChunkSize)
	runes := []rune(text)
	totalChars := len(runes)

	publicKeys := o.pool.ListPublic()
	poolRemaining := 0
	var allocations []models.KeyAllocation
	for _, k := range publicKeys {
		if k.Status == models.KeyStatusActive {
			poolRemaining += k.Remaining
			allocations = append(allocations, models.KeyAllocation{
				KeyID:          k.ID,
				KeyLabel:       k.Label,
				ChunkCount:     0,
				Chars:          0,
				RemainingAfter: k.Remaining,
			})
		}
	}

	feasible := poolRemaining >= totalChars || poolRemaining == 0
	return models.PreflightEstimate{
		TotalChars:     totalChars,
		ChunkCount:     len(chunks),
		PoolRemaining:  poolRemaining,
		Feasible:       feasible,
		FittableChunks: len(chunks),
		Allocations:    allocations,
		BlockedChunks:  []models.BlockedChunk{},
	}
}

func (o *Orchestrator) Start(chatID string) error {
	o.mu.Lock()
	if _, exists := o.activeJobs[chatID]; exists {
		o.mu.Unlock()
		return fmt.Errorf("job already running: %s", chatID)
	}
	job := &Job{
		ChatID:   chatID,
		CancelCh: make(chan struct{}),
	}
	o.activeJobs[chatID] = job
	o.mu.Unlock()

	go o.runJob(job)
	return nil
}

func (o *Orchestrator) Pause(chatID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if job, ok := o.activeJobs[chatID]; ok {
		job.Paused = true
		if chat, err := o.storage.GetChat(chatID); err == nil {
			chat.Status = "paused"
			_ = o.storage.SaveChat(*chat)
			o.emitQueueState(chatID, "paused", chat, 0)
			o.emitEvent(models.MainEvent{
				"type":   "scheduler-paused",
				"chatId": chatID,
				"reason": "user",
			})
		}
	}
}

func (o *Orchestrator) Resume(chatID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if job, ok := o.activeJobs[chatID]; ok {
		job.Paused = false
		if chat, err := o.storage.GetChat(chatID); err == nil {
			chat.Status = "running"
			_ = o.storage.SaveChat(*chat)
			o.emitQueueState(chatID, "running", chat, 0)
		}
	}
}

func (o *Orchestrator) Cancel(chatID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if job, ok := o.activeJobs[chatID]; ok {
		close(job.CancelCh)
		delete(o.activeJobs, chatID)
		if chat, err := o.storage.GetChat(chatID); err == nil {
			chat.Status = "cancelled"
			for i := range chat.Chunks {
				if chat.Chunks[i].Status == "pending" || chat.Chunks[i].Status == "running" || chat.Chunks[i].Status == "waiting-key" {
					chat.Chunks[i].Status = "cancelled"
				}
			}
			_ = o.storage.SaveChat(*chat)
			o.emitQueueState(chatID, "cancelled", chat, 0)
			o.emitEvent(models.MainEvent{
				"type": "chat-updated",
				"chat": *chat,
			})
		}
	}
}

func (o *Orchestrator) runJob(job *Job) {
	defer func() {
		o.mu.Lock()
		delete(o.activeJobs, job.ChatID)
		o.mu.Unlock()
	}()

	chat, err := o.storage.GetChat(job.ChatID)
	if err != nil {
		return
	}

	for i := range chat.Chunks {
		if chat.Chunks[i].Status == "cancelled" || chat.Chunks[i].Status == "waiting-key" {
			chat.Chunks[i].Status = "pending"
		}
	}
	chat.Status = "running"
	_ = o.storage.SaveChat(*chat)

	charsUsed := 0
	var charsMu sync.Mutex

	o.emitEvent(models.MainEvent{
		"type": "chat-updated",
		"chat": *chat,
	})
	o.emitQueueState(chat.ID, "running", chat, charsUsed)

	settings, _ := o.storage.LoadSettings()
	maxWorkers := settings.GlobalConcurrencyCap
	if maxWorkers <= 0 {
		maxWorkers = 4
	}

	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	for i := range chat.Chunks {
		idx := i
		if chat.Chunks[idx].Status == "done" {
			continue
		}

		select {
		case <-job.CancelCh:
			return
		default:
		}

		for job.Paused {
			select {
			case <-job.CancelCh:
				return
			case <-time.After(300 * time.Millisecond):
			}
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(chunkIndex int) {
			defer func() {
				<-sem
				wg.Done()
			}()

			chunkText := chat.Chunks[chunkIndex].Text
			chars := len([]rune(chunkText))

			var key *keys.ManagedKey
			var release func()
			for {
				select {
				case <-job.CancelCh:
					return
				default:
				}
				key, release = o.pool.AcquireAvailableKey(chars)
				if key != nil {
					break
				}
				time.Sleep(150 * time.Millisecond)
			}

			// Chunk is now running
			o.mu.Lock()
			chat.Chunks[chunkIndex].Status = "running"
			chat.Chunks[chunkIndex].RunningKeyLabel = key.Label
			chat.Chunks[chunkIndex].Attempts++
			currentChunk := chat.Chunks[chunkIndex]
			_ = o.storage.SaveChat(*chat)
			o.mu.Unlock()

			o.emitChunkStatus(chat.ID, currentChunk)
			charsMu.Lock()
			currentCharsUsed := charsUsed
			charsMu.Unlock()
			o.emitQueueState(chat.ID, "running", chat, currentCharsUsed)

			resp, err := o.client.TTSBytes(key.Key, chunkText, chat.Settings)
			release()

			if err != nil {
				o.mu.Lock()
				chat.Chunks[chunkIndex].Status = "failed"
				chat.Chunks[chunkIndex].RunningKeyLabel = ""
				chat.Chunks[chunkIndex].LastError = &models.ChunkError{Message: err.Error()}
				failedChunk := chat.Chunks[chunkIndex]
				_ = o.storage.SaveChat(*chat)
				o.mu.Unlock()

				o.emitChunkStatus(chat.ID, failedChunk)
				charsMu.Lock()
				currentCharsUsed = charsUsed
				charsMu.Unlock()
				o.emitQueueState(chat.ID, "running", chat, currentCharsUsed)
				return
			}

			o.pool.RecordUsage(key.ID, chars)
			charsMu.Lock()
			charsUsed += chars
			currentCharsUsed = charsUsed
			charsMu.Unlock()

			vIDBytes := make([]byte, 6)
			rand.Read(vIDBytes)
			vID := hex.EncodeToString(vIDBytes)

			ext := resp.Format
			if ext == "" {
				ext = "mp3"
			}
			fileName := fmt.Sprintf("%s.%s.%s", currentChunk.ID, vID, ext)
			_, _ = o.storage.SaveChunkAudio(chat.ID, fileName, resp.AudioData)

			version := models.ChunkVersion{
				ID:           vID,
				CreatedAt:    time.Now().UTC().Format(time.RFC3339),
				KeyID:        key.ID,
				KeyLabel:     key.Label,
				Settings:     chat.Settings,
				TextSnapshot: chunkText,
				File:         fmt.Sprintf("audio/%s", fileName),
				Format:       ext,
				DurationSec:  resp.DurationSec,
				Timestamps:   resp.Timestamps,
			}

			o.mu.Lock()
			chat.Chunks[chunkIndex].Status = "done"
			chat.Chunks[chunkIndex].RunningKeyLabel = ""
			chat.Chunks[chunkIndex].SelectedVersionID = vID
			chat.Chunks[chunkIndex].Versions = append(chat.Chunks[chunkIndex].Versions, version)
			chat.Chunks[chunkIndex].LastError = nil
			doneChunk := chat.Chunks[chunkIndex]
			_ = o.storage.SaveChat(*chat)
			o.mu.Unlock()

			o.emitChunkStatus(chat.ID, doneChunk)
			o.emitQueueState(chat.ID, "running", chat, currentCharsUsed)
		}(idx)
	}

	wg.Wait()

	okCount := 0
	failedCount := 0
	for _, c := range chat.Chunks {
		if c.Status == "done" {
			okCount++
		} else {
			failedCount++
		}
	}

	if failedCount == 0 {
		chat.Status = "done"
		if chat.Settings.AutoMerge && chat.Settings.Output.Container == "wav" {
			var clips [][]byte
			for _, c := range chat.Chunks {
				for _, v := range c.Versions {
					if v.ID == c.SelectedVersionID {
						chunkAudioPath := filepath.Join(o.storage.DataDir(), "chats", chat.ID, v.File)
						data, err := os.ReadFile(chunkAudioPath)
						if err == nil {
							clips = append(clips, data)
						}
					}
				}
			}
			if len(clips) > 0 {
				opts := audio.WavOptions{
					SampleRate:    chat.Settings.Output.SampleRate,
					Channels:      1,
					BitsPerSample: 16,
				}
				merged := audio.MergeWav(clips, chat.Settings.SilenceMs, opts)
				mergedName := fmt.Sprintf("%s_merged.wav", chat.ID)
				mergedPath, _ := o.storage.SaveAudio(mergedName, merged)
				chat.MergedFilePath = mergedPath
			}
		}

		if chat.Settings.SubtitleMode {
			var allCues []subtitles.Cue
			offset := 0.0
			for _, c := range chat.Chunks {
				for _, v := range c.Versions {
					if v.ID == c.SelectedVersionID && v.Timestamps != nil {
						cues := subtitles.CuesFromTimestamps(v.Timestamps, offset)
						allCues = append(allCues, cues...)
						offset += v.DurationSec + float64(chat.Settings.SilenceMs)/1000.0
					}
				}
			}
			if len(allCues) > 0 {
				srtContent := subtitles.BuildSRT(allCues)
				srtName := fmt.Sprintf("%s_subtitles.srt", chat.ID)
				_, _ = o.storage.SaveAudio(srtName, []byte(srtContent))
			}
		}
	} else {
		chat.Status = "partial"
	}

	_ = o.storage.SaveChat(*chat)

	o.emitEvent(models.MainEvent{
		"type": "chat-updated",
		"chat": *chat,
	})
	o.emitQueueState(chat.ID, "done", chat, charsUsed)
	o.emitEvent(models.MainEvent{
		"type":   "queue-finished",
		"chatId": chat.ID,
		"ok":     okCount,
		"failed": failedCount,
		"chars":  charsUsed,
	})
	if chat.Settings.AutoMerge && failedCount == 0 && okCount > 0 {
		o.emitEvent(models.MainEvent{
			"type":   "merge-requested",
			"chatId": chat.ID,
		})
	}
}

func (o *Orchestrator) GenerateSingleChunk(chatID string, chunkIndex int) (*models.Chunk, error) {
	chat, err := o.storage.GetChat(chatID)
	if err != nil {
		return nil, err
	}
	if chunkIndex < 0 || chunkIndex >= len(chat.Chunks) {
		return nil, fmt.Errorf("invalid chunk index: %d", chunkIndex)
	}

	chunkText := chat.Chunks[chunkIndex].Text
	chars := len([]rune(chunkText))

	key, release := o.pool.AcquireAvailableKey(chars)
	if key == nil {
		return nil, fmt.Errorf("no available keys in pool")
	}
	defer release()

	chat.Chunks[chunkIndex].Status = "running"
	chat.Chunks[chunkIndex].RunningKeyLabel = key.Label
	chat.Chunks[chunkIndex].Attempts++
	_ = o.storage.SaveChat(*chat)
	o.emitChunkStatus(chatID, chat.Chunks[chunkIndex])

	resp, err := o.client.TTSBytes(key.Key, chunkText, chat.Settings)
	if err != nil {
		chat.Chunks[chunkIndex].Status = "failed"
		chat.Chunks[chunkIndex].RunningKeyLabel = ""
		chat.Chunks[chunkIndex].LastError = &models.ChunkError{Message: err.Error()}
		_ = o.storage.SaveChat(*chat)
		o.emitChunkStatus(chatID, chat.Chunks[chunkIndex])
		return nil, err
	}
	o.pool.RecordUsage(key.ID, chars)

	vIDBytes := make([]byte, 6)
	rand.Read(vIDBytes)
	vID := hex.EncodeToString(vIDBytes)

	ext := resp.Format
	if ext == "" {
		ext = "mp3"
	}
	fileName := fmt.Sprintf("%s.%s.%s", chat.Chunks[chunkIndex].ID, vID, ext)
	_, _ = o.storage.SaveChunkAudio(chat.ID, fileName, resp.AudioData)

	version := models.ChunkVersion{
		ID:           vID,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		KeyID:        key.ID,
		KeyLabel:     key.Label,
		Settings:     chat.Settings,
		TextSnapshot: chunkText,
		File:         fmt.Sprintf("audio/%s", fileName),
		Format:       ext,
		DurationSec:  resp.DurationSec,
		Timestamps:   resp.Timestamps,
	}

	chat.Chunks[chunkIndex].Status = "done"
	chat.Chunks[chunkIndex].RunningKeyLabel = ""
	chat.Chunks[chunkIndex].SelectedVersionID = vID
	chat.Chunks[chunkIndex].Versions = append(chat.Chunks[chunkIndex].Versions, version)
	chat.Chunks[chunkIndex].LastError = nil

	_ = o.storage.SaveChat(*chat)
	o.emitChunkStatus(chatID, chat.Chunks[chunkIndex])
	o.emitEvent(models.MainEvent{
		"type": "chat-updated",
		"chat": *chat,
	})

	return &chat.Chunks[chunkIndex], nil
}

func (o *Orchestrator) RetryChunk(chatID, chunkID string) (*models.Chunk, error) {
	chat, err := o.storage.GetChat(chatID)
	if err != nil {
		return nil, err
	}
	chunkIdx := -1
	for i, ch := range chat.Chunks {
		if ch.ID == chunkID {
			chunkIdx = i
			break
		}
	}
	if chunkIdx == -1 {
		return nil, fmt.Errorf("chunk not found: %s", chunkID)
	}

	return o.GenerateSingleChunk(chatID, chunkIdx)
}

func (o *Orchestrator) RevoiceChunk(chatID, chunkID string, overrides *models.GenerationSettings) (*models.Chunk, error) {
	chat, err := o.storage.GetChat(chatID)
	if err != nil {
		return nil, err
	}
	chunkIdx := -1
	for i, ch := range chat.Chunks {
		if ch.ID == chunkID {
			chunkIdx = i
			break
		}
	}
	if chunkIdx == -1 {
		return nil, fmt.Errorf("chunk not found: %s", chunkID)
	}

	if overrides != nil {
		if overrides.VoiceID != "" {
			chat.Settings.VoiceID = overrides.VoiceID
		}
		if overrides.ModelID != "" {
			chat.Settings.ModelID = overrides.ModelID
		}
		if overrides.Speed > 0 {
			chat.Settings.Speed = overrides.Speed
		}
		if overrides.Volume > 0 {
			chat.Settings.Volume = overrides.Volume
		}
		_ = o.storage.SaveChat(*chat)
	}

	return o.GenerateSingleChunk(chatID, chunkIdx)
}

func (o *Orchestrator) UpdateChunkText(chatID, chunkID, text string) (*models.Chunk, error) {
	chat, err := o.storage.GetChat(chatID)
	if err != nil {
		return nil, err
	}
	for i := range chat.Chunks {
		if chat.Chunks[i].ID == chunkID {
			chat.Chunks[i].Text = text
			chat.Chunks[i].TextEditedAfterVoice = true
			_ = o.storage.SaveChat(*chat)
			o.emitChunkStatus(chatID, chat.Chunks[i])
			o.emitEvent(models.MainEvent{
				"type": "chat-updated",
				"chat": *chat,
			})
			return &chat.Chunks[i], nil
		}
	}
	return nil, fmt.Errorf("chunk not found: %s", chunkID)
}

func (o *Orchestrator) SelectVersion(chatID, chunkID, versionID string) (*models.Chunk, error) {
	chat, err := o.storage.GetChat(chatID)
	if err != nil {
		return nil, err
	}
	for i := range chat.Chunks {
		if chat.Chunks[i].ID == chunkID {
			found := false
			for _, v := range chat.Chunks[i].Versions {
				if v.ID == versionID {
					found = true
					break
				}
			}
			if !found {
				return nil, fmt.Errorf("version not found: %s", versionID)
			}
			chat.Chunks[i].SelectedVersionID = versionID
			_ = o.storage.SaveChat(*chat)
			o.emitChunkStatus(chatID, chat.Chunks[i])
			o.emitEvent(models.MainEvent{
				"type": "chat-updated",
				"chat": *chat,
			})
			return &chat.Chunks[i], nil
		}
	}
	return nil, fmt.Errorf("chunk not found: %s", chunkID)
}
