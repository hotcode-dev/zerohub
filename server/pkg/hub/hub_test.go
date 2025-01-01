package hub

import (
	"fmt"
	"testing"
	"time"

	"github.com/bytedance/sonic"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/storage"
)

func TestMemoryStorageHubAddPeer(t *testing.T) {
	t.Parallel()

	now := time.Now()

	h := &hub{
		Id:          "id",
		CreatedAt:   now,
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	for i := 0; i < 1000; i++ {
		h.AddPeer(peer.NewPeer(nil, "metadata"))
	}
}

func TestGacheStorageHubAddPeer(t *testing.T) {
	t.Parallel()

	now := time.Now()

	h := &hub{
		Id:          "id",
		CreatedAt:   now,
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewGacheStorage[peer.Peer](),
	}

	for i := 0; i < 1000; i++ {
		h.AddPeer(peer.NewPeer(nil, "metadata"))
	}
}

// goos: darwin
// goarch: arm64
// cpu: Apple M3
// BenchmarkHubMarshal/hub_marshal_peer_size_10-8         	 3912436	       295.5 ns/op	     180 B/op	       3 allocs/op
// BenchmarkHubMarshal/hub_marshal_peer_size_100-8        	 4026879	       297.2 ns/op	     181 B/op	       3 allocs/op
// BenchmarkHubMarshal/hub_marshal_peer_size_1000-8       	 3995517	       300.3 ns/op	     183 B/op	       3 allocs/op
func BenchmarkHubMarshal(b *testing.B) {
	now := time.Now()

	for _, v := range []int{10, 100, 1000} {
		h := &hub{
			Id:          "id",
			CreatedAt:   now,
			Metadata:    "metadata",
			IsPermanent: true,
			PeerStorage: storage.NewMemoryStorage[peer.Peer](),
		}

		for i := 0; i < v; i++ {
			h.AddPeer(peer.NewPeer(nil, "metadata"))
		}

		b.Run(fmt.Sprintf("hub_marshal_peer_size_%d", v), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				_, _ = sonic.Marshal(h)
			}
		})
	}
}

// goos: darwin
// goarch: arm64
// cpu: Apple M3
// BenchmarkHubAddPeer/benchmark_hub_add_peer-8         	   10000	   1616131 ns/op	 4043998 B/op	   25550 allocs/op
func BenchmarkMemoryStorageHubAddPeer(b *testing.B) {
	now := time.Now()

	h := &hub{
		Id:          "id",
		CreatedAt:   now,
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	b.Run("benchmark_hub_add_peer", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			h.AddPeer(peer.NewPeer(nil, "metadata"))
		}
	})
}

// goos: darwin
// goarch: arm64
// cpu: Apple M3
// BenchmarkGacheStorageHubAddPeer/benchmark_hub_add_peer-8         	   10000	   1879501 ns/op	 4088606 B/op	   27604 allocs/op
func BenchmarkGacheStorageHubAddPeer(b *testing.B) {
	now := time.Now()

	h := &hub{
		Id:          "id",
		CreatedAt:   now,
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewGacheStorage[peer.Peer](),
	}

	b.Run("benchmark_hub_add_peer", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			h.AddPeer(peer.NewPeer(nil, "metadata"))
		}
	})
}
