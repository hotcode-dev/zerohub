package migration

import "sync"

type Migration interface {
	Migrate(newReleaseURL string)
	IsMigrating() bool
	IsMigratingHubID(hubID string) bool
	AddMigrateHubID(hubID string)
	GetNewReleaseHost() string
}

type migration struct {
	isMigrating     bool
	newReleaseHost  string
	migratingHubIDs map[string]struct{}
	mu              sync.RWMutex
}

func NewMigration() (Migration, error) {
	return &migration{
		isMigrating:     false,
		newReleaseHost:  "",
		migratingHubIDs: make(map[string]struct{}),
	}, nil
}

func (m *migration) Migrate(newReleaseHost string) {
	m.isMigrating = true
	m.newReleaseHost = newReleaseHost
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

func (m *migration) GetNewReleaseHost() string {
	return m.newReleaseHost
}
