package models

type KeyStatus string

const (
	KeyStatusActive  KeyStatus = "active"
	KeyStatusFrozen  KeyStatus = "frozen"
	KeyStatusInvalid KeyStatus = "invalid"
)

type ApiKey struct {
	ID              string    `json:"id"`
	Key             string    `json:"key"`
	Label           string    `json:"label"`
	UsedChars       int       `json:"usedChars"`
	Limit           int       `json:"limit"`
	Status          KeyStatus `json:"status"`
	Role            string    `json:"role,omitempty"`
	FrozenAt        string    `json:"frozenAt,omitempty"`
	FrozenUntil     string    `json:"frozenUntil,omitempty"`
	FreezeReason    string    `json:"freezeReason,omitempty"`
	CreatedAt       string    `json:"createdAt"`
	LastValidatedAt string    `json:"lastValidatedAt,omitempty"`
}

type ApiKeyPublic struct {
	ID              string    `json:"id"`
	KeyMasked       string    `json:"keyMasked"`
	Label           string    `json:"label"`
	UsedChars       int       `json:"usedChars"`
	Limit           int       `json:"limit"`
	Status          KeyStatus `json:"status"`
	Role            string    `json:"role,omitempty"`
	FrozenAt        string    `json:"frozenAt,omitempty"`
	FrozenUntil     string    `json:"frozenUntil,omitempty"`
	FreezeReason    string    `json:"freezeReason,omitempty"`
	CreatedAt       string    `json:"createdAt"`
	LastValidatedAt string    `json:"lastValidatedAt,omitempty"`
	ActiveSlots     int       `json:"activeSlots"`
	Remaining       int       `json:"remaining"`
}

type RejectedKey struct {
	Key    string `json:"key"`
	Reason string `json:"reason"`
}

type AddKeysResult struct {
	Added    []ApiKeyPublic `json:"added"`
	Rejected []RejectedKey  `json:"rejected"`
}

type KeyProbeResult struct {
	AuthValid bool         `json:"authValid"`
	QuotaOk   *bool        `json:"quotaOk,omitempty"`
	Key       ApiKeyPublic `json:"key"`
}

type KeyAllocation struct {
	KeyID          string `json:"keyId"`
	KeyLabel       string `json:"keyLabel"`
	ChunkCount     int    `json:"chunkCount"`
	Chars          int    `json:"chars"`
	RemainingAfter int    `json:"remainingAfter"`
}

type BlockedChunk struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

type OutputFormatSetting struct {
	Container  string `json:"container"`
	SampleRate int    `json:"sampleRate"`
	BitRate    int    `json:"bitRate,omitempty"`
}

type GenerationSettings struct {
	ModelID          string              `json:"modelId"`
	VoiceID          string              `json:"voiceId"`
	VoiceName        string              `json:"voiceName,omitempty"`
	SharedVoiceAlias string              `json:"sharedVoiceAlias,omitempty"`
	VoiceOwningKeyID string              `json:"voiceOwningKeyId,omitempty"`
	Language         string              `json:"language,omitempty"`
	Locale           string              `json:"locale,omitempty"`
	Speed            float64             `json:"speed,omitempty"`
	Volume           float64             `json:"volume,omitempty"`
	Emotion          string              `json:"emotion,omitempty"`
	ChunkSize        int                 `json:"chunkSize"`
	Output           OutputFormatSetting `json:"output"`
	SubtitleMode     bool                `json:"subtitleMode"`
	SilenceMs        int                 `json:"silenceMs"`
	AutoMerge        bool                `json:"autoMerge"`
}

type WordTimestamps struct {
	Words []string  `json:"words"`
	Start []float64 `json:"start"`
	End   []float64 `json:"end"`
}

type ChunkVersion struct {
	ID           string             `json:"id"`
	CreatedAt    string             `json:"createdAt"`
	KeyID        string             `json:"keyId"`
	KeyLabel     string             `json:"keyLabel"`
	Settings     GenerationSettings `json:"settings"`
	TextSnapshot string             `json:"textSnapshot"`
	File         string             `json:"file"` // e.g. "audio/<chunkId>.<versionId>.<ext>"
	Format       string             `json:"format"`
	DurationSec  float64            `json:"durationSec,omitempty"`
	Timestamps   *WordTimestamps    `json:"timestamps,omitempty"`
}

type ChunkError struct {
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type Chunk struct {
	ID                   string         `json:"id"`
	Index                int            `json:"index"`
	Text                 string         `json:"text"`
	Status               string         `json:"status"` // pending | waiting-key | running | done | failed | blocked | cancelled
	Attempts             int            `json:"attempts"`
	RunningKeyLabel      string         `json:"runningKeyLabel,omitempty"`
	LastError            *ChunkError    `json:"lastError,omitempty"`
	Versions             []ChunkVersion `json:"versions"`
	SelectedVersionID    string         `json:"selectedVersionId,omitempty"`
	TextEditedAfterVoice bool           `json:"textEditedAfterVoice,omitempty"`
}

type Chat struct {
	ID             string             `json:"id"`
	Title          string             `json:"title"`
	CreatedAt      string             `json:"createdAt"`
	SourceText     string             `json:"sourceText,omitempty"`
	Status         string             `json:"status"` // draft | running | paused | done | partial | cancelled
	Settings       GenerationSettings `json:"settings"`
	Chunks         []Chunk            `json:"chunks"`
	MergedFilePath string             `json:"mergedFilePath,omitempty"`
}

type ChatSummary struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	CreatedAt  string `json:"createdAt"`
	Status     string `json:"status"`
	ChunkCount int    `json:"chunkCount"`
	DoneCount  int    `json:"doneCount"`
}

type ChatCreateResult struct {
	Chat     Chat              `json:"chat"`
	Estimate PreflightEstimate `json:"estimate"`
}

type QueueStateSnapshot struct {
	ChatID     string `json:"chatId"`
	State      string `json:"state"` // running | paused | done | cancelled | idle
	Total      int    `json:"total"`
	Done       int    `json:"done"`
	Failed     int    `json:"failed"`
	CharsUsed  int    `json:"charsUsed"`
	CharsTotal int    `json:"charsTotal"`
}

type MainEvent map[string]any

type CartesiaVoice struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Language    string `json:"language"`
	Gender      string `json:"gender,omitempty"`
	IsOwner     bool   `json:"isOwner"`
	IsPublic    bool   `json:"isPublic"`
	PreviewURL  string `json:"previewUrl,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
}

type VoicesListResponse struct {
	Data       []CartesiaVoice `json:"data"`
	HasMore    bool            `json:"hasMore"`
	NextCursor *string         `json:"nextCursor,omitempty"`
}

type VoiceFavorite struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	Language    string `json:"language,omitempty"`
	Gender      string `json:"gender,omitempty"`
	Description string `json:"description,omitempty"`
	PreviewURL  string `json:"previewUrl,omitempty"`
	AddedAt     string `json:"addedAt"`
}

type SharedVoiceEntry struct {
	Alias            string   `json:"alias"`
	VoiceID          string   `json:"voiceId"`
	RemoteName       string   `json:"remoteName"`
	Language         string   `json:"language"`
	Accent           string   `json:"accent,omitempty"`
	IsOwner          bool     `json:"isOwner"`
	Access           string   `json:"access"`
	IsPro            bool     `json:"isPro"`
	CompatibleModels []string `json:"compatibleModels,omitempty"`
	AddedAt          string   `json:"addedAt"`
	LastVerified     string   `json:"lastVerified"`
	Status           string   `json:"status"`
}

type SharedVoicesRegistry struct {
	Entries []SharedVoiceEntry `json:"entries"`
}

type SharedCheckResult struct {
	Alias   string `json:"alias"`
	VoiceID string `json:"voiceId"`
	Status  string `json:"status"`
	Detail  string `json:"detail,omitempty"`
}

type SharedAddResult struct {
	OK    bool              `json:"ok"`
	Entry *SharedVoiceEntry `json:"entry,omitempty"`
	Error string            `json:"error,omitempty"`
}

type ClonedVoiceMeta struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Language       string `json:"language"`
	Description    string `json:"description,omitempty"`
	OwningKeyID    string `json:"owningKeyId"`
	OwningKeyLabel string `json:"owningKeyLabel,omitempty"`
	ClonedAt       string `json:"clonedAt,omitempty"`
	LocalizedFrom  string `json:"localizedFrom,omitempty"`
	ViaMaster      bool   `json:"viaMaster,omitempty"`
}

type ScanCloneError struct {
	KeyLabel string `json:"keyLabel"`
	Message  string `json:"message"`
}

type ScanClonesResponse struct {
	Clones      []ClonedVoiceMeta `json:"clones"`
	ScannedKeys int               `json:"scannedKeys"`
	Errors      []ScanCloneError  `json:"errors"`
}

type MasterStatus struct {
	Configured bool   `json:"configured"`
	Valid      bool   `json:"valid,omitempty"`
	Plan       string `json:"plan,omitempty"`
}

type MasterCloneResult struct {
	Voice      CartesiaVoice `json:"voice"`
	Reused     bool          `json:"reused"`
	MadePublic bool          `json:"madePublic"`
}

type IMAPConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	User string `json:"user"`
	Pass string `json:"pass"`
	TLS  bool   `json:"tls"`
}

type AutoregConfig struct {
	DelayMs           int    `json:"delayMs,omitempty"`
	Engine            string `json:"engine,omitempty"`
	Concurrency       int    `json:"concurrency,omitempty"`
	CaptchaProvider   string `json:"captchaProvider,omitempty"`
	CaptchaApiKey     string `json:"captchaApiKey,omitempty"`
	UseProxy          bool   `json:"useProxy,omitempty"`
	Headless          bool   `json:"headless,omitempty"`
	EmailStyle        string `json:"emailStyle,omitempty"`
	ProxyCheckThreads int    `json:"proxyCheckThreads,omitempty"`
}

type Settings struct {
	Defaults             GenerationSettings `json:"defaults"`
	GlobalConcurrencyCap int                `json:"globalConcurrencyCap,omitempty"`
	NotifySystem         bool               `json:"notifySystem"`
	NotifySound          bool               `json:"notifySound"`
	OutputDirOverride    string             `json:"outputDirOverride,omitempty"`
	CatchAllDomain       string             `json:"catchAllDomain,omitempty"`
	IMAPConfig           *IMAPConfig        `json:"imapConfig,omitempty"`
	Autoreg              *AutoregConfig     `json:"autoreg,omitempty"`
	MasterConcurrency    int                `json:"masterConcurrency,omitempty"`
	MasterApiKey         string             `json:"masterApiKey,omitempty"`
}

type ProxyEntry struct {
	URL         string `json:"url"`
	Status      string `json:"status"` // unchecked | working | dead | checking
	LastChecked string `json:"lastChecked,omitempty"`
	LatencyMs   int    `json:"latencyMs,omitempty"`
}

type ProxiesFile struct {
	Proxies []ProxyEntry `json:"proxies"`
}

type AppPaths struct {
	DataDir   string `json:"dataDir"`
	OutputDir string `json:"outputDir"`
	Portable  bool   `json:"portable"`
}

type PreflightEstimate struct {
	TotalChars     int             `json:"totalChars"`
	ChunkCount     int             `json:"chunkCount"`
	PoolRemaining  int             `json:"poolRemaining"`
	Feasible       bool            `json:"feasible"`
	FittableChunks int             `json:"fittableChunks"`
	Allocations    []KeyAllocation `json:"allocations"`
	BlockedChunks  []BlockedChunk  `json:"blockedChunks"`
}

type UsageStatDay struct {
	Day    string         `json:"day"`
	PerKey map[string]int `json:"perKey"`
	Total  int            `json:"total"`
}

type StatsSummary struct {
	TotalChars int               `json:"totalChars"`
	MonthChars int               `json:"monthChars"`
	ActiveKeys int               `json:"activeKeys"`
	AvgPerDay  int               `json:"avgPerDay"`
	Days       []UsageStatDay    `json:"days"`
	KeyLabels  map[string]string `json:"keyLabels"`
}

type SavePathResult struct {
	Path *string `json:"path"`
}

type SubtitlesExportResult struct {
	Path  *string `json:"path"`
	Error string  `json:"error,omitempty"`
}
