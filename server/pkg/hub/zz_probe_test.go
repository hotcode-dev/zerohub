package hub

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	websocket "github.com/fasthttp/websocket"
)

var probeUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func TestProbeConnSurvivesHandlerReturn(t *testing.T) {
	ready := make(chan *websocket.Conn, 1)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := probeUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		ready <- conn
	}))
	t.Cleanup(s.Close)

	clientURL := "ws://" + strings.TrimPrefix(s.URL, "http://")
	client, _, err := websocket.DefaultDialer.Dial(clientURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	var server *websocket.Conn
	select {
	case server = <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for server conn")
		return
	}

	if err := client.WriteMessage(websocket.BinaryMessage, []byte("ping")); err != nil {
		t.Fatalf("client write: %v", err)
	}
	_ = server.SetReadDeadline(time.Now().Add(2 * time.Second))
	mtype, data, err := server.ReadMessage()
	if err != nil {
		t.Fatalf("server read: %v", err)
	}
	if mtype != websocket.BinaryMessage || string(data) != "ping" {
		t.Fatalf("unexpected: type=%d data=%q", mtype, data)
	}
	t.Logf("OK: conn survived handler return; server read %q", data)
}
