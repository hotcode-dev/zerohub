package zerohub

import (
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
			if _, err := zh.NewHub(uid, "metadata", true); err != nil {
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
			if _, err := zh.NewHub(uid, "metadata", true); err != nil {
				b.Error(err)
			}
			if hub := zh.GetHubById(uid); hub == nil {
				b.Error("hub is nil")
			}
		}
	})
}
