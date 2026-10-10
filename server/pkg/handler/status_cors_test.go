package handler

import (
	"testing"

	"github.com/valyala/fasthttp"
)

// TestStatusCORS pins the /v1/status CORS contract: the response carries a
// static Access-Control-Allow-Origin: * (plus Vary: Origin) for every
// request, regardless of the request's Origin header. /v1/status is a
// public, read-only endpoint that any community origin may call — but the
// header must NOT reflect the request's Origin verbatim (the classic
// "reflect any origin" anti-pattern): a page that sends Origin:
// https://evil.example.com gets "*", not https://evil.example.com.
func TestStatusCORS(t *testing.T) {
	origins := []string{
		"http://hub.example.com",
		"https://evil.example.com",
		"*",
		"null",
		"",
	}

	for _, origin := range origins {
		t.Run("origin "+origin, func(t *testing.T) {
			h := newTestHandler()
			addr := startTestServer(t, h)
			client := newTestClient(addr)

			// doRequest in migrate_test.go drops the response headers, so
			// build one that keeps them; a fresh client per subtest avoids
			// pooled connection bleed.
			req := fasthttp.AcquireRequest()
			resp := fasthttp.AcquireResponse()
			defer fasthttp.ReleaseRequest(req)
			defer fasthttp.ReleaseResponse(resp)

			req.SetRequestURI("http://" + client.Addr + "/v1/status")
			if origin != "" {
				req.Header.Set("Origin", origin)
			}
			if err := client.Do(req, resp); err != nil {
				t.Fatalf("status request: %v", err)
			}

			if resp.StatusCode() != fasthttp.StatusOK {
				t.Errorf("status code = %d, want %d", resp.StatusCode(), fasthttp.StatusOK)
			}
			got := string(resp.Header.Peek("Access-Control-Allow-Origin"))
			if got != "*" {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
			}
			if got := string(resp.Header.Peek("Vary")); got != "Origin" {
				t.Errorf("Vary = %q, want %q", got, "Origin")
			}
			checkStatusBody(t, resp.Body(), "ok", "")
		})
	}
}

// TestStatusCORSMigrating verifies the same static CORS contract while the
// server is in migration state: every origin still reads the 301 +
// backupHost body with Access-Control-Allow-Origin: *, and the reflected
// origin is never echoed back.
func TestStatusCORSMigrating(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	// Enter migration state the same way the admin endpoint does.
	if status, _, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()}); err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate setup = (%d, %v), want 200", status, err)
	}

	for _, origin := range []string{"https://hub.example.com", "https://evil.example.com"} {
		t.Run("origin "+origin, func(t *testing.T) {
			req := fasthttp.AcquireRequest()
			resp := fasthttp.AcquireResponse()
			defer fasthttp.ReleaseRequest(req)
			defer fasthttp.ReleaseResponse(resp)

			req.SetRequestURI("http://" + client.Addr + "/v1/status")
			req.Header.Set("Origin", origin)
			if err := client.Do(req, resp); err != nil {
				t.Fatalf("status request: %v", err)
			}

			if resp.StatusCode() != fasthttp.StatusMovedPermanently {
				t.Errorf("migrating status code = %d, want 301", resp.StatusCode())
			}
			if got := string(resp.Header.Peek("Access-Control-Allow-Origin")); got != "*" {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
			}
			checkStatusBody(t, resp.Body(), "migrating", testBackupHost)
		})
	}
}
