package migration

import "sync"

type Migration interface {
	Migrate(newReleaseURL string)
	IsMigrating() bool
	IsMigratingHubId(hubId string) bool
	AddMigrateHubId(hubId string)
	GetNewReleaseHost() string
}

type migration struct {
	isMigrating     bool
	newReleaseHost  string
	migratingHubIds map[string]struct{}
	mu              sync.RWMutex
}

func NewMigration() (Migration, error) {
	return &migration{
		isMigrating:     false,
		newReleaseHost:  "",
		migratingHubIds: make(map[string]struct{}),
	}, nil
}

func (m *migration) Migrate(newReleaseHost string) {
	m.isMigrating = true
	m.newReleaseHost = newReleaseHost
}

func (m *migration) IsMigrating() bool {
	return m.isMigrating
}

func (m *migration) IsMigratingHubId(hubId string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if _, ok := m.migratingHubIds[hubId]; ok {
		return true
	}
	return false
}

func (m *migration) AddMigrateHubId(hubId string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.migratingHubIds[hubId] = struct{}{}
}

func (m *migration) GetNewReleaseHost() string {
	return m.newReleaseHost
}
