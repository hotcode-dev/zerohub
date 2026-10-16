package handler

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

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

// TestCreateHubPermanentMigratingPlainHTTP pins the P0 fix: an out-of-band
// plain-HTTP create (curl, Node fetch) that arrives while the server is in
// migrate mode must get the HTTP-level migration response — a 301 with
// {"status":"migrating","backupHost":<host>} — not a 503 "websocket
// handshake". Pre-fix the handler routed through the WebSocket-only
// ForwardMigrate, whose upgrade failed on a request that carries no
// Upgrade: websocket header. No hub may be created while migrating.
func TestCreateHubPermanentMigratingPlainHTTP(t *testing.T) {
	const hubId = "room"
	h := newTestHandler()
	// Real (memory-backed) instances so the "no hub created" assertion
	// inspects actual storage state, not mock call history.
	h.zeroHub = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	h.zeroHubPermanent = newRealZeroHub(t)
	addr := startPermanentCreateTestServer(t, h)
	client := newTestClient(addr)

	// Enter migrate mode through the real, auth-gated endpoint.
	status, body, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()})
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with auth = (%d, %q, %v), want 200", status, body, err)
	}

	// An authorized plain-HTTP create: no Upgrade/Sec-WebSocket-* headers,
	// exactly what curl sends.
	status, body, err = doRequest(t, client, "/v1/permanent-hubs/create?id="+hubId,
		map[string]string{"Authorization": adminAuthHeader()})
	if err != nil {
		t.Fatalf("create during migration: transport error: %v", err)
	}
	if status != fasthttp.StatusMovedPermanently {
		t.Fatalf("create during migration = (%d, %q), want 301", status, body)
	}
	// Same JSON shape /v1/status reports while migrating.
	checkStatusBody(t, body, "migrating", testBackupHost)

	// The hub must NOT have been created.
	if got := h.zeroHubPermanent.GetHubById(hubId); got != nil {
		t.Fatalf("hub %q was created during migration, want none", hubId)
	}
}

// TestCreateHubPermanentMigratingNeverUpgradesWebSocket pins the companion
// invariant: even when a client sends a WebSocket-handshake-shaped request
// (Upgrade/Sec-WebSocket-Key headers, with valid admin auth), the plain-HTTP
// permanent-create endpoint must NOT upgrade the connection. It answers 301
// with the backup host like every other plain-HTTP migration response.
// Pre-fix, an authorized handshake completed with a 101 and the server
// followed it with a 1001 close frame carrying the backup host —
// signaling-client semantics that do not apply to this endpoint.
func TestCreateHubPermanentMigratingNeverUpgradesWebSocket(t *testing.T) {
	h := newTestHandler()
	addr := startPermanentCreateTestServer(t, h)
	client := newTestClient(addr)

	status, body, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()})
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with auth = (%d, %q, %v), want 200", status, body, err)
	}

	// A WebSocket-handshake-shaped GET carrying the admin Authorization
	// header. Pre-fix this completed the 101 upgrade; post-fix it must be
	// answered over plain HTTP.
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	req := "GET /v1/permanent-hubs/create?id=room HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Authorization: " + adminAuthHeader() + "\r\n" +
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
	if strings.Contains(statusLine, "101") && strings.Contains(got, "Switching Protocols") {
		t.Fatalf("authorized create during migration was WebSocket-upgraded; want a plain-HTTP 301:\n%s", got)
	}
	if statusCode != fasthttp.StatusMovedPermanently {
		t.Fatalf("authorized create during migration = %q (%d), want 301", statusLine, statusCode)
	}
	// The backup host must ride in the JSON body, not in a close frame or a
	// 401.
	if !strings.Contains(got, `"status":"migrating"`) || !strings.Contains(got, testBackupHost) {
		t.Fatalf("migration response = %q, want a 301 body carrying status=migrating and the backup host %q", got, testBackupHost)
	}
	if strings.Contains(got, "websocket handshake") {
		t.Fatalf("migration response = %q still reports a websocket handshake error", got)
	}
}
