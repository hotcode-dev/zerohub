package migration

type Migration interface {
	Migrate(backupHost string)
	IsMigrating() bool
	GetBackupHost() string
}

type migration struct {
	isMigrating bool
	backupHost  string
}

func NewMigration() (Migration, error) {
	return &migration{
		isMigrating: false,
		backupHost:  "",
	}, nil
}

func (m *migration) Migrate(backupHost string) {
	m.isMigrating = true
	m.backupHost = backupHost
}

func (m *migration) IsMigrating() bool {
	return m.isMigrating
}

func (m *migration) GetBackupHost() string {
	return m.backupHost
}
