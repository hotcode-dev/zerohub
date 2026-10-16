package handler

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/valyala/fasthttp"
)

// startPermanentCreateTestServer serves the permanent-create endpoint (and the
// migration endpoints) on a random local port so requests land in fasthttp
// worker goroutines, exactly like production. This is what a real unauthenticated
// WebSocket client would hit.
func startPermanentCreateTestServer(t *testing.T, h *handler) string {
	t.Helper()

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		var err error
		switch string(ctx.Path()) {
		case "/v1/status":
			err = h.Status(ctx)
		case "/v1/admin/migrate":
			err = h.Migrate(ctx)
		case "/v1/permanent-hubs/create":
			err = h.CreateHubPermanent(ctx)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		if err != nil {
			// Same contract as Serve in handler.go: a 401 auth failure keeps
			// the body CheckAdminAuth already wrote; anything else gets a 503.
			if err == errAdminUnauthorized {
				return
			}
			ctx.Error(err.Error(), fasthttp.StatusServiceUnavailable)
		}
	}

	server := &fasthttp.Server{
		Handler:            requestHandler,
		Name:               "ZeroHub",
		MaxRequestBodySize: 10 << 20,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() { _ = server.Serve(ln) }()
	t.Cleanup(func() { _ = server.Shutdown() })

	return ln.Addr().String()
}

// readFirstResponse reads exactly one HTTP response from the socket and any
// trailing bytes that arrive within a short window (a pre-fix upgrade sends a
// WebSocket close frame right after the 101 headers). Bounded reads keep the
// test fast whether or not the server closes the connection.
func readFirstResponse(t *testing.T, c net.Conn) (statusLine string, statusCode int, all []byte) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))

	resp, err := http.ReadResponse(bufio.NewReader(c), nil)
	if err != nil {
		t.Fatalf("reading HTTP response: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	statusLine = resp.Status
	statusCode = resp.StatusCode
	all = append([]byte(statusLine+"\n"), body...)

	// Trailing bytes: a pre-fix 101 is followed by a close frame carrying the
	// leaked backup host; post-fix nothing follows the 401.
	_ = c.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	extra := make([]byte, 4096)
	if n, _ := c.Read(extra); n > 0 {
		all = append(all, extra[:n]...)
	}
	return
}

// TestCreateHubPermanentUnauthorizedDuringMigration pins the security fix: an
// unauthenticated create request made while the server is in migrate mode must
// be answered with 401 "invalid authorization code" and must NOT leak the
// internal backup host. Before the fix the migration check ran before auth, so
// the request was WebSocket-upgraded and closed with a close frame whose reason
// was the backup host — disclosing it to anyone holding no credentials.
func TestCreateHubPermanentUnauthorizedDuringMigration(t *testing.T) {
	h := newTestHandler()
	addr := startPermanentCreateTestServer(t, h)
	client := newTestClient(addr)

	// Enter migrate mode through the real, auth-gated endpoint.
	status, body, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()})
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with auth = (%d, %q, %v), want 200", status, body, err)
	}
	if !h.isMigrating.Load() || h.getBackupHost() != testBackupHost {
		t.Fatalf("migration state = (migrating:%v, backupHost:%q), want (true, %q)",
			h.isMigrating.Load(), h.getBackupHost(), testBackupHost)
	}

	// A raw WebSocket-upgrade GET with NO Authorization header. Pre-fix the
	// server would 101-upgrade and send a close frame whose reason is the
	// backup host; post-fix it must answer 401 over plain HTTP.
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	req := "GET /v1/permanent-hubs/create?id=room HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write: %v", err)
	}
	statusLine, statusCode, allBytes := readFirstResponse(t, conn)
	_ = conn.Close()

	got := string(allBytes)
	if strings.Contains(got, testBackupHost) {
		t.Fatalf("unauthenticated response during migration leaked the backup host %q:\n%s", testBackupHost, got)
	}
	if statusCode != fasthttp.StatusUnauthorized {
		t.Fatalf("unauthenticated response status = %q (%d), want 401", statusLine, statusCode)
	}
	if !strings.Contains(got, "invalid authorization code") {
		t.Fatalf("unauthenticated response = %q, want it to contain 'invalid authorization code'", got)
	}
	if strings.Contains(statusLine, "101") && strings.Contains(got, "Switching Protocols") {
		t.Fatalf("unauthenticated request was WebSocket-upgraded; want a 401:\n%s", got)
	}
}

// TestCreateHubPermanentAuthorizedDuringMigration pins the companion invariant:
// a valid-authorized create request during migration must still be forwarded
// (WebSocket-upgraded and closed with the backup host as the close reason), not
// rejected with 401. This guards against over-correcting the ordering so that
// even admins cannot be redirected to the backup host.
func TestCreateHubPermanentAuthorizedDuringMigration(t *testing.T) {
	h := newTestHandler()
	addr := startPermanentCreateTestServer(t, h)
	client := newTestClient(addr)

	status, body, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()})
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with auth = (%d, %q, %v), want 200", status, body, err)
	}

	// A real WebSocket client WITH admin auth must complete the 101 upgrade.
	// If the handler had answered 401, the handshake would fail.
	u, _ := url.Parse("ws://" + addr + "/v1/permanent-hubs/create?id=room")
	conn, resp, err := websocket.NewClient(
		dialConn(t, addr),
		u,
		map[string][]string{"Authorization": {adminAuthHeader()}},
		0, 0,
	)
	if err != nil {
		if resp != nil && resp.StatusCode == fasthttp.StatusUnauthorized {
			t.Fatalf("authorized create during migration was rejected with 401; want ForwardMigrate")
		}
		t.Fatalf("websocket handshake: %v", err)
	}
	defer conn.Close()

	// The server closes the upgraded connection with the backup host as the
	// close reason; the client must observe that close frame.
	msgType, payload, err := conn.ReadMessage()
	if err != nil {
		// Some paths surface the peer close as an error; in that case the
		// close reason is still the backup host, so assert on the error.
		if strings.Contains(err.Error(), testBackupHost) {
			return
		}
		t.Fatalf("read close frame: %v", err)
	}
	if msgType != websocket.CloseMessage {
		t.Fatalf("message type = %d, want close message (%d)", msgType, websocket.CloseMessage)
	}
	// FormatCloseMessage payload: 2-byte close code (1001) + the reason text.
	if len(payload) < 2 || !strings.Contains(string(payload[2:]), testBackupHost) {
		t.Fatalf("close reason = %q, want it to contain the backup host %q", string(payload), testBackupHost)
	}
}

// dialConn opens a raw TCP connection to the test server (used to hand a
// net.Conn to websocket.NewClient).
func dialConn(t *testing.T, addr string) net.Conn {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}
