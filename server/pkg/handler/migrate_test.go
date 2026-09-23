package handler

import (
	"encoding/base64"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/valyala/fasthttp"
)

const (
	testClientSecret = "change_this_salt"
	testBackupHost   = "backup.example.com:9090"
)

// newTestHandler builds a handler with a known client secret, mirroring the
// construction in mockHandlerAndTest (test_util.go).
func newTestHandler() *handler {
	return &handler{clientSecret: testClientSecret}
}

// adminAuthHeader returns the base64-encoded admin authorization header value.
func adminAuthHeader() string {
	return base64.StdEncoding.EncodeToString([]byte(testClientSecret))
}

// startTestServer serves the handler's real migration endpoints on a random
// local port. Requests therefore land in fasthttp worker goroutines, exactly
// like production, which is what the regression test below hammers.
func startTestServer(t *testing.T, h *handler) string {
	t.Helper()

	requestHandler := func(ctx *fasthttp.RequestCtx) {
		var err error
		switch string(ctx.Path()) {
		case "/v1/status":
			err = h.Status(ctx)
		case "/v1/admin/migrate":
			err = h.Migrate(ctx)
		case "/v1/forward":
			// ForwardMigrate without a real websocket upgrade. The handshake
			// is rejected for a plain GET, but the migration state is read
			// before the handshake attempt — which is what this test hammers.
			err = h.ForwardMigrate(ctx)
		default:
			ctx.Error("unsupported path", fasthttp.StatusNotFound)
			return
		}
		// Same error handling as Serve in handler.go: 503 with the message.
		if err != nil {
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

// newTestClient returns a connection-pooling fasthttp client for the test server.
func newTestClient(addr string) *fasthttp.HostClient {
	return &fasthttp.HostClient{
		Addr:                addr,
		ReadTimeout:         10 * time.Second,
		WriteTimeout:        10 * time.Second,
		MaxIdleConnDuration: 2 * time.Second,
	}
}

// doRequest performs a GET and returns the status code, body and any transport
// error. Callers running in worker goroutines must not use t.Fatalf on error.
func doRequest(t *testing.T, client *fasthttp.HostClient, path string, headers map[string]string) (int, []byte, error) {
	t.Helper()

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI("http://" + client.Addr + path) // host, path and query parsed from the absolute URL
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if err := client.Do(req, resp); err != nil {
		return 0, nil, err
	}
	return resp.StatusCode(), append([]byte(nil), resp.Body()...), nil
}

// checkStatusBody validates the JSON shape of a /v1/status body.
func checkStatusBody(t *testing.T, body []byte, wantStatus, wantBackupHost string) {
	t.Helper()

	var st struct {
		Status     string `json:"status"`
		BackupHost string `json:"backupHost"`
	}
	if err := json.Unmarshal(body, &st); err != nil {
		t.Errorf("status body %q is not valid JSON: %v", body, err)
		return
	}
	if st.Status != wantStatus || st.BackupHost != wantBackupHost {
		t.Errorf("status body = {status:%q backupHost:%q}, want {status:%q backupHost:%q}",
			st.Status, st.BackupHost, wantStatus, wantBackupHost)
	}
}

// TestMigrateFlow pins the documented migration behavior (see migrate.go
// header): auth required, host required, status flips to a 301 with the
// backup host once migrating, and ForwardMigrate errors when no backup host
// is set.
func TestMigrateFlow(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)
	withAuth := map[string]string{"Authorization": adminAuthHeader()}

	// Status before migration.
	status, body, err := doRequest(t, client, "/v1/status", nil)
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("status before migrate = (%d, %q, %v), want 200 ok", status, body, err)
	}
	checkStatusBody(t, body, "ok", "")

	// Migrate without a host.
	status, body, err = doRequest(t, client, "/v1/admin/migrate", withAuth)
	if err != nil || status != fasthttp.StatusServiceUnavailable ||
		!strings.Contains(string(body), "new release host not found") {
		t.Fatalf("migrate without host = (%d, %q, %v), want 503 'new release host not found'", status, body, err)
	}

	// ForwardMigrate before migration.
	status, body, err = doRequest(t, client, "/v1/forward", nil)
	if err != nil || status != fasthttp.StatusServiceUnavailable ||
		!strings.Contains(string(body), "backup host not found") {
		t.Fatalf("forward before migrate = (%d, %q, %v), want 503 'backup host not found'", status, body, err)
	}

	// Migrate with auth.
	status, _, err = doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost, withAuth)
	if err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with auth = (%d, %v), want 200", status, err)
	}
	if !h.isMigrating.Load() || h.getBackupHost() != testBackupHost {
		t.Fatalf("migration state = (migrating:%v, backupHost:%q), want (true, %q)",
			h.isMigrating.Load(), h.getBackupHost(), testBackupHost)
	}

	// Status after migration.
	status, body, err = doRequest(t, client, "/v1/status", nil)
	if err != nil || status != fasthttp.StatusMovedPermanently {
		t.Fatalf("status after migrate = (%d, %q, %v), want 301", status, body, err)
	}
	checkStatusBody(t, body, "migrating", testBackupHost)
}

// TestMigrateUnauthorized pins the pre-existing auth behavior on a fresh
// handler: CheckAdminAuth writes the 401 JSON body but returns a nil error
// (h.Response never returns an error), so Migrate proceeds to set migration
// state and overwrite the status with 200. This is a pre-existing quirk, not
// part of the concurrency fix — it is pinned here so a future auth change is
// deliberate. It uses its own handler because the no-auth call still flips
// migration state on this one.
func TestMigrateUnauthorized(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	status, body, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost, nil)
	if err != nil || status != fasthttp.StatusOK ||
		!strings.Contains(string(body), "invalid authorization code") {
		t.Fatalf("migrate without auth = (%d, %q, %v), want 200 'invalid authorization code'", status, body, err)
	}
	if !h.isMigrating.Load() || h.getBackupHost() != testBackupHost {
		t.Fatalf("migration state = (migrating:%v, backupHost:%q), want (true, %q)",
			h.isMigrating.Load(), h.getBackupHost(), testBackupHost)
	}
}

// TestMigrateConcurrentAccessRace hammers the Migrate endpoint (writer)
// concurrently with Status and ForwardMigrate (readers) across fasthttp
// worker goroutines. Under `go test -race` the old unsynchronized
// handler.isMigrating / handler.backupHost fields were flagged on exactly
// these accesses; the consistency assertions below also fail if a reader ever
// observes isMigrating=true with an empty or torn backupHost.
func TestMigrateConcurrentAccessRace(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)
	withAuth := map[string]string{"Authorization": adminAuthHeader()}

	const (
		migrateWorkers = 3
		statusWorkers  = 6
		forwardWorkers = 4
		workerIters    = 2000
	)

	var wg sync.WaitGroup

	for i := 0; i < migrateWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < workerIters; j++ {
				status, _, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost, withAuth)
				if err != nil {
					t.Errorf("migrate request: %v", err)
					return
				}
				if status != fasthttp.StatusOK {
					t.Errorf("migrate returned %d, want 200", status)
					return
				}
			}
		}()
	}

	for i := 0; i < statusWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < workerIters; j++ {
				status, body, err := doRequest(t, client, "/v1/status", nil)
				if err != nil {
					t.Errorf("status request: %v", err)
					return
				}
				if status == fasthttp.StatusOK {
					checkStatusBody(t, body, "ok", "")
					continue
				}
				if status != fasthttp.StatusMovedPermanently {
					t.Errorf("status returned %d, want 200 or 301", status)
					return
				}
				// Invariant: isMigrating must imply a fully set backupHost.
				checkStatusBody(t, body, "migrating", testBackupHost)
			}
		}()
	}

	for i := 0; i < forwardWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < workerIters; j++ {
				// The plain-GET handshake is rejected, but the backupHost
				// read inside ForwardMigrate happens before the handshake.
				if _, _, err := doRequest(t, client, "/v1/forward", nil); err != nil {
					t.Errorf("forward request: %v", err)
					return
				}
			}
		}()
	}

	wg.Wait()

	// Final state must be a consistent migrating one.
	if !h.isMigrating.Load() {
		t.Fatal("isMigrating is false after concurrent Migrate calls")
	}
	if got := h.getBackupHost(); got != testBackupHost {
		t.Fatalf("backupHost = %q, want %q", got, testBackupHost)
	}
	status, body, err := doRequest(t, client, "/v1/status", nil)
	if err != nil || status != fasthttp.StatusMovedPermanently {
		t.Fatalf("final status = (%d, %q, %v), want 301", status, body, err)
	}
	checkStatusBody(t, body, "migrating", testBackupHost)
}
