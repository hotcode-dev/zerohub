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
