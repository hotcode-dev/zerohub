package peer

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fasthttp/websocket"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"google.golang.org/protobuf/proto"
)

var testUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// newTestConn spins up an in-process websocket server, dials it and returns
// the server-side *websocket.Conn. A reader goroutine drains the server
// connection so server-side writes in the tests — including many concurrent
// ones — never block on a full socket buffer.
func newTestConn(t *testing.T) *websocket.Conn {
	t.Helper()

	ready := make(chan *websocket.Conn, 1)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		ready <- conn

		// Drain the connection so test-side writes never block.
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(s.Close)

	clientURL := "ws://" + strings.TrimPrefix(s.URL, "http://")
	clientConn, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })

	select {
	case conn := <-ready:
		return conn
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server conn")
		return nil
	}
}

// newTestConnPair is like newTestConn but returns both the server-side and
// client-side *websocket.Conn. It starts no drainer goroutine: the caller is
// responsible for reading on whichever side it needs. Use this when a test
// must read the frames a server-side writer (the peer) actually emits.
func newTestConnPair(t *testing.T) (server, client *websocket.Conn) {
	t.Helper()

	ready := make(chan *websocket.Conn, 1)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		ready <- conn
	}))
	t.Cleanup(s.Close)

	clientURL := "ws://" + strings.TrimPrefix(s.URL, "http://")
	clientConn, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })

	select {
	case conn := <-ready:
		return conn, clientConn
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server conn")
		return nil, nil
	}
}

func TestSendBinaryMessageNilConn(t *testing.T) {
	t.Parallel()

	p := NewPeer(nil, "metadata")
	if err := p.SendBinaryMessage([]byte("hello")); err == nil {
		t.Fatal("expected error from SendBinaryMessage on nil conn, got nil")
	}
	if err := p.SendHubInfo(&pb.HubInfoMessage{Id: "hub"}); err == nil {
		t.Fatal("expected error from SendHubInfo on nil conn, got nil")
	}
	if err := p.SendOffer("1", "sdp"); err == nil {
		t.Fatal("expected error from SendOffer on nil conn, got nil")
	}
	if err := p.SendAnswer("1", "sdp"); err == nil {
		t.Fatal("expected error from SendAnswer on nil conn, got nil")
	}
	if err := p.SendIceCandidate("1", "candidate:1"); err == nil {
		t.Fatal("expected error from SendIceCandidate on nil conn, got nil")
	}
}

func TestGetWSConnNilConn(t *testing.T) {
	t.Parallel()

	p := NewPeer(nil, "metadata")
	if conn := p.GetWSConn(); conn != nil {
		t.Fatalf("expected nil ws conn, got %v", conn)
	}
}

func TestSetIdAndToProtobuf(t *testing.T) {
	t.Parallel()

	p := NewPeer(nil, "metadata")
	p.SetId("42")
	if got := p.GetId(); got != "42" {
		t.Fatalf("expected id 42, got %q", got)
	}
	got := p.ToProtobuf()
	if got.GetId() != "42" || got.GetMetadata() != "metadata" {
		t.Fatalf("unexpected ToProtobuf: id=%q metadata=%q", got.GetId(), got.GetMetadata())
	}
}

func TestSendMessageSuccess(t *testing.T) {
	t.Parallel()

	conn := newTestConn(t)
	p := NewPeer(conn, "metadata")

	// A successful write means the frames were actually placed on the
	// connection (the drainer goroutine keeps the pipe from backing up).
	if err := p.SendBinaryMessage([]byte("hello")); err != nil {
		t.Fatalf("SendBinaryMessage: %v", err)
	}
	if err := p.SendHubInfo(&pb.HubInfoMessage{Id: "hub"}); err != nil {
		t.Fatalf("SendHubInfo: %v", err)
	}
	if err := p.SendOffer("1", "offer-sdp"); err != nil {
		t.Fatalf("SendOffer: %v", err)
	}
	if err := p.SendAnswer("1", "answer-sdp"); err != nil {
		t.Fatalf("SendAnswer: %v", err)
	}
	if err := p.SendIceCandidate("1", "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host"); err != nil {
		t.Fatalf("SendIceCandidate: %v", err)
	}
}

// TestSendServerMessageErrorWrapping pins the per-operation error strings
// produced by the shared marshal+send helper: each sender must name its
// operation and wrap the underlying SendBinaryMessage error.
func TestSendServerMessageErrorWrapping(t *testing.T) {
	t.Parallel()

	p := NewPeer(nil, "metadata")
	cases := []struct {
		op   string
		send func() error
	}{
		{"hub info", func() error { return p.SendHubInfo(&pb.HubInfoMessage{Id: "hub"}) }},
		{"offer", func() error { return p.SendOffer("1", "sdp") }},
		{"answer", func() error { return p.SendAnswer("1", "sdp") }},
		{"ice candidate", func() error { return p.SendIceCandidate("1", "candidate:1") }},
	}
	for _, tc := range cases {
		err := tc.send()
		if err == nil {
			t.Fatalf("expected error sending %s on nil conn, got nil", tc.op)
		}
		if want := "error sending " + tc.op; !strings.Contains(err.Error(), want) {
			t.Fatalf("%s: error %q does not contain %q", tc.op, err.Error(), want)
		}
		if !strings.Contains(err.Error(), "ws conn is nil") {
			t.Fatalf("%s: error %q does not wrap the underlying send failure", tc.op, err.Error())
		}
	}
}

// TestSendServerMessageWireFormat verifies the refactored senders still put
// the correct oneof variant on the wire with payloads passed through
// verbatim: read each frame back on the client side and unmarshal it.
func TestSendServerMessageWireFormat(t *testing.T) {
	t.Parallel()

	server, client := newTestConnPair(t)
	p := NewPeer(server, "metadata")

	sends := []struct {
		name string
		fn   func() error
	}{
		{"hub info", func() error { return p.SendHubInfo(&pb.HubInfoMessage{Id: "hub-1"}) }},
		{"offer", func() error { return p.SendOffer("peer-1", "offer-sdp") }},
		{"answer", func() error { return p.SendAnswer("peer-2", "answer-sdp") }},
		{"ice candidate", func() error { return p.SendIceCandidate("peer-3", "candidate:3") }},
	}

	for i, tc := range sends {
		if err := tc.fn(); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		msgType, data, err := client.ReadMessage()
		if err != nil {
			t.Fatalf("%s: read frame: %v", tc.name, err)
		}
		if msgType != websocket.BinaryMessage {
			t.Fatalf("%s: want binary frame, got type %d", tc.name, msgType)
		}
		got := &pb.ServerMessage{}
		if err := proto.Unmarshal(data, got); err != nil {
			t.Fatalf("%s: unmarshal: %v", tc.name, err)
		}
		switch m := got.Message.(type) {
		case *pb.ServerMessage_HubInfoMessage:
			if i != 0 || m.HubInfoMessage.GetId() != "hub-1" {
				t.Fatalf("frame %d: unexpected hub info %v", i, m.HubInfoMessage)
			}
		case *pb.ServerMessage_OfferMessage:
			if i != 1 || m.OfferMessage.GetOfferPeerId() != "peer-1" || m.OfferMessage.GetOfferSdp() != "offer-sdp" {
				t.Fatalf("frame %d: unexpected offer %v", i, m.OfferMessage)
			}
		case *pb.ServerMessage_AnswerMessage:
			if i != 2 || m.AnswerMessage.GetAnswerPeerId() != "peer-2" || m.AnswerMessage.GetAnswerSdp() != "answer-sdp" {
				t.Fatalf("frame %d: unexpected answer %v", i, m.AnswerMessage)
			}
		case *pb.ServerMessage_IceCandidateMessage:
			if i != 3 || m.IceCandidateMessage.GetPeerId() != "peer-3" || m.IceCandidateMessage.GetCandidate() != "candidate:3" {
				t.Fatalf("frame %d: unexpected ice candidate %v", i, m.IceCandidateMessage)
			}
		default:
			t.Fatalf("frame %d: unexpected oneof variant %T", i, got.Message)
		}
	}
}

func TestClose(t *testing.T) {
	t.Parallel()

	conn := newTestConn(t)
	p := NewPeer(conn, "metadata")

	p.Close()
	if got := p.GetWSConn(); got != nil {
		t.Fatal("expected GetWSConn to be nil after Close")
	}
	if err := p.SendBinaryMessage([]byte("after close")); err == nil {
		t.Fatal("expected error after Close, got nil")
	}

	// Close must be idempotent.
	p.Close()
	p.Close()
	if got := p.GetWSConn(); got != nil {
		t.Fatal("expected GetWSConn to stay nil after double Close")
	}
}

// TestPeerConcurrentAccess exercises the locked fields (Id and WSConn) from
// many goroutines to catch data races under `go test -race`.
func TestPeerConcurrentAccess(t *testing.T) {
	t.Parallel()

	conn := newTestConn(t)
	p := NewPeer(conn, "metadata")

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = p.GetId()
				p.SetId(strings.Repeat("x", j%8+1))
				if p.GetWSConn() != nil {
					_ = p.SendBinaryMessage([]byte{byte(n)})
				}
				_ = p.ToProtobuf()
			}
		}(i)
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		// Wait until some sends have happened, then close the conn out
		// from under the readers/senders.
		time.Sleep(10 * time.Millisecond)
		p.Close()
	}()

	wg.Wait()

	if got := p.GetWSConn(); got != nil {
		t.Fatal("expected ws conn to be nil after Close")
	}
}
