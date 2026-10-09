package handler

import (
	"testing"

	"github.com/valyala/fasthttp"
)

// newTestHandlerWithDomain is like newTestHandler but also sets the configured
// APP_DOMAIN, so the /v1/status CORS gate can be exercised.
func newTestHandlerWithDomain(domain string) *handler {
	return &handler{clientSecret: testClientSecret, domain: domain}
}

// statusCORSRequest runs a GET /v1/status with the given request headers
// against a live test server and returns the response status code, body, and
// the Access-Control-Allow-Origin / Vary headers as a map.
func statusCORSRequest(t *testing.T, h *handler, headers map[string]string) (int, []byte, map[string]string) {
	t.Helper()

	// doRequest in migrate_test.go drops headers, so build one that keeps
	// them: fresh fasthttp client per call to avoid pool header bleed.
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI("http://" + client.Addr + "/v1/status")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if err := client.Do(req, resp); err != nil {
		t.Fatalf("status request: %v", err)
	}

	got := map[string]string{}
	if v := string(resp.Header.Peek("Access-Control-Allow-Origin")); v != "" {
		got["Access-Control-Allow-Origin"] = v
	}
	if v := string(resp.Header.Peek("Vary")); v != "" {
		got["Vary"] = v
	}
	return resp.StatusCode(), append([]byte(nil), resp.Body()...), got
}

// TestStatusCORS pins the /v1/status CORS contract: Access-Control-Allow-
// Origin is emitted only for a valid http/https Origin whose host equals the
// configured APP_DOMAIN. It must never reflect an arbitrary Origin back —
// that is the bug this test guards (a cross-origin attacker page could
// otherwise read the migration state: status + backupHost).
func TestStatusCORS(t *testing.T) {
	const domain = "hub.example.com"

	tests := []struct {
		name     string
		origin   string
		wantACAO string // "" means the header must be absent
		wantVary string
		wantBody string // expected "status" JSON field value ("" = not migrating)
		wantHost string // expected backupHost JSON field value
		wantCode int
	}{
		{
			name:     "matching http origin is allowed",
			origin:   "http://" + domain,
			wantACAO: "http://" + domain,
			wantVary: "Origin",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "matching https origin is allowed (scheme-agnostic host match)",
			origin:   "https://" + domain,
			wantACAO: "https://" + domain,
			wantVary: "Origin",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "subdomain origin is rejected",
			origin:   "https://evil." + domain,
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "unrelated origin is rejected",
			origin:   "https://evil.example.com",
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "wildcard origin is rejected",
			origin:   "*",
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "null origin is rejected",
			origin:   "null",
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "non-http scheme origin is rejected",
			origin:   "chrome-extension://abc",
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
		{
			name:     "no origin header: no CORS headers, body still readable",
			origin:   "",
			wantACAO: "",
			wantBody: "ok",
			wantCode: fasthttp.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandlerWithDomain(domain)
			headers := map[string]string{}
			if tt.origin != "" {
				headers["Origin"] = tt.origin
			}
			status, body, hdrs := statusCORSRequest(t, h, headers)
			if status != tt.wantCode {
				t.Errorf("status code = %d, want %d", status, tt.wantCode)
			}
			if got := hdrs["Access-Control-Allow-Origin"]; got != tt.wantACAO {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, tt.wantACAO)
			}
			if got := hdrs["Vary"]; got != tt.wantVary {
				t.Errorf("Vary = %q, want %q", got, tt.wantVary)
			}
			checkStatusBody(t, body, tt.wantBody, tt.wantHost)
		})
	}
}

// TestStatusCORSMigrating verifies the gate applies identically while the
// server is in migration state: a same-domain origin may still read the
// backupHost 301, a mismatched origin gets neither the CORS headers nor the
// migration state.
func TestStatusCORSMigrating(t *testing.T) {
	const domain = "hub.example.com"
	h := newTestHandlerWithDomain(domain)
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	// Enter migration state the same way the admin endpoint does.
	if status, _, err := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()}); err != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate setup = (%d, %v), want 200", status, err)
	}

	// Legitimate same-domain origin reads the migration redirect cross-origin.
	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)
	req.SetRequestURI("http://" + client.Addr + "/v1/status")
	req.Header.Set("Origin", "https://"+domain)
	if err := client.Do(req, resp); err != nil {
		t.Fatalf("status request: %v", err)
	}
	if got := string(resp.Header.Peek("Access-Control-Allow-Origin")); got != "https://"+domain {
		t.Errorf("migrating same-domain Access-Control-Allow-Origin = %q, want %q", got, "https://"+domain)
	}
	if resp.StatusCode() != fasthttp.StatusMovedPermanently {
		t.Errorf("migrating status code = %d, want 301", resp.StatusCode())
	}
	checkStatusBody(t, resp.Body(), "migrating", testBackupHost)

	// Attacker origin is denied: no CORS headers, and a browser cannot read
	// the migration body cross-origin anyway.
	req2 := fasthttp.AcquireRequest()
	resp2 := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req2)
	defer fasthttp.ReleaseResponse(resp2)
	req2.SetRequestURI("http://" + client.Addr + "/v1/status")
	req2.Header.Set("Origin", "https://evil.example.com")
	if err := client.Do(req2, resp2); err != nil {
		t.Fatalf("status request (attacker): %v", err)
	}
	if got := string(resp2.Header.Peek("Access-Control-Allow-Origin")); got != "" {
		t.Errorf("migrating attacker Access-Control-Allow-Origin = %q, want empty", got)
	}
	// The body itself is unchanged for non-CORS clients: shape must remain
	// stable so the client SDK's migration-read contract is preserved.
	checkStatusBody(t, resp2.Body(), "migrating", testBackupHost)
}
