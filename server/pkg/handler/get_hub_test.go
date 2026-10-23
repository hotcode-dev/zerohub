package handler

import (
	"encoding/json"
	"net"
	"strings"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// startGetHubTestServer serves the two plain-HTTP hub-metadata read
// endpoints on a random local port, mirroring the routing in
// handler.go: /v1/hubs/get against the static instance and
// /v1/random-hubs/get against the random instance.
func startGetHubTestServer(t *testing.T, h *handler) string {
	t.Helper()

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		var err error
		switch string(ctx.Path()) {
		case "/v1/hubs/get":
			err = h.GetHub(ctx, h.zeroHub)
		case "/v1/random-hubs/get":
			err = h.GetHub(ctx, h.zeroHubRandom)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		if err != nil {
			// Same contract as Serve in handler.go.
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

// hubJSONBody is the wire shape the spec's Hub schema documents: exactly
// the JSON the hub struct marshals (id, createdAt, metadata, isPermanent).
type hubJSONBody struct {
	ID          string `json:"id"`
	CreatedAt   string `json:"createdAt"`
	Metadata    string `json:"metadata"`
	IsPermanent bool   `json:"isPermanent"`
}

// TestGetHubPlainHTTPContract pins the behavior the re-modeled spec now
// documents: /v1/hubs/get and /v1/random-hubs/get are plain-HTTP GET
// endpoints that answer a single JSON body — no request payload, no
// WebSocket upgrade.
func TestGetHubPlainHTTPContract(t *testing.T) {
	h := newTestHandler()
	h.zeroHub = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	addr := startGetHubTestServer(t, h)
	client := newTestClient(addr)

	// Seed one hub in each namespace.
	if _, err := h.zeroHub.CreateHubIfAbsent("static-room", `{"room":"alpha"}`, false); err != nil {
		t.Fatalf("seed static hub: %v", err)
	}
	if _, err := h.zeroHubRandom.CreateHubIfAbsent("random-room", `{"room":"beta"}`, false); err != nil {
		t.Fatalf("seed random hub: %v", err)
	}

	for path, wantID := range map[string]string{
		"/v1/hubs/get?id=static-room":        "static-room",
		"/v1/random-hubs/get?id=random-room": "random-room",
	} {
		t.Run(path, func(t *testing.T) {
			status, body, err := doRequest(t, client, path, nil)
			if err != nil {
				t.Fatalf("get: transport error: %v", err)
			}
			if status != fasthttp.StatusOK {
				t.Fatalf("get = (%d, %q), want 200", status, body)
			}
			var got hubJSONBody
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("body is not a JSON hub object: %v (body %q)", err, body)
			}
			if got.ID != wantID {
				t.Fatalf("id = %q, want %q", got.ID, wantID)
			}
			if got.IsPermanent {
				t.Fatalf("isPermanent = true, want false")
			}
			if got.CreatedAt == "" {
				t.Fatalf("createdAt is empty, want an RFC3339 timestamp")
			}
			// Exactly the four documented fields, nothing else (the peer
			// roster is not part of the read response).
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(body, &raw); err != nil {
				t.Fatalf("body is not a JSON object: %v", err)
			}
			if len(raw) != 4 {
				t.Fatalf("body has %d fields %v, want exactly 4", len(raw), raw)
			}
		})
	}
}

// TestGetHubMissingID pins the documented 400 response: a request without
// the `id` query parameter is rejected up front, with no hub lookup.
func TestGetHubMissingID(t *testing.T) {
	h := newTestHandler()
	h.zeroHub = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	addr := startGetHubTestServer(t, h)
	client := newTestClient(addr)

	for _, path := range []string{"/v1/hubs/get", "/v1/hubs/get?id=", "/v1/random-hubs/get"} {
		status, body, err := doRequest(t, client, path, nil)
		if err != nil {
			t.Fatalf("%s: transport error: %v", path, err)
		}
		if status != fasthttp.StatusBadRequest {
			t.Fatalf("%s = (%d, %q), want 400", path, status, body)
		}
		var got map[string]string
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("body %q is not JSON: %v", body, err)
		}
		if got["error"] != "id query parameter is required" {
			t.Fatalf("%s: error = %q, want %q", path, got["error"], "id query parameter is required")
		}
	}
}

// TestGetHubNotFound pins the documented 404 response: an unknown id
// answers {"error":"hub not found"} instead of upgrading the connection.
func TestGetHubNotFound(t *testing.T) {
	h := newTestHandler()
	h.zeroHub = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	addr := startGetHubTestServer(t, h)
	client := newTestClient(addr)

	for _, path := range []string{"/v1/hubs/get?id=nope", "/v1/random-hubs/get?id=nope"} {
		status, body, err := doRequest(t, client, path, nil)
		if err != nil {
			t.Fatalf("%s: transport error: %v", path, err)
		}
		if status != fasthttp.StatusNotFound {
			t.Fatalf("%s = (%d, %q), want 404", path, status, body)
		}
		var got map[string]string
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("body %q is not JSON: %v", body, err)
		}
		if got["error"] != "hub not found" {
			t.Fatalf("%s: error = %q, want %q", path, got["error"], "hub not found")
		}
	}
}

// TestGetHubNeverUpgradesWebSocket pins the companion invariant: even when
// a client sends a WebSocket-handshake-shaped request to a get endpoint,
// the server answers plain HTTP (no 101, no close frame). Tooling that
// code-generates from the old spec dialed these as WebSocket channels and
// would hang forever waiting for an upgrade that never happens.
func TestGetHubNeverUpgradesWebSocket(t *testing.T) {
	h := newTestHandler()
	h.zeroHub = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	addr := startGetHubTestServer(t, h)

	if _, err := h.zeroHub.CreateHubIfAbsent("static-room", "", false); err != nil {
		t.Fatalf("seed hub: %v", err)
	}

	for _, target := range []string{"/v1/hubs/get?id=static-room", "/v1/random-hubs/get?id=missing"} {
		t.Run(target, func(t *testing.T) {
			conn, err := net.Dial("tcp", addr)
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			req := "GET " + target + " HTTP/1.1\r\n" +
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
			if statusCode == fasthttp.StatusSwitchingProtocols ||
				(strings.Contains(statusLine, "101") && strings.Contains(got, "Switching Protocols")) {
				t.Fatalf("%s: response upgraded to WebSocket; want a plain-HTTP JSON answer:\n%s", target, got)
			}
			if statusCode != fasthttp.StatusOK && statusCode != fasthttp.StatusNotFound {
				t.Fatalf("%s: status = %q (%d), want 200 or 404", target, statusLine, statusCode)
			}
			// readFirstResponse returns "statusLine\n" + the body, so the
			// JSON body starts right after the first newline.
			bodyIdx := strings.IndexByte(got, '\n')
			if bodyIdx < 0 {
				t.Fatalf("%s: no response body in %q", target, got)
			}
			var gotObj map[string]json.RawMessage
			if err := json.Unmarshal([]byte(got[bodyIdx+1:]), &gotObj); err != nil {
				t.Fatalf("%s: body %q is not a JSON object: %v", target, got[bodyIdx+1:], err)
			}
		})
	}
}

// TestGetHubMigratingForwardsHTTP pins the migration forward: while the
// server is in migrate mode, /v1/hubs/get and /v1/random-hubs/get must
// answer with the HTTP-level migration response — a 301 carrying the
// backup host, the same JSON /v1/status and /v1/permanent-hubs/create
// report — instead of reading local hub state and answering 200/404.
// Pre-fix GetHub was the only hub endpoint missing the isMigrating gate,
// defeating the "clients must move to the backup host" contract every
// sibling endpoint honors. The mock carries no expectations, so any hub
// storage read (GetHubById) would fail the test: no hub state may be
// touched while migrating.
func TestGetHubMigratingForwardsHTTP(t *testing.T) {
	ctrl := gomock.NewController(t)
	// No expectations: a storage read during migration would error out.
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	h := newTestHandler()
	// Single-threaded test: no concurrent access, so the field writes are
	// race-free and need no lock.
	h.backupHost = testBackupHost
	h.isMigrating.Store(true)

	for _, path := range []string{
		"/v1/hubs/get?id=room",
		"/v1/random-hubs/get?id=room",
	} {
		ctx := newRequestCtx("http://127.0.0.1" + path)
		if err := h.GetHub(ctx, zerohubMock); err != nil {
			t.Fatalf("GetHub %s: unexpected error %v", path, err)
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusMovedPermanently {
			t.Fatalf("%s: status = %d (%q), want 301", path, got, ctx.Response.Body())
		}
		checkStatusBody(t, ctx.Response.Body(), "migrating", testBackupHost)
	}
}

// TestGetHubMigratingStillRejectsInvalidHubId pins the ordering: the id
// validation runs before the migration gate, so a request with a missing or
// empty id gets the 400 even while migrating — mirroring CreateHubPermanent,
// where auth and parameter rejection precede any hub-state access.
func TestGetHubMigratingStillRejectsInvalidHubId(t *testing.T) {
	ctrl := gomock.NewController(t)
	// No expectations: no hub lookup may happen for an invalid id.
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	h := newTestHandler()
	h.backupHost = testBackupHost
	h.isMigrating.Store(true)

	for _, path := range []string{"/v1/hubs/get", "/v1/hubs/get?id="} {
		ctx := newRequestCtx("http://127.0.0.1" + path)
		if err := h.GetHub(ctx, zerohubMock); err != nil {
			t.Fatalf("GetHub %s: unexpected error %v", path, err)
		}
		checkInvalidHubIdResponse(t, ctx, path)
	}
}
