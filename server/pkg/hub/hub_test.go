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
	// sentHubInfo reports whether SendHubInfo was called.
	sentHubInfo bool
	// protoOverride, if non-nil, is returned by ToProtobuf and lets a test
	// force the join-signal marshal path to fail (an invalid-UTF-8 Id makes
	// proto.Marshal of the resulting PeerJoinedMessage return an error).
	protoOverride *pb.Peer
}

func (p *fakePeer) SendBinaryMessage(data []byte) error {
	p.received++
	return nil
}

func (p *fakePeer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) error {
	p.sentHubInfo = true
	return nil
}

func (p *fakePeer) SendOffer(offerPeerId string, offerSdp string) error    { return nil }
func (p *fakePeer) SendAnswer(answerPeerId string, answerSdp string) error { return nil }
func (p *fakePeer) GetId() string                                          { return p.id }
func (p *fakePeer) SetId(id string)                                        { p.id = id }
func (p *fakePeer) GetWSConn() *websocket.Conn                             { return nil }
func (p *fakePeer) Close()                                                 {}
func (p *fakePeer) ToProtobuf() *pb.Peer {
	if p.protoOverride != nil {
		return p.protoOverride
	}
	return &pb.Peer{Id: p.id}
}

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

// TestAddPeerMarshalFailureLeavesNoOrphan is a regression test for the
// inverted ordering in AddPeer: the join signal used to be marshaled AFTER
// the peer was already registered in PeerStorage. On a marshal failure the
// early return left a half-registered orphan (ID assigned, present in
// storage) that was never announced and never received its HubInfo. The join
// signal must now be marshaled before any state is mutated, so a failure is a
// complete no-op.
func TestAddPeerMarshalFailureLeavesNoOrphan(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	// A peer already in the hub; a successful add would broadcast to it.
	existing := &fakePeer{id: "5"}
	h.PeerStorage.Add("5", existing)

	// newPeer.ToProtobuf returns a Peer whose Id is not valid UTF-8, so
	// CreateJoinedSignalProtobuf -> proto.Marshal fails deterministically
	// without mocking the package-level helper.
	newPeer := &fakePeer{protoOverride: &pb.Peer{Id: "\xff\xfe\x01"}}

	h.AddPeer(newPeer)

	// The new peer was assigned an ID ("1") but must NOT be in storage.
	if _, err := h.PeerStorage.Get(newPeer.GetId()); err == nil {
		t.Fatalf("new peer %q present in PeerStorage after a marshal failure", newPeer.GetId())
	}

	// Storage must still hold only the pre-existing peer.
	var ids []string
	for p := range h.PeerStorage.GetAll() {
		ids = append(ids, p.GetId())
	}
	if len(ids) != 1 || ids[0] != "5" {
		t.Fatalf("PeerStorage holds %v after marshal failure; want only [5]", ids)
	}

	// No join signal should have been broadcast to the existing peer.
	if existing.received != 0 {
		t.Fatalf("existing peer received %d join signals after a failed add; want 0", existing.received)
	}

	// The new peer must not have received its HubInfo either.
	if newPeer.sentHubInfo {
		t.Fatal("SendHubInfo was called on a peer that failed to register")
	}
}

// TestAddPeerSuccessRegistersAndNotifies locks in the happy path that the
// reorder must preserve: on a successful marshal the peer is registered, the
// join signal is broadcast to existing peers, and the new peer receives its
// HubInfo.
func TestAddPeerSuccessRegistersAndNotifies(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	existing := &fakePeer{id: "5"}
	h.PeerStorage.Add("5", existing)

	newPeer := &fakePeer{} // valid ToProtobuf -> marshal succeeds
	h.AddPeer(newPeer)

	if newPeer.GetId() != "1" {
		t.Fatalf("new peer id = %q; want 1", newPeer.GetId())
	}
	if _, err := h.PeerStorage.Get("1"); err != nil {
		t.Fatalf("new peer not in storage after successful add: %v", err)
	}
	if existing.received != 1 {
		t.Fatalf("existing peer received %d join signals; want 1", existing.received)
	}
	if !newPeer.sentHubInfo {
		t.Fatal("new peer did not receive its HubInfo after a successful add")
	}
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
