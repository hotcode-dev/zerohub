package zerohub

import (
	"fmt"
	"testing"
	"time"

	"github.com/bytedance/sonic"
)

func TestHubInterface(t *testing.T) {
	t.Parallel()
}

func BenchmarkHubMarshal(b *testing.B) {
	now := time.Now()

	for _, v := range []int{10, 100, 1000} {
		h := &hub{
			Id:          "id",
			CreatedAt:   now,
			Metadata:    "metadata",
			IsPermanent: true,
			Peers:       make(map[uint32]Peer),
		}

		for i := 0; i < v; i++ {
			h.AddPeer(&peer{
				Id:       uint32(i),
				Metadata: "metadata",
				JoinedAt: now,
			})
		}

		b.Run(fmt.Sprintf("hub_marshal_peer_size_%d", v), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				_, _ = sonic.Marshal(h)
			}
		})
	}
}

func BenchmarkHubAddPeer(b *testing.B) {
	now := time.Now()

	h := &hub{
		Id:          "id",
		CreatedAt:   now,
		Metadata:    "metadata",
		IsPermanent: true,
		Peers:       make(map[uint32]Peer),
	}

	b.Run("benchmark_hub_add_peer", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			h.AddPeer(&peer{
				Metadata: "metadata",
				JoinedAt: now,
			})
		}
	})
}
