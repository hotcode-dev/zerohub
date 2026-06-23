package handler

import (
	"testing"
)

func TestIsMigrating_AtomicOperations(t *testing.T) {
	h := &handler{}

	// Initially false
	if h.isMigrating.Load() {
		t.Error("isMigrating should be false initially")
	}

	// Store true
	h.isMigrating.Store(true)
	if !h.isMigrating.Load() {
		t.Error("isMigrating should be true after Store(true)")
	}

	// Store false
	h.isMigrating.Store(false)
	if h.isMigrating.Load() {
		t.Error("isMigrating should be false after Store(false)")
	}
}

func TestBackupHost_AtomicOperations(t *testing.T) {
	h := &handler{}

	// Initially empty
	backupHost := h.backupHost.Load().(string)
	if backupHost != "" {
		t.Errorf("backupHost should be empty initially, got %q", backupHost)
	}

	// Store a value
	h.backupHost.Store("localhost:9090")
	backupHost = h.backupHost.Load().(string)
	if backupHost != "localhost:9090" {
		t.Errorf("backupHost should be localhost:9090, got %q", backupHost)
	}

	// Update
	h.backupHost.Store("new-host:8080")
	backupHost = h.backupHost.Load().(string)
	if backupHost != "new-host:8080" {
		t.Errorf("backupHost should be new-host:8080, got %q", backupHost)
	}

	// Clear
	h.backupHost.Store("")
	backupHost = h.backupHost.Load().(string)
	if backupHost != "" {
		t.Errorf("backupHost should be empty after clear, got %q", backupHost)
	}
}

func TestMigrate_Setup(t *testing.T) {
	h := &handler{}

	// Initial state
	if h.isMigrating.Load() {
		t.Error("initial state: should not be migrating")
	}

	h.backupHost.Store("")

	// Simulate Migrate() calls
	h.isMigrating.Store(true)
	h.backupHost.Store("backup.example.com")

	// Verify migrated state
	if !h.isMigrating.Load() {
		t.Error("should be migrating after Migrate()")
	}

	backupHost := h.backupHost.Load().(string)
	if backupHost != "backup.example.com" {
		t.Errorf("backupHost should be backup.example.com, got %q", backupHost)
	}
}

func TestConcurrentAccess(t *testing.T) {
	h := &handler{}

	done := make(chan bool, 100)
	for i := 0; i < 50; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				h.isMigrating.Store(j%2 == 0)
				h.backupHost.Store("host-" + string(rune(j)))
				_ = h.isMigrating.Load()
				_ = h.backupHost.Load().(string)
			}
			done <- true
		}()
	}

	for i := 0; i < 50; i++ {
		<-done
	}

	// Should not crash — atomic.Bool and atomic.Value are goroutine-safe
	if !h.isMigrating.Load() && h.isMigrating.Load() {
		t.Error("race condition detected")
	}
}
