package hub

import (
	"fmt"
	"testing"
	"time"

	"github.com/bytedance/sonic"
	websocket "github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"github.com/hotcode-dev/zerohub/pkg/storage"
)

// fakePeer is a peer.Peer that records how many binary messages it receives.
type fakePeer struct {
	id       string
	received int
}

func (p *fakePeer) SendBinaryMessage(data []byte) error {
	p.received++
	return nil
}

func (p *fakePeer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) error {
	panic("not implemented")
}

func (p *fakePeer) SendOffer(offerPeerId string, offerSdp string) error    { return nil }
func (p *fakePeer) SendAnswer(answerPeerId string, answerSdp string) error { return nil }
func (p *fakePeer) GetId() string                                          { return p.id }
func (p *fakePeer) SetId(id string)                                        { p.id = id }
func (p *fakePeer) GetWSConn() *websocket.Conn                             { return nil }
func (p *fakePeer) Close()                                                 {}
func (p *fakePeer) ToProtobuf() *pb.Peer                                   { panic("not implemented") }

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

// TestRemovePeerByIdIdempotent is a regression test for the duplicate
// teardown on clean close: the close handler and the post-HandleMessage
// fallback both call RemovePeerById for the same peer. The second call
// must not broadcast the disconnect signal again and must return false.
func TestRemovePeerByIdIdempotent(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: false,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	leaver := &fakePeer{id: "2"}
	other := &fakePeer{id: "3"}
	h.PeerStorage.Add("2", leaver)
	h.PeerStorage.Add("3", other)

	// First removal: peer present -> broadcast once; hub is not empty yet.
	if got := h.RemovePeerById("2"); got {
		t.Fatalf("first RemovePeerById: want false (peer 3 still in hub), got true")
	}
	if other.received != 1 {
		t.Fatalf("remaining peer received %d disconnect signals after first removal; want 1", other.received)
	}

	// Second removal (the duplicate teardown path): peer already gone ->
	// no extra broadcast, no hub removal.
	if got := h.RemovePeerById("2"); got {
		t.Fatalf("second RemovePeerById: want false (peer not found), got true")
	}
	if other.received != 1 {
		t.Fatalf("remaining peer received %d disconnect signals after duplicate removal; want 1", other.received)
	}
}

// TestRemovePeerByIdLastPeerTwice covers the double RemoveHubById case:
// when the disconnecting peer was the last one, the first call already
// returned true and triggered RemoveHubById; the duplicate second call
// must return false instead of triggering it again.
func TestRemovePeerByIdLastPeerTwice(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: false,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	leaver := &fakePeer{id: "2"}
	h.PeerStorage.Add("2", leaver)

	if got := h.RemovePeerById("2"); !got {
		t.Fatalf("first RemovePeerById for last peer: want true (hub empty), got false")
	}
	if got := h.RemovePeerById("2"); got {
		t.Fatalf("second RemovePeerById for last peer: want false, got true")
	}
}

// TestRemovePeerByIdUnknownPeer is a regression test for the case where a
// peer ID that was never added (or already removed) is passed to
// RemovePeerById: it must be a no-op and return false.
func TestRemovePeerByIdUnknownPeer(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: false,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	other := &fakePeer{id: "3"}
	h.PeerStorage.Add("3", other)

	// Removing a missing peer must not broadcast and must not report the hub as empty.
	if got := h.RemovePeerById("99"); got {
		t.Fatalf("RemovePeerById for unknown peer: want false, got true")
	}
	if other.received != 0 {
		t.Fatalf("remaining peer received %d disconnect signals for unknown peer removal; want 0", other.received)
	}
}
