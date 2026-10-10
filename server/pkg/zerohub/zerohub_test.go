package zerohub

import (
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/hotcode-dev/zerohub/pkg/config"
	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/storage"
)

// goos: darwin
// goarch: arm64
// pkg: github.com/hotcode-dev/zerohub/pkg/zerohub
// cpu: Apple M3
// BenchmarkGacheStorageHubAddPeer/benchmark_zerohub_add_hub-8         	   63687	     16283 ns/op	  193773 B/op	     525 allocs/op
func BenchmarkGacheStorageHubAddPeer(b *testing.B) {
	zh := &zeroHub{
		cfg: &config.Config{
			App: config.AppConfig{
				PeerStorage: "gache",
			},
		},
		HubStorage: storage.NewGacheStorage[hub.Hub](),
	}

	b.Run("benchmark_zerohub_add_hub", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			uid := uuid.NewString()
			if _, err := zh.CreateHubIfAbsent(uid, "metadata", true); err != nil {
				b.Error(err)
			}
			if hub := zh.GetHubById(uid); hub == nil {
				b.Error("hub is nil")
			}
		}
	})
}

// goos: darwin
// goarch: arm64
// pkg: github.com/hotcode-dev/zerohub/pkg/zerohub
// cpu: Apple M3
// BenchmarkMemoryStorageHubAddPeer/benchmark_zerohub_add_hub-8         	 1789338	       635.1 ns/op	     333 B/op	       5 allocs/op
func BenchmarkMemoryStorageHubAddPeer(b *testing.B) {
	zh := &zeroHub{
		cfg: &config.Config{
			App: config.AppConfig{
				PeerStorage: "memory",
			},
		},
		HubStorage: storage.NewMemoryStorage[hub.Hub](),
	}

	b.Run("benchmark_zerohub_add_hub", func(b *testing.B) {

		for i := 0; i < b.N; i++ {
			uid := uuid.NewString()
			if _, err := zh.CreateHubIfAbsent(uid, "metadata", true); err != nil {
				b.Error(err)
			}
			if hub := zh.GetHubById(uid); hub == nil {
				b.Error("hub is nil")
			}
		}
	})
}

// newTestZeroHub builds a zeroHub with the given peer storage backend, mirroring
// NewZeroHub but without the config file requirement.
func newTestZeroHub(t *testing.T, peerStorage string) *zeroHub {
	t.Helper()

	return &zeroHub{
		cfg: &config.Config{
			App: config.AppConfig{
				PeerStorage: peerStorage,
			},
		},
		HubStorage: storage.NewMemoryStorage[hub.Hub](),
	}
}

// TestCreateHubIfAbsentConcurrent proves the invariant that N concurrent
// CreateHubIfAbsent calls for the same ID create exactly ONE hub instance:
// exactly one caller succeeds and every other caller surfaces
// ErrHubAlreadyExists. This is the regression test for the static-hub
// create race: before the atomic primitive, two goroutines interleaving at
// the "is the hub present?" check would each create a hub and the second Add
// would silently overwrite (orphan) the first, splitting the room.
func TestCreateHubIfAbsentConcurrent(t *testing.T) {
	const id = "shared-hub"
	const workers = 200

	zh := newTestZeroHub(t, "memory")

	var wg sync.WaitGroup
	successes := make([]hub.Hub, workers)
	existsErrs := make([]int, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			h, err := zh.CreateHubIfAbsent(id, "metadata", false)
			if err != nil {
				if errors.Is(err, ErrHubAlreadyExists) {
					existsErrs[idx]++
					return
				}
				t.Errorf("CreateHubIfAbsent[%d] returned unexpected error: %v", idx, err)
				return
			}
			successes[idx] = h
		}(i)
	}
	wg.Wait()

	var winner hub.Hub
	successCount := 0
	for i := 0; i < workers; i++ {
		if successes[i] != nil {
			if winner == nil {
				winner = successes[i]
			} else if successes[i] != winner {
				t.Fatalf("distinct hub instances created: %p vs %p", winner, successes[i])
			}
			successCount++
		}
	}

	if successCount != 1 {
		t.Fatalf("expected exactly 1 success, got %d", successCount)
	}
	for i := 0; i < workers; i++ {
		if successes[i] == nil && existsErrs[i] == 0 {
			t.Fatalf("goroutine %d neither succeeded nor got ErrHubAlreadyExists", i)
		}
	}

	// The stored hub must be the single winner.
	if got := zh.GetHubById(id); got != winner {
		t.Fatalf("GetHubById returned %p, want %p", got, winner)
	}
}

// TestCreateHubIfAbsentConcurrentGache runs the same invariant against the
// gache backend so the fix is not memory-storage-specific.
func TestCreateHubIfAbsentConcurrentGache(t *testing.T) {
	const id = "shared-hub"
	const workers = 200

	zh := &zeroHub{
		cfg: &config.Config{
			App: config.AppConfig{
				PeerStorage: "gache",
			},
		},
		HubStorage: storage.NewGacheStorage[hub.Hub](),
	}

	var wg sync.WaitGroup
	successes := make([]hub.Hub, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			h, err := zh.CreateHubIfAbsent(id, "metadata", false)
			if err != nil {
				if !errors.Is(err, ErrHubAlreadyExists) {
					t.Errorf("CreateHubIfAbsent[%d] returned unexpected error: %v", idx, err)
				}
				return
			}
			successes[idx] = h
		}(i)
	}
	wg.Wait()

	var winner hub.Hub
	successCount := 0
	for i := 0; i < workers; i++ {
		if successes[i] != nil {
			if winner == nil {
				winner = successes[i]
			} else if successes[i] != winner {
				t.Fatalf("distinct hub instances created: %p vs %p", winner, successes[i])
			}
			successCount++
		}
	}
	if successCount != 1 {
		t.Fatalf("expected exactly 1 success, got %d", successCount)
	}
	if got := zh.GetHubById(id); got != winner {
		t.Fatalf("GetHubById returned %p, want %p", got, winner)
	}
}

// TestCreateHubIfAbsentReturnsExisting proves a pre-existing hub is
// rejected (not recreated) on a second call, and that distinct IDs stay
// independent.
func TestCreateHubIfAbsentReturnsExisting(t *testing.T) {
	zh := newTestZeroHub(t, "memory")

	first, err := zh.CreateHubIfAbsent("a", "meta-a", false)
	if err != nil {
		t.Fatalf("first CreateHubIfAbsent: %v", err)
	}
	second, err := zh.CreateHubIfAbsent("a", "meta-a", false)
	if !errors.Is(err, ErrHubAlreadyExists) {
		t.Fatalf("second CreateHubIfAbsent: got %v, want ErrHubAlreadyExists", err)
	}
	if second != nil {
		t.Fatalf("second CreateHubIfAbsent returned hub %p, want nil", second)
	}

	other, err := zh.CreateHubIfAbsent("b", "meta-b", false)
	if err != nil {
		t.Fatalf("CreateHubIfAbsent(b): %v", err)
	}
	if first == other {
		t.Fatal("expected distinct hubs for distinct IDs")
	}
}

// TestGetOrCreateHubConcurrent proves the invariant that N concurrent
// GetOrCreateHub calls for the same ID all return the SAME hub instance and
// that GetHubById agrees. This is the regression test for the join-or-create
// race: before the atomic get-or-create, two goroutines interleaving at the
// "is the hub present?" check would each create a hub and the second Add would
// silently overwrite (orphan) the first, so distinct instances were returned.
func TestGetOrCreateHubConcurrent(t *testing.T) {
	const id = "shared-hub"
	const workers = 200

	zh := newTestZeroHub(t, "memory")

	var wg sync.WaitGroup
	hubs := make([]hub.Hub, workers)
	errs := make([]error, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			h, err := zh.GetOrCreateHub(id, "metadata", false)
			hubs[idx] = h
			errs[idx] = err
		}(i)
	}
	wg.Wait()

	// Every goroutine must have succeeded and returned a non-nil hub.
	for i := 0; i < workers; i++ {
		if errs[i] != nil {
			t.Fatalf("GetOrCreateHub[%d] returned error: %v", i, errs[i])
		}
		if hubs[i] == nil {
			t.Fatalf("GetOrCreateHub[%d] returned nil hub", i)
		}
	}

	// All goroutines must have returned the same hub instance (pointer identity).
	for i := 1; i < workers; i++ {
		if hubs[i] != hubs[0] {
			t.Fatalf("hub instance mismatch: goroutine 0 got %p, goroutine %d got %p",
				hubs[0], i, hubs[i])
		}
	}

	// The stored hub must be that same instance.
	if got := zh.GetHubById(id); got != hubs[0] {
		t.Fatalf("GetHubById returned %p, want %p", got, hubs[0])
	}
}

// TestGetOrCreateHubConcurrentGache runs the same invariant against the gache
// backend so the fix is not memory-storage-specific.
func TestGetOrCreateHubConcurrentGache(t *testing.T) {
	const id = "shared-hub"
	const workers = 200

	zh := &zeroHub{
		cfg: &config.Config{
			App: config.AppConfig{
				PeerStorage: "gache",
			},
		},
		HubStorage: storage.NewGacheStorage[hub.Hub](),
	}

	var wg sync.WaitGroup
	hubs := make([]hub.Hub, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			h, err := zh.GetOrCreateHub(id, "metadata", false)
			if err != nil {
				t.Errorf("GetOrCreateHub[%d] returned error: %v", idx, err)
				return
			}
			hubs[idx] = h
		}(i)
	}
	wg.Wait()

	for i := 1; i < workers; i++ {
		if hubs[i] != hubs[0] {
			t.Fatalf("hub instance mismatch: goroutine 0 got %p, goroutine %d got %p",
				hubs[0], i, hubs[i])
		}
	}
}

// TestGetOrCreateHubReturnsExisting proves a pre-existing hub is returned
// untouched (not recreated) on a second call, and that distinct IDs stay
// independent.
func TestGetOrCreateHubReturnsExisting(t *testing.T) {
	zh := newTestZeroHub(t, "memory")

	first, err := zh.GetOrCreateHub("a", "meta-a", false)
	if err != nil {
		t.Fatalf("first GetOrCreateHub: %v", err)
	}
	second, err := zh.GetOrCreateHub("a", "meta-a", false)
	if err != nil {
		t.Fatalf("second GetOrCreateHub: %v", err)
	}
	if first != second {
		t.Fatalf("expected same hub instance, got %p and %p", first, second)
	}

	other, err := zh.GetOrCreateHub("b", "meta-b", false)
	if err != nil {
		t.Fatalf("GetOrCreateHub(b): %v", err)
	}
	if first == other {
		t.Fatal("expected distinct hubs for distinct IDs")
	}
}
