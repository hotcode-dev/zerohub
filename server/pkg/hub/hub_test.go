package hub

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func (p *fakePeer) SendOffer(offerPeerId string, offerSdp string) error {
	p.offerPeer = offerPeerId
	p.offerSdp = offerSdp
	return nil
}
func (p *fakePeer) SendAnswer(answerPeerId string, answerSdp string) error {
	p.answerPeer = answerPeerId
	p.answerSdp = answerSdp
	return nil
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

	// Known peer with nil conn: must also be a no-op, not fall through to it.
	h.SendOfferToPeer("3", "1", "offer-sdp")
	h.SendAnswerToPeer("3", "1", "answer-sdp")

	if noConn.offerPeer != "" || noConn.offerSdp != "" || noConn.answerPeer != "" || noConn.answerSdp != "" {
		t.Fatalf("peer without conn received relay: offer=%q/%q answer=%q/%q",
			noConn.offerPeer, noConn.offerSdp, noConn.answerPeer, noConn.answerSdp)
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
}
