package migration

type Migration interface {
	Migrate(newReleaseURL string)
	IsMigrating() bool
	GetNewReleaseHost() string
}

type migration struct {
	isMigrating    bool
	newReleaseHost string
}

func NewMigration() (Migration, error) {
	return &migration{
		isMigrating:    false,
		newReleaseHost: "",
	}, nil
}

func (m *migration) Migrate(newReleaseHost string) {
	m.isMigrating = true
	m.newReleaseHost = newReleaseHost
}

func (m *migration) IsMigrating() bool {
	return m.isMigrating
}

func (m *migration) GetNewReleaseHost() string {
	return m.newReleaseHost
}
