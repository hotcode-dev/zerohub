package peer

import (
	"sync"
	"testing"

	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
)

// mockConn implements WSConn for testing.
type mockConn struct {
	writes [][]byte
	mu     sync.Mutex
}

func newMockConn() *mockConn {
	return &mockConn{
		writes: make([][]byte, 0),
	}
}

func (m *mockConn) WriteMessage(msgType int, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	copied := make([]byte, len(data))
	copy(copied, data)
	m.writes = append(m.writes, copied)
	return nil
}

func (m *mockConn) ReadMessage() (msgType int, data []byte, err error) {
	return 0, nil, nil
}

func (m *mockConn) Close() error { return nil }

func TestPeer_SendBinaryMessage(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	data := []byte("test-message")
	p.SendBinaryMessage(data)

	if len(conn.writes) != 1 {
		t.Errorf("expected 1 write, got %d", len(conn.writes))
	}
}

func TestPeer_SendBinaryMessage_Concurrent(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	numGoroutines := 100
	numMessages := 1000
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < numMessages; j++ {
				p.SendBinaryMessage([]byte("test-message"))
			}
		}()
	}

	wg.Wait()

	// The write channel has a buffer of 64 so some messages may be dropped
	// if the channel is full. We should have at least some messages.
	if len(conn.writes) == 0 {
		t.Errorf("expected at least some writes, got %d", len(conn.writes))
	}

	t.Logf("received %d writes from %d goroutines", len(conn.writes), numGoroutines)
}

func TestPeer_SendHubInfo(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	hubInfo := &pb.HubInfoMessage{
		Id:       "test-hub",
		MyPeerId: "peer-1",
	}
	p.SendHubInfo(hubInfo)

	if len(conn.writes) != 1 {
		t.Errorf("expected 1 write, got %d", len(conn.writes))
	}
}

func TestPeer_SendOffer(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	p.SendOffer("peer-2", "test-sdp")

	if len(conn.writes) != 1 {
		t.Errorf("expected 1 write, got %d", len(conn.writes))
	}
}

func TestPeer_SendAnswer(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	p.SendAnswer("peer-1", "test-sdp")

	if len(conn.writes) != 1 {
		t.Errorf("expected 1 write, got %d", len(conn.writes))
	}
}

func TestPeer_SendBinaryMessage_NilConn(t *testing.T) {
	peer := &peer{
		writeChan: make(chan writeOp, 64),
		closeChan: make(chan struct{}),
	}

	peer.SendBinaryMessage([]byte("test"))
}

func TestPeer_Close(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")

	p.SendBinaryMessage([]byte("test"))

	p.Close()
}

func TestPeer_GetWSConn(t *testing.T) {
	conn := newMockConn()
	p := NewPeer(conn, "test-metadata")
	defer p.Close()

	retrieved := p.GetWSConn()
	if retrieved != conn {
		t.Error("expected GetWSConn to return the same connection")
	}
}

func TestPeer_GetId(t *testing.T) {
	p := NewPeer(newMockConn(), "test-metadata")
	defer p.Close()

	if p.GetId() != "" {
		t.Error("expected empty ID initially")
	}

	p.SetId("test-id")
	if p.GetId() != "test-id" {
		t.Error("expected SetId to work")
	}
}

func TestPeer_SetId(t *testing.T) {
	p := NewPeer(newMockConn(), "test-metadata")
	defer p.Close()

	p.SetId("new-id")
	if p.GetId() != "new-id" {
		t.Error("SetId did not update ID")
	}
}

func TestPeer_ToProtobuf(t *testing.T) {
	p := NewPeer(newMockConn(), "test-metadata")
	p.SetId("test-id")
	defer p.Close()

	proto := p.ToProtobuf()
	if proto.Id != "test-id" {
		t.Errorf("expected ID to be 'test-id', got '%s'", proto.Id)
	}
	if proto.Metadata != "test-metadata" {
		t.Errorf("expected metadata to be 'test-metadata', got '%s'", proto.Metadata)
	}
}
