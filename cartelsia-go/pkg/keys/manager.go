package keys

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"cartelsia/pkg/cartesia"
	"cartelsia/pkg/models"
	"cartelsia/pkg/storage"
)

type PoolManager struct {
	mu       sync.RWMutex
	keys     map[string]*ManagedKey
	order    []string
	storage  *storage.Storage
	client   *cartesia.Client
	onChange func()
}

type ManagedKey struct {
	models.ApiKey
	activeSlots int
	slotSem     chan struct{}
}

func NewPoolManager(store *storage.Storage, client *cartesia.Client, onChange func()) *PoolManager {
	pm := &PoolManager{
		keys:     make(map[string]*ManagedKey),
		storage:  store,
		client:   client,
		onChange: onChange,
	}
	pm.load()
	return pm
}

func (pm *PoolManager) load() {
	loaded, err := pm.storage.LoadKeys()
	if err != nil {
		return
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()

	for _, k := range loaded {
		mk := &ManagedKey{
			ApiKey:      k,
			slotSem:     make(chan struct{}, 2),
			activeSlots: 0,
		}
		pm.keys[k.ID] = mk
		pm.order = append(pm.order, k.ID)
	}
}

func (pm *PoolManager) persistLocked() {
	var list []models.ApiKey
	for _, id := range pm.order {
		if mk, ok := pm.keys[id]; ok {
			list = append(list, mk.ApiKey)
		}
	}
	_ = pm.storage.SaveKeys(list)
	if pm.onChange != nil {
		go pm.onChange()
	}
}

func maskKey(k string) string {
	if len(k) <= 12 {
		return k
	}
	return k[:7] + "..." + k[len(k)-4:]
}

func (pm *PoolManager) toPublic(mk *ManagedKey) models.ApiKeyPublic {
	rem := mk.Limit - mk.UsedChars
	if rem < 0 {
		rem = 0
	}
	return models.ApiKeyPublic{
		ID:              mk.ID,
		KeyMasked:       maskKey(mk.Key),
		Label:           mk.Label,
		UsedChars:       mk.UsedChars,
		Limit:           mk.Limit,
		Status:          mk.Status,
		Role:            mk.Role,
		FrozenAt:        mk.FrozenAt,
		FrozenUntil:     mk.FrozenUntil,
		FreezeReason:    mk.FreezeReason,
		CreatedAt:       mk.CreatedAt,
		LastValidatedAt: mk.LastValidatedAt,
		ActiveSlots:     mk.activeSlots,
		Remaining:       rem,
	}
}

func (pm *PoolManager) ListPublic() []models.ApiKeyPublic {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	res := []models.ApiKeyPublic{}
	for _, id := range pm.order {
		if mk, ok := pm.keys[id]; ok {
			res = append(res, pm.toPublic(mk))
		}
	}
	return res
}

func (pm *PoolManager) AddKey(rawKey, label, role string) (models.ApiKeyPublic, error) {
	rawKey = strings.TrimSpace(rawKey)
	idBytes := make([]byte, 8)
	rand.Read(idBytes)
	id := hex.EncodeToString(idBytes)

	now := time.Now().UTC().Format(time.RFC3339)
	k := models.ApiKey{
		ID:        id,
		Key:       rawKey,
		Label:     label,
		Limit:     100000,
		Status:    models.KeyStatusActive,
		Role:      role,
		CreatedAt: now,
	}

	valid, _ := pm.client.ValidateKey(rawKey)
	if valid {
		k.LastValidatedAt = now
	} else {
		k.Status = models.KeyStatusInvalid
	}

	pm.mu.Lock()
	mk := &ManagedKey{
		ApiKey:  k,
		slotSem: make(chan struct{}, 2),
	}
	pm.keys[id] = mk
	pm.order = append(pm.order, id)
	pm.persistLocked()
	pm.mu.Unlock()

	return pm.toPublic(mk), nil
}

func (pm *PoolManager) AddKeys(rawKeys []string, label, role string) models.AddKeysResult {
	var added []models.ApiKeyPublic
	var rejected []models.RejectedKey

	existing := make(map[string]bool)
	pm.mu.RLock()
	for _, mk := range pm.keys {
		existing[mk.Key] = true
	}
	pm.mu.RUnlock()

	for _, rk := range rawKeys {
		trimmed := strings.TrimSpace(rk)
		if trimmed == "" {
			continue
		}
		if existing[trimmed] {
			rejected = append(rejected, models.RejectedKey{Key: trimmed, Reason: "Key already exists"})
			continue
		}

		keyPub, err := pm.AddKey(trimmed, label, role)
		if err != nil {
			rejected = append(rejected, models.RejectedKey{Key: trimmed, Reason: err.Error()})
		} else {
			existing[trimmed] = true
			added = append(added, keyPub)
		}
	}

	return models.AddKeysResult{
		Added:    added,
		Rejected: rejected,
	}
}

func (pm *PoolManager) UpdateKey(id string, label *string, limit *int) (*models.ApiKeyPublic, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	mk, ok := pm.keys[id]
	if !ok {
		return nil, fmt.Errorf("key not found: %s", id)
	}

	if label != nil {
		mk.Label = *label
	}
	if limit != nil {
		mk.Limit = *limit
	}
	pm.persistLocked()
	pub := pm.toPublic(mk)
	return &pub, nil
}

func (pm *PoolManager) ProbeKey(id string, quotaProbe bool) (*models.KeyProbeResult, error) {
	pm.mu.RLock()
	mk, ok := pm.keys[id]
	pm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", id)
	}

	valid, _ := pm.client.ValidateKey(mk.Key)
	now := time.Now().UTC().Format(time.RFC3339)

	pm.mu.Lock()
	if valid {
		mk.Status = models.KeyStatusActive
		mk.LastValidatedAt = now
		mk.FreezeReason = ""
	} else {
		mk.Status = models.KeyStatusInvalid
	}
	pm.persistLocked()
	pub := pm.toPublic(mk)
	pm.mu.Unlock()

	res := &models.KeyProbeResult{
		AuthValid: valid,
		Key:       pub,
	}
	if quotaProbe && valid {
		quota := true
		res.QuotaOk = &quota
	}
	return res, nil
}

func (pm *PoolManager) RemoveKey(id string) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if _, ok := pm.keys[id]; !ok {
		return false
	}
	delete(pm.keys, id)
	var newOrder []string
	for _, oid := range pm.order {
		if oid != id {
			newOrder = append(newOrder, oid)
		}
	}
	pm.order = newOrder
	pm.persistLocked()
	return true
}

func (pm *PoolManager) FreezeKey(id, reason string, duration time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	mk, ok := pm.keys[id]
	if !ok {
		return
	}
	now := time.Now().UTC()
	mk.Status = models.KeyStatusFrozen
	mk.FrozenAt = now.Format(time.RFC3339)
	if duration > 0 {
		mk.FrozenUntil = now.Add(duration).Format(time.RFC3339)
	}
	mk.FreezeReason = reason
	pm.persistLocked()
}

func (pm *PoolManager) UnfreezeKey(id string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	mk, ok := pm.keys[id]
	if !ok {
		return
	}
	mk.Status = models.KeyStatusActive
	mk.FrozenAt = ""
	mk.FrozenUntil = ""
	mk.FreezeReason = ""
	pm.persistLocked()
}

func (pm *PoolManager) RevalidateAll() {
	pm.mu.RLock()
	var keysToTest []*ManagedKey
	for _, mk := range pm.keys {
		keysToTest = append(keysToTest, mk)
	}
	pm.mu.RUnlock()

	var wg sync.WaitGroup
	for _, mk := range keysToTest {
		wg.Add(1)
		go func(m *ManagedKey) {
			defer wg.Done()
			valid, _ := pm.client.ValidateKey(m.Key)
			pm.mu.Lock()
			now := time.Now().UTC().Format(time.RFC3339)
			if valid {
				m.Status = models.KeyStatusActive
				m.LastValidatedAt = now
				m.FreezeReason = ""
			} else {
				m.Status = models.KeyStatusInvalid
			}
			pm.mu.Unlock()
		}(mk)
	}
	wg.Wait()

	pm.mu.Lock()
	pm.persistLocked()
	pm.mu.Unlock()
}

func (pm *PoolManager) AcquireAvailableKey(neededChars int) (*ManagedKey, func()) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now().UTC()

	for _, id := range pm.order {
		mk := pm.keys[id]
		if mk.Status == models.KeyStatusFrozen && mk.FrozenUntil != "" {
			t, err := time.Parse(time.RFC3339, mk.FrozenUntil)
			if err == nil && now.After(t) {
				mk.Status = models.KeyStatusActive
				mk.FrozenAt = ""
				mk.FrozenUntil = ""
				mk.FreezeReason = ""
			}
		}

		if mk.Status != models.KeyStatusActive {
			continue
		}

		select {
		case mk.slotSem <- struct{}{}:
			mk.activeSlots++
			released := false
			release := func() {
				pm.mu.Lock()
				defer pm.mu.Unlock()
				if !released {
					<-mk.slotSem
					mk.activeSlots--
					released = true
					if pm.onChange != nil {
						go pm.onChange()
					}
				}
			}
			return mk, release
		default:
			continue
		}
	}
	return nil, nil
}

func (pm *PoolManager) RecordUsage(id string, chars int) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if mk, ok := pm.keys[id]; ok {
		mk.UsedChars += chars
		pm.persistLocked()
	}
}

func (pm *PoolManager) ActiveKeysCount() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	count := 0
	for _, mk := range pm.keys {
		if mk.Status == models.KeyStatusActive {
			count++
		}
	}
	return count
}

func (pm *PoolManager) GetActiveKeys() []string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	var res []string
	for _, id := range pm.order {
		if mk := pm.keys[id]; mk.Status == models.KeyStatusActive {
			res = append(res, mk.Key)
		}
	}
	return res
}

func (pm *PoolManager) GetFirstActiveKey() string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	for _, id := range pm.order {
		if mk := pm.keys[id]; mk.Status == models.KeyStatusActive {
			return mk.Key
		}
	}
	return ""
}

func (pm *PoolManager) GetFirstActiveKeyAndID() (string, string) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	for _, id := range pm.order {
		if mk := pm.keys[id]; mk.Status == models.KeyStatusActive {
			return mk.Key, mk.ID
		}
	}
	return "", ""
}
