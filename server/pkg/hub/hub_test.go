package hub

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bytedance/sonic"
	websocket "github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"github.com/hotcode-dev/zerohub/pkg/storage"
	"google.golang.org/protobuf/proto"
)

// fakePeer is a peer.Peer that records how many binary messages it receives
// and captures the SDP offers/answers sent to it.
type fakePeer struct {
	id       string
	conn     *websocket.Conn
	received int
	// offerPeer/offerSdp capture the SDP offer the peer received.
	offerPeer string
	offerSdp  string
	// answerPeer/answerSdp capture the SDP answer the peer received.
	answerPeer string
	answerSdp  string
	// icePeer/iceCandidate capture the trickled ICE candidate the peer received.
	icePeer      string
	iceCandidate string
	// sentHubInfo reports whether SendHubInfo was called.
	sentHubInfo bool
	// sendFail, when non-nil, is returned by SendOffer/SendAnswer/
	// SendIceCandidate so a test can exercise the helper's send-error log
	// path without a real WebSocket failure.
	sendFail error
	// hubInfo captures the HubInfoMessage payload sent to the peer.
	hubInfo *pb.HubInfoMessage
	// protoOverride, if non-nil, is returned by ToProtobuf and lets a test
	// force the join-signal marshal path to fail (an invalid-UTF-8 Id makes
	// proto.Marshal of the resulting PeerJoinedMessage return an error).
	protoOverride *pb.Peer
	// stallFirst, when non-nil, makes the peer's first SendBinaryMessage
	// block until the test closes stallFirst (simulating a stalled
	// WebSocket write); parkedSig is closed when that first send has
	// parked, so the test can time the stall deterministically. Every
	// later send is immediate.
	stallFirst chan struct{}
	parkedSig  chan struct{}
	stalled    atomic.Bool
}

func (p *fakePeer) SendBinaryMessage(data []byte) error {
	p.received++
	if p.stallFirst != nil && !p.stalled.Swap(true) {
		close(p.parkedSig)
		<-p.stallFirst
	}
	return nil
}

func (p *fakePeer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) error {
	p.sentHubInfo = true
	p.hubInfo = hubInfoPb
	return nil
}

func (p *fakePeer) SendOffer(offerPeerId string, offerSdp string) error {
	p.offerPeer = offerPeerId
	p.offerSdp = offerSdp
	return p.sendFail
}
func (p *fakePeer) SendAnswer(answerPeerId string, answerSdp string) error {
	p.answerPeer = answerPeerId
	p.answerSdp = answerSdp
	return p.sendFail
}
func (p *fakePeer) SendIceCandidate(icePeerId string, candidate string) error {
	p.icePeer = icePeerId
	p.iceCandidate = candidate
	return p.sendFail
}
func (p *fakePeer) GetId() string              { return p.id }
func (p *fakePeer) SetId(id string)            { p.id = id }
func (p *fakePeer) GetWSConn() *websocket.Conn { return p.conn }
func (p *fakePeer) Close()                     {}
func (p *fakePeer) ToProtobuf() *pb.Peer {
	if p.protoOverride != nil {
		return p.protoOverride
	}
	return &pb.Peer{Id: p.id}
}

var testUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// newTestConnPair spins up an in-process websocket server, dials it, and
// returns the server-side conn (a live non-nil *websocket.Conn suitable for
// fakePeer.GetWSConn) plus the client-side conn for feeding HandleMessage.
// The handler does NOT drain the conn: the test owns reads of the server conn.
func newTestConnPair(t *testing.T) (server, client *websocket.Conn) {
	t.Helper()

	ready := make(chan *websocket.Conn, 1)
	quit := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		ready <- conn

		// Hold the handler (and thus the hijacked conn) until cleanup.
		<-quit
	}))
	t.Cleanup(s.Close)

	clientURL := "ws://" + strings.TrimPrefix(s.URL, "http://")
	c, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	t.Cleanup(func() { close(quit) })

	select {
	case conn := <-ready:
		return conn, c
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server conn")
		return nil, nil
	}
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
	if !newPeer.sentHubInfo || newPeer.hubInfo == nil {
		t.Fatal("new peer did not receive its HubInfo after a successful add")
	}
}

// TestAddPeerHubInfoRosterExcludesNewPeer is a regression test for the
// new peer's own entry leaking into the roster of the HubInfoMessage it
// receives: PeerStorage.Add runs before the GetAll loop, so the joiner
// used to observe itself in the authoritative roster. The roster must
// contain only the OTHER peers in the hub.
func TestAddPeerHubInfoRosterExcludesNewPeer(t *testing.T) {
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

	newPeer := &fakePeer{}
	h.AddPeer(newPeer)

	if !newPeer.sentHubInfo || newPeer.hubInfo == nil {
		t.Fatal("new peer did not receive its HubInfo")
	}
	if newPeer.hubInfo.MyPeerId != newPeer.GetId() {
		t.Fatalf("HubInfoMessage.MyPeerId = %q; want %q", newPeer.hubInfo.MyPeerId, newPeer.GetId())
	}
	if len(newPeer.hubInfo.Peers) != 1 {
		t.Fatalf("HubInfoMessage.Peers has %d entries; want 1 (only the pre-existing peer)", len(newPeer.hubInfo.Peers))
	}
	for _, p := range newPeer.hubInfo.Peers {
		if p.Id == newPeer.GetId() {
			t.Fatalf("HubInfoMessage.Peers contains the new peer's own entry (%q)", newPeer.GetId())
		}
	}
	if newPeer.hubInfo.Peers[0].Id != "5" {
		t.Fatalf("HubInfoMessage.Peers[0].Id = %q; want pre-existing peer 5", newPeer.hubInfo.Peers[0].Id)
	}

	// The existing peer still receives exactly one join signal.
	if existing.received != 1 {
		t.Fatalf("existing peer received %d join signals; want 1", existing.received)
	}
}

// TestRemovePeerIfLastIdempotent is a regression test for the duplicate
// teardown on clean close: the close handler and the post-HandleMessage
// fallback both call RemovePeerIfLast for the same peer. The second call
// must not broadcast the disconnect signal again nor re-delete the hub.
func TestRemovePeerIfLastIdempotent(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	other := &fakePeer{id: "3"}
	h.(*hub).PeerStorage.Add("2", leaver)
	h.(*hub).PeerStorage.Add("3", other)

	// First removal: peer present -> broadcast once; the hub still holds
	// peer 3, so it must remain in storage.
	h.RemovePeerIfLast("2", hubStore)
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted while peer 3 remained: %v", err)
	}
	if other.received != 1 {
		t.Fatalf("remaining peer received %d disconnect signals after first removal; want 1", other.received)
	}

	// Second removal (the duplicate teardown path): peer already gone ->
	// no extra broadcast, no hub removal.
	h.RemovePeerIfLast("2", hubStore)
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted on duplicate removal: %v", err)
	}
	if other.received != 1 {
		t.Fatalf("remaining peer received %d disconnect signals after duplicate removal; want 1", other.received)
	}
}

// TestRemovePeerIfLastLastPeerTwice covers the double hub-deletion case:
// when the disconnecting peer was the last one, the first call already
// deleted the hub from hubStore; the duplicate second call must be a no-op
// instead of re-triggering the deletion.
func TestRemovePeerIfLastLastPeerTwice(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	h.(*hub).PeerStorage.Add("2", leaver)

	// First removal: peer present -> the last peer left, so the hub is
	// deleted from storage.
	h.RemovePeerIfLast("2", hubStore)
	if _, err := hubStore.Get("id"); err == nil {
		t.Fatal("hub still in storage after the last peer left")
	}

	// Duplicate teardown path: the hub is already gone; the second call
	// must complete as a no-op without panicking or mutating state.
	h.RemovePeerIfLast("2", hubStore)
	if _, err := hubStore.Get("id"); err == nil {
		t.Fatal("duplicate removal re-added the hub to storage")
	}
	if !h.(*hub).PeerStorage.IsEmpty() {
		t.Fatal("hub PeerStorage not empty after duplicate removal")
	}
}

// TestRemovePeerIfLastDeletesHubWhenLastPeerLeaves is the happy path for the
// new atomic primitive: when the disconnecting peer was the last member of a
// non-permanent hub, the hub is removed from hubStorage.
func TestRemovePeerIfLastDeletesHubWhenLastPeerLeaves(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	h.(*hub).PeerStorage.Add("2", leaver)

	h.RemovePeerIfLast("2", hubStore)

	// The hub must be gone from storage and hold no peers.
	if _, err := hubStore.Get("id"); err == nil {
		t.Fatal("hub still present in hubStore after last peer removed")
	}
	if !h.(*hub).PeerStorage.IsEmpty() {
		t.Fatal("hub PeerStorage not empty after last peer removed")
	}
}

// TestRemovePeerIfLastKeepsHubWhenPeersRemain is the inverse happy path:
// removing a peer that is NOT the last member must not delete the hub.
func TestRemovePeerIfLastKeepsHubWhenPeersRemain(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	other := &fakePeer{id: "3"}
	h.(*hub).PeerStorage.Add("2", leaver)
	h.(*hub).PeerStorage.Add("3", other)

	h.RemovePeerIfLast("2", hubStore)

	// The hub must still be present and hold the surviving peer.
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted while a peer remained: %v", err)
	}
	if _, err := h.(*hub).PeerStorage.Get("3"); err != nil {
		t.Fatal("surviving peer was removed from the hub")
	}
}

// TestRemovePeerIfLastNeverDeletesPermanentHub covers the permanent-hub
// guarantee: a permanent hub is never removed from hubStorage, even when the
// last peer leaves.
func TestRemovePeerIfLastNeverDeletesPermanentHub(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), true)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	h.(*hub).PeerStorage.Add("2", leaver)

	h.RemovePeerIfLast("2", hubStore)

	// The permanent hub must remain in storage (though empty).
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("permanent hub deleted on last peer leave: %v", err)
	}
}

// TestRemovePeerIfLastUnknownPeerIsNoOp: removing a peer that was never in
// the hub must be a no-op — no peer removed, no broadcast, no hub deletion.
func TestRemovePeerIfLastUnknownPeerIsNoOp(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	other := &fakePeer{id: "3"}
	h.(*hub).PeerStorage.Add("3", other)

	h.RemovePeerIfLast("99", hubStore)

	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted for an unknown peer: %v", err)
	}
	if _, err := h.(*hub).PeerStorage.Get("3"); err != nil {
		t.Fatal("unrelated peer was removed by an unknown-id removal")
	}
	if other.received != 0 {
		t.Fatalf("remaining peer received %d signals for unknown-peer removal; want 0", other.received)
	}
}

// TestAddPeerRejectedAfterRemovePeerIfLastLast is the deterministic
// regression test for the orphaned-room race. It exercises the
// delete-then-add window that the emptiness re-check alone leaves open:
// the hub is deleted from hubStore while it is still reachable (closing is
// set under the same lock as the delete), and a subsequent join to that same
// hub object must be rejected instead of registering a peer into a hub that
// is no longer reachable via GetHubById.
func TestAddPeerRejectedAfterRemovePeerIfLastLast(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	leaver := &fakePeer{id: "2"}
	h.(*hub).PeerStorage.Add("2", leaver)

	// Last peer departs and the hub is deleted from storage.
	h.RemovePeerIfLast("2", hubStore)
	if _, err := hubStore.Get("id"); err == nil {
		t.Fatalf("precondition: hub still in store after last peer left")
	}

	// A join that still holds the (now detached) hub object must NOT
	// register a peer: that would be the orphaned state — a live peer in a
	// hub that GetHubById no longer returns.
	joiner := &fakePeer{}
	h.AddPeer(joiner)

	// The joiner must not be registered, must not have received its
	// HubInfo, and the hub must remain empty in storage.
	if _, err := h.(*hub).PeerStorage.Get(joiner.GetId()); err == nil {
		t.Fatalf("joiner %q registered into a hub already deleted from storage (orphaned)", joiner.GetId())
	}
	if joiner.sentHubInfo {
		t.Fatal("joiner received a HubInfo even though the hub was deleted from storage")
	}
	if !h.(*hub).PeerStorage.IsEmpty() {
		t.Fatalf("deleted hub holds %d peers; want empty", peerCount(h))
	}
	if _, err := hubStore.Get("id"); err == nil {
		t.Fatal("hub reappeared in hubStore")
	}
}

// TestAddPeerWhileRemovePeerIfLastRunning is the concurrency regression test
// mandated by the task: race RemovePeerIfLast (last peer) against AddPeer for
// the same hub under -race and assert that the resulting state is always one
// of the two safe outcomes —
//
//	(a) the hub is still present and the joiner is a reachable member, OR
//	(b) the hub is fully removed and the joiner was not accepted
//
// never the orphaned state where hubStore no longer returns the hub but a
// peer remains registered on it.
func TestAddPeerWhileRemovePeerIfLastRunning(t *testing.T) {
	const iterations = 200

	for i := 0; i < iterations; i++ {
		t.Run(fmt.Sprintf("iter_%d", i), func(t *testing.T) {
			hubStore := storage.NewMemoryStorage[Hub]()
			h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
			if err != nil {
				t.Fatalf("NewHub: %v", err)
			}
			hubStore.Add("id", h)

			leaver := &fakePeer{id: "1"}
			h.(*hub).PeerStorage.Add("1", leaver)

			joiner := &fakePeer{}
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				h.AddPeer(joiner)
			}()
			go func() {
				defer wg.Done()
				h.RemovePeerIfLast("1", hubStore)
			}()
			wg.Wait()

			_, storeErr := hubStore.Get("id")
			present := storeErr == nil
			_, joinerErr := h.(*hub).PeerStorage.Get(joiner.GetId())
			joinerIn := joinerErr == nil

			switch {
			case present && joinerIn:
				// Outcome (a): hub still present and the joiner is a
				// reachable member.
			case !present && !joinerIn:
				// Outcome (b): hub fully removed and the joiner was not
				// accepted.
			default:
				// The orphaned state the bug produces.
				t.Fatalf("orphaned state: hub present=%v joiner registered=%v joiner gotHubInfo=%v (want not (present && !joinerIn) and not (!present && joinerIn))", present, joinerIn, joiner.sentHubInfo)
			}
		})
	}
}

// TestRemovePeerIfLastDoesNotDeadlockWhenBroadcastStalls guards the
// lock-not-held-across-WS-sends property: a peer whose send blocks in the
// disconnect broadcast must not pin the hub lock and stall a concurrent
// join's registration. (Mirrors the existing
// TestRemovePeerIfLastStalledBroadcastDoesNotBlockConcurrentAddPeer at the
// Add-vs-Remove direction.)
func TestRemovePeerIfLastDoesNotDeadlockWhenBroadcastStalls(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	// The leaver's removal must broadcast the disconnect signal to the
	// still-present peer, whose first send parks.
	stalled := &fakePeer{
		id:         "3",
		stallFirst: make(chan struct{}),
		parkedSig:  make(chan struct{}),
	}
	leaver := &fakePeer{id: "2"}
	h.(*hub).PeerStorage.Add("2", leaver)
	h.(*hub).PeerStorage.Add("3", stalled)

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.RemovePeerIfLast("2", hubStore)
	}()

	// Wait until the disconnect broadcast has parked on the stalled send:
	// from here RemovePeerIfLast is blocked inside SendBinaryMessage, and
	// (if the lock were held across the send) a concurrent AddPeer would
	// deadlock on it.
	select {
	case <-stalled.parkedSig:
	case <-time.After(5 * time.Second):
		t.Fatal("disconnect broadcast did not reach the stalled peer's send")
	}

	// A concurrent join must complete even with the broadcast stalled.
	joiner := &fakePeer{}
	h.AddPeer(joiner)

	// Release the stalled send and let RemovePeerIfLast finish.
	close(stalled.stallFirst)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RemovePeerIfLast did not complete after the stalled send was resolved")
	}

	// The joiner was registered and the hub still holds it: the last peer
	// (leaver) left but the hub was not deleted because the joiner arrived.
	if _, err := h.(*hub).PeerStorage.Get(joiner.GetId()); err != nil {
		t.Fatalf("joiner %q not registered after removal of the last original peer", joiner.GetId())
	}
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted while the joiner was still in it: %v", err)
	}
}

// peerCount is a small helper for test assertions.
func peerCount(h Hub) int {
	n := 0
	for range h.(*hub).PeerStorage.GetAll() {
		n++
	}
	return n
}

// TestSendOfferToPeer routes an offer to the target peer, passing the local
// peer's id and the SDP verbatim.
func TestSendOfferToPeer(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	target := &fakePeer{id: "2", conn: &websocket.Conn{}}
	other := &fakePeer{id: "3"}
	h.PeerStorage.Add("2", target)
	h.PeerStorage.Add("3", other)

	h.SendOfferToPeer("2", "1", "offer-sdp")

	if target.offerPeer != "1" {
		t.Fatalf("target offerPeerId: want %q, got %q", "1", target.offerPeer)
	}
	if target.offerSdp != "offer-sdp" {
		t.Fatalf("target offerSdp: want %q, got %q", "offer-sdp", target.offerSdp)
	}
	if other.offerPeer != "" || other.offerSdp != "" {
		t.Fatalf("non-target peer got an offer: peer=%q sdp=%q", other.offerPeer, other.offerSdp)
	}
}

// TestSendAnswerToPeer routes an answer to the target peer, passing the local
// peer's id and the SDP verbatim.
func TestSendAnswerToPeer(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	target := &fakePeer{id: "2", conn: &websocket.Conn{}}
	other := &fakePeer{id: "3"}
	h.PeerStorage.Add("2", target)
	h.PeerStorage.Add("3", other)

	h.SendAnswerToPeer("2", "1", "answer-sdp")

	if target.answerPeer != "1" {
		t.Fatalf("target answerPeerId: want %q, got %q", "1", target.answerPeer)
	}
	if target.answerSdp != "answer-sdp" {
		t.Fatalf("target answerSdp: want %q, got %q", "answer-sdp", target.answerSdp)
	}
	if other.answerPeer != "" || other.answerSdp != "" {
		t.Fatalf("non-target peer got an answer: peer=%q sdp=%q", other.answerPeer, other.answerSdp)
	}
}

// TestSendIceCandidateToPeer routes a trickled ICE candidate to the target peer,
// passing the sender's peer id and the candidate verbatim.
func TestSendIceCandidateToPeer(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	target := &fakePeer{id: "2", conn: &websocket.Conn{}}
	other := &fakePeer{id: "3"}
	h.PeerStorage.Add("2", target)
	h.PeerStorage.Add("3", other)

	h.SendIceCandidateToPeer("2", "1", "candidate:1")

	if target.icePeer != "1" {
		t.Fatalf("target icePeer: want %q, got %q", "1", target.icePeer)
	}
	if target.iceCandidate != "candidate:1" {
		t.Fatalf("target candidate: want %q, got %q", "candidate:1", target.iceCandidate)
	}
	if other.icePeer != "" || other.iceCandidate != "" {
		t.Fatalf("non-target peer got a candidate: peer=%q cand=%q", other.icePeer, other.iceCandidate)
	}
}

// TestSendRelayToMissingPeer covers the peer-not-found / nil-WSConn guard: a
// missing target must not error the call, nor send to any other peer.
func TestSendRelayToMissingPeer(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	// Peer "3" is in the hub but has no WS conn (closed peer).
	noConn := &fakePeer{id: "3"}
	h.PeerStorage.Add("3", noConn)

	// Unknown peer: must be a no-op.
	h.SendOfferToPeer("99", "1", "offer-sdp")
	h.SendAnswerToPeer("99", "1", "answer-sdp")
	h.SendIceCandidateToPeer("99", "1", "candidate:1")

	// Known peer with nil conn: must also be a no-op, not fall through to it.
	h.SendOfferToPeer("3", "1", "offer-sdp")
	h.SendAnswerToPeer("3", "1", "answer-sdp")
	h.SendIceCandidateToPeer("3", "1", "candidate:1")

	if noConn.offerPeer != "" || noConn.offerSdp != "" || noConn.answerPeer != "" || noConn.answerSdp != "" ||
		noConn.icePeer != "" || noConn.iceCandidate != "" {
		t.Fatalf("peer without conn received relay: offer=%q/%q answer=%q/%q ice=%q/%q",
			noConn.offerPeer, noConn.offerSdp, noConn.answerPeer, noConn.answerSdp,
			noConn.icePeer, noConn.iceCandidate)
	}
}

// TestSendRelaySendError covers the helper's send-error branch: when the
// target peer's send fails, the failure must be logged (not panicked or
// propagated), the payload must still have reached the peer, and no other
// peer must be affected.
func TestSendRelaySendError(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	target := &fakePeer{id: "2", conn: &websocket.Conn{}, sendFail: fmt.Errorf("ws write failed")}
	other := &fakePeer{id: "3", conn: &websocket.Conn{}}
	h.PeerStorage.Add("2", target)
	h.PeerStorage.Add("3", other)

	// Must not panic or propagate: a send failure is only logged.
	h.SendOfferToPeer("2", "1", "offer-sdp")
	h.SendAnswerToPeer("2", "1", "answer-sdp")
	h.SendIceCandidateToPeer("2", "1", "candidate:1")

	if target.offerPeer != "1" || target.offerSdp != "offer-sdp" ||
		target.answerPeer != "1" || target.answerSdp != "answer-sdp" ||
		target.icePeer != "1" || target.iceCandidate != "candidate:1" {
		t.Fatalf("failing peer did not receive relay: offer=%q/%q answer=%q/%q ice=%q/%q",
			target.offerPeer, target.offerSdp, target.answerPeer, target.answerSdp,
			target.icePeer, target.iceCandidate)
	}
	if other.offerPeer != "" || other.answerPeer != "" || other.icePeer != "" {
		t.Fatalf("failure leaked to non-target peer: offer=%q answer=%q ice=%q",
			other.offerPeer, other.answerPeer, other.icePeer)
	}
}

// TestHandleMessageRelay routes wire messages: a SendOfferMessage on the wire
// must reach the target peer's SendOffer with the local peer's id, and a
// SendAnswerMessage must reach SendAnswer the same way.
func TestHandleMessageRelay(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	serverConn, clientConn := newTestConnPair(t)
	sender := &fakePeer{id: "1", conn: serverConn}
	target := &fakePeer{id: "2", conn: &websocket.Conn{}}
	h.PeerStorage.Add("1", sender)
	h.PeerStorage.Add("2", target)

	offer := &pb.ClientMessage{Message: &pb.ClientMessage_SendOfferMessage{SendOfferMessage: &pb.SendOfferMessage{
		AnswerPeerId: "2",
		OfferSdp:     "offer-sdp",
	}}}
	offerData, err := proto.Marshal(offer)
	if err != nil {
		t.Fatalf("marshal offer: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, offerData); err != nil {
		t.Fatalf("write offer: %v", err)
	}

	answer := &pb.ClientMessage{Message: &pb.ClientMessage_SendAnswerMessage{SendAnswerMessage: &pb.SendAnswerMessage{
		OfferPeerId: "2",
		AnswerSdp:   "answer-sdp",
	}}}
	answerData, err := proto.Marshal(answer)
	if err != nil {
		t.Fatalf("marshal answer: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, answerData); err != nil {
		t.Fatalf("write answer: %v", err)
	}

	// A trickled ICE candidate frame must reach the target peer's
	// SendIceCandidate with the local peer's id and the candidate verbatim.
	iceCandidate := &pb.ClientMessage{Message: &pb.ClientMessage_SendIceCandidateMessage{SendIceCandidateMessage: &pb.SendIceCandidateMessage{
		PeerId:    "2",
		Candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
	}}}
	iceCandidateData, err := proto.Marshal(iceCandidate)
	if err != nil {
		t.Fatalf("marshal ice candidate: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, iceCandidateData); err != nil {
		t.Fatalf("write ice candidate: %v", err)
	}

	// HandleMessage relays both frames, then blocks on the next read until
	// we close the conn from the client side.
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.HandleMessage(sender)
	}()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("HandleMessage did not return after conn close")
	}

	if target.offerPeer != "1" {
		t.Fatalf("offer routed with wrong offerPeerId: want %q, got %q", "1", target.offerPeer)
	}
	if target.offerSdp != "offer-sdp" {
		t.Fatalf("offer sdp: want %q, got %q", "offer-sdp", target.offerSdp)
	}
	if target.answerPeer != "1" {
		t.Fatalf("answer routed with wrong answerPeerId: want %q, got %q", "1", target.answerPeer)
	}
	if target.answerSdp != "answer-sdp" {
		t.Fatalf("answer sdp: want %q, got %q", "answer-sdp", target.answerSdp)
	}
	if target.icePeer != "1" {
		t.Fatalf("ice candidate routed with wrong icePeerId: want %q, got %q", "1", target.icePeer)
	}
	if target.iceCandidate != "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host" {
		t.Fatalf("ice candidate: want host candidate verbatim, got %q", target.iceCandidate)
	}
}

// TestHandleMessageSelfTargetRelay verifies that a SendOfferMessage /
// SendAnswerMessage / SendIceCandidateMessage whose target equals the sender's
// own peer ID is dropped: the sender must not receive its own SDP back.
func TestHandleMessageSelfTargetRelay(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	serverConn, clientConn := newTestConnPair(t)
	sender := &fakePeer{id: "1", conn: serverConn}
	h.PeerStorage.Add("1", sender)

	offer := &pb.ClientMessage{Message: &pb.ClientMessage_SendOfferMessage{SendOfferMessage: &pb.SendOfferMessage{
		AnswerPeerId: "1", // self-target
		OfferSdp:     "offer-sdp",
	}}}
	offerData, err := proto.Marshal(offer)
	if err != nil {
		t.Fatalf("marshal offer: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, offerData); err != nil {
		t.Fatalf("write offer: %v", err)
	}

	answer := &pb.ClientMessage{Message: &pb.ClientMessage_SendAnswerMessage{SendAnswerMessage: &pb.SendAnswerMessage{
		OfferPeerId: "1", // self-target
		AnswerSdp:   "answer-sdp",
	}}}
	answerData, err := proto.Marshal(answer)
	if err != nil {
		t.Fatalf("marshal answer: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, answerData); err != nil {
		t.Fatalf("write answer: %v", err)
	}

	iceCandidate := &pb.ClientMessage{Message: &pb.ClientMessage_SendIceCandidateMessage{SendIceCandidateMessage: &pb.SendIceCandidateMessage{
		PeerId:    "1", // self-target
		Candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
	}}}
	iceCandidateData, err := proto.Marshal(iceCandidate)
	if err != nil {
		t.Fatalf("marshal ice candidate: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, iceCandidateData); err != nil {
		t.Fatalf("write ice candidate: %v", err)
	}

	// HandleMessage processes both frames, then blocks on the next read until
	// we close the conn from the client side.
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.HandleMessage(sender)
	}()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("HandleMessage did not return after conn close")
	}

	if sender.offerPeer != "" || sender.offerSdp != "" || sender.answerPeer != "" || sender.answerSdp != "" ||
		sender.icePeer != "" || sender.iceCandidate != "" {
		t.Fatalf("sender received its own SDP: offer=%q/%q answer=%q/%q ice=%q/%q",
			sender.offerPeer, sender.offerSdp, sender.answerPeer, sender.answerSdp,
			sender.icePeer, sender.iceCandidate)
	}
}

// TestHandleMessageIgnoresRemovedUpdatePeerMetadataVariant is a wire-level
// regression test: a legacy frame that carries a value in the removed
// update_peer_metadata_message oneof field (field number 4 on
// proto.zerohub.v1.ClientMessage) must be dropped by HandleMessage instead of
// exiting the WebSocket read loop. It mirrors a frame produced by a client
// built against the pre-removal wire format: the unknown field is skipped by
// proto.Unmarshal, the dispatch falls into the default (invalid client
// message) path, and the very next valid frame must still be relayed. The
// frame is built as raw wire bytes so the test keeps guarding the behavior
// even after the generated Go types no longer know the field name.
func TestHandleMessageIgnoresRemovedUpdatePeerMetadataVariant(t *testing.T) {
	t.Parallel()

	h := &hub{
		Id:          "id",
		CreatedAt:   time.Now(),
		Metadata:    "metadata",
		IsPermanent: true,
		PeerStorage: storage.NewMemoryStorage[peer.Peer](),
	}

	serverConn, clientConn := newTestConnPair(t)
	sender := &fakePeer{id: "1", conn: serverConn}
	target := &fakePeer{id: "2", conn: &websocket.Conn{}}
	h.PeerStorage.Add("1", sender)
	h.PeerStorage.Add("2", target)

	// Legacy frame: tag 0x22 is field 4, wire type 2 (length-delimited) —
	// the oneof index that held update_peer_metadata_message; payload is a
	// well-formed UpdatePeerMetadataMessage{peer_id:"2", metadata:"m"}.
	legacy := []byte{0x22, 0x06, 0x0a, 0x01, '2', 0x12, 0x01, 'm'}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, legacy); err != nil {
		t.Fatalf("write legacy frame: %v", err)
	}

	offer := &pb.ClientMessage{Message: &pb.ClientMessage_SendOfferMessage{SendOfferMessage: &pb.SendOfferMessage{
		AnswerPeerId: "2",
		OfferSdp:     "offer-sdp",
	}}}
	offerData, err := proto.Marshal(offer)
	if err != nil {
		t.Fatalf("marshal offer: %v", err)
	}
	if err := clientConn.WriteMessage(websocket.BinaryMessage, offerData); err != nil {
		t.Fatalf("write offer: %v", err)
	}

	// HandleMessage processes both frames, then blocks on the next read until
	// we close the conn from the client side.
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.HandleMessage(sender)
	}()
	_ = clientConn.Close()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("HandleMessage did not return after conn close")
	}

	if target.offerPeer != "1" || target.offerSdp != "offer-sdp" {
		t.Fatalf("offer after the removed-variant frame: want (%q, %q), got (%q, %q)",
			"1", "offer-sdp", target.offerPeer, target.offerSdp)
	}
	if target.answerPeer != "" || target.icePeer != "" {
		t.Fatalf("no relay expected besides the offer, but answer=%q ice=%q", target.answerPeer, target.icePeer)
	}
}

// TestAddPeerStalledBroadcastDoesNotBlockConcurrentRemovePeerIfLast is a
// regression test for zf-z-c4cc6a7a: with the memory backend,
// memoryStorage.GetAll used to hold the peer-storage RLock across the whole
// yield loop, so a stalled SendBinaryMessage inside AddPeer's broadcast
// pinned the read-lock and blocked every concurrent storage operation
// (RemovePeerIfLast's Get/Delete, and a concurrent AddPeer's Add/GetAll) on
// the same hub. memoryStorage.GetAll now snapshots the roster under the
// read-lock and yields after releasing it (matching gache's
// read-copy-on-write RangeIterValue), so the concurrent op must complete
// while the first broadcast is stalled.
//
// Design: slowPeer's FIRST SendBinaryMessage parks (stallFirst), so
// AddPeer's broadcast blocks on it while AddPeer's RLock is held pre-fix.
// The test observes the stall via slowPeer.parkedSig, then a concurrent
// RemovePeerIfLast must complete: its Get/Delete and its own broadcast (the
// new peer's join signal reaches slowPeer, whose stall was already
// consumed, so that send is immediate) must not wait on the stalled
// iteration.
func TestAddPeerStalledBroadcastDoesNotBlockConcurrentRemovePeerIfLast(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	// slowPeer parks on its first send; leaver is the peer
	// RemovePeerIfLast removes. Both are present when AddPeer starts.
	slowPeer := &fakePeer{id: "5", stallFirst: make(chan struct{}), parkedSig: make(chan struct{})}
	leaver := &fakePeer{id: "6"}
	h.(*hub).PeerStorage.Add("5", slowPeer)
	h.(*hub).PeerStorage.Add("6", leaver)

	addDone := make(chan struct{})
	go func() {
		defer close(addDone)
		h.AddPeer(&fakePeer{})
	}()

	// Deterministic barrier: wait until AddPeer's join-signal broadcast has
	// reached slowPeer's stalled first send. From here on AddPeer is parked
	// in slowPeer's SendBinaryMessage, and (pre-fix) the storage RLock is
	// held for as long as the iteration runs.
	select {
	case <-slowPeer.parkedSig:
	case <-time.After(5 * time.Second):
		t.Fatal("AddPeer's broadcast did not reach the stalled peer's send")
	}

	// Must complete even with the broadcast stalled: RemovePeerIfLast's
	// storage operations (Get/Delete/IsEmpty) and its own disconnect
	// broadcast must not wait on the stalled network I/O. Pre-fix its
	// Get("6") deadlocked on the RLock held by AddPeer's iteration.
	h.RemovePeerIfLast("6", hubStore)
	// leaver is gone; the new peer (added by AddPeer before its broadcast)
	// and slowPeer remain, so the hub must not be deleted from storage.
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted while other peers are present: %v", err)
	}

	// Resolve the stalled send and let AddPeer finish.
	close(slowPeer.stallFirst)
	select {
	case <-addDone:
	case <-time.After(5 * time.Second):
		t.Fatal("AddPeer did not complete after the stalled send was resolved")
	}

	// slowPeer got the join signal (AddPeer) and the disconnect signal
	// (RemovePeerIfLast); leaver got the join signal only (it was removed
	// before the disconnect broadcast).
	if slowPeer.received != 2 {
		t.Fatalf("slow peer received %d signals; want 2 (join + disconnect)", slowPeer.received)
	}
	if leaver.received != 1 {
		t.Fatalf("leaver received %d signals; want 1 (join only)", leaver.received)
	}
}

// TestRemovePeerIfLastStalledBroadcastDoesNotBlockConcurrentAddPeer is the
// mirror for RemovePeerIfLast's disconnect broadcast: a peer whose WebSocket
// write is stalled on the first send must not pin the peer-storage
// read-lock and block a concurrent AddPeer's storage write and iteration.
//
// Design: slowPeer's first SendBinaryMessage parks, so RemovePeerIfLast's
// disconnect broadcast blocks on it while its RLock is held pre-fix. The
// test observes the stall via slowPeer.parkedSig, then a concurrent AddPeer
// must complete: its storage Add + roster GetAll + the new peer's
// SendHubInfo must not wait on the stalled iteration.
func TestRemovePeerIfLastStalledBroadcastDoesNotBlockConcurrentAddPeer(t *testing.T) {
	t.Parallel()

	hubStore := storage.NewMemoryStorage[Hub]()
	h, err := NewHub("id", "metadata", storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	hubStore.Add("id", h)

	slowPeer := &fakePeer{id: "5", stallFirst: make(chan struct{}), parkedSig: make(chan struct{})}
	leaver := &fakePeer{id: "2"}
	other := &fakePeer{id: "3"}
	h.(*hub).PeerStorage.Add("5", slowPeer)
	h.(*hub).PeerStorage.Add("2", leaver)
	h.(*hub).PeerStorage.Add("3", other)

	removeDone := make(chan struct{})
	go func() {
		defer close(removeDone)
		h.RemovePeerIfLast("2", hubStore)
	}()

	// Deterministic barrier: wait until RemovePeerIfLast's disconnect
	// broadcast has reached slowPeer's stalled first send. From here on
	// RemovePeerIfLast is parked in slowPeer's SendBinaryMessage, and
	// (pre-fix) the storage RLock is held for as long as the iteration runs.
	select {
	case <-slowPeer.parkedSig:
	case <-time.After(5 * time.Second):
		t.Fatal("RemovePeerIfLast's broadcast did not reach the stalled peer's send")
	}

	// A concurrent AddPeer must complete even with the disconnect broadcast
	// stalled: its storage Add and its own join broadcast (which reaches
	// slowPeer's now-immutable stall state, so its send is immediate) must
	// not wait on the stalled iteration. Pre-fix its storage.Add / GetAll
	// deadlocked on the RLock held by RemovePeerIfLast's iteration.
	newPeer := &fakePeer{}
	h.AddPeer(newPeer)

	// Resolve the stalled send and let RemovePeerIfLast finish.
	close(slowPeer.stallFirst)
	select {
	case <-removeDone:
	case <-time.After(5 * time.Second):
		t.Fatal("RemovePeerIfLast did not complete after the stalled send was resolved")
	}

	// slowPeer got the disconnect signal (RemovePeerIfLast) and the join
	// signal (AddPeer). other got both as well; leaver got none — it was
	// removed by RemovePeerIfLast before AddPeer's join snapshot, so it is
	// in neither broadcast.
	if slowPeer.received != 2 {
		t.Fatalf("slow peer received %d signals; want 2 (disconnect + join)", slowPeer.received)
	}
	if other.received != 2 {
		t.Fatalf("other peer received %d signals; want 2 (disconnect + join)", other.received)
	}
	if leaver.received != 0 {
		t.Fatalf("leaver received %d signals; want 0 (removed before both broadcasts)", leaver.received)
	}
	// The new peer's HubInfo roster is a point-in-time snapshot: leaver was
	// already removed by RemovePeerIfLast, so the roster holds exactly the
	// remaining peers (other + slowPeer) and not leaver.
	if newPeer.hubInfo == nil {
		t.Fatal("new peer did not receive a HubInfoMessage")
	}
	ids := map[string]bool{}
	for _, p := range newPeer.hubInfo.Peers {
		ids[p.Id] = true
	}
	if len(newPeer.hubInfo.Peers) != 2 {
		t.Fatalf("new peer's HubInfo roster has %d peers; want 2 (peers 3 and 5)", len(newPeer.hubInfo.Peers))
	}
	if !ids["3"] || !ids["5"] || ids["2"] {
		t.Fatalf("new peer's HubInfo roster: want peers 3 and 5, not 2; got %v", ids)
	}
	// The hub must still be in storage: peers remain.
	if _, err := hubStore.Get("id"); err != nil {
		t.Fatalf("hub deleted while peers remain: %v", err)
	}
}
