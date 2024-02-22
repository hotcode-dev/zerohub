package migration

import "sync"

type Migration interface {
	Migrate(newReleaseURL string)
	IsMigrating() bool
	IsMigratingHubID(hubID string) bool
	AddMigrateHubID(hubID string)
	GetNewReleaseURL() string
}

type migration struct {
	isMigrating     bool
	newReleaseURL   string
	migratingHubIDs map[string]struct{}
	mu              sync.RWMutex
}

func NewMigration() (Migration, error) {
	return &migration{
		isMigrating:     false,
		newReleaseURL:   "",
		migratingHubIDs: make(map[string]struct{}),
	}, nil
}

func (m *migration) Migrate(newReleaseURL string) {
	m.isMigrating = true
	m.newReleaseURL = newReleaseURL
}

func (m *migration) IsMigrating() bool {
	return m.isMigrating
}

func (m *migration) IsMigratingHubID(hubID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if _, ok := m.migratingHubIDs[hubID]; ok {
		return true
	}
	return false
}

func (m *migration) AddMigrateHubID(hubID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.migratingHubIDs[hubID] = struct{}{}
}

func (m *migration) GetNewReleaseURL() string {
	return m.newReleaseURL
}
