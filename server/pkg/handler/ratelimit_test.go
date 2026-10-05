package handler

import (
	"fmt"
	"net"
	"testing"

	"github.com/valyala/fasthttp"
)

// startRateLimitedServer serves a no-op handler wrapped in the production
// rate-limit middleware (newRateLimitMiddleware) on a random local port.
// Requests therefore land in fasthttp worker goroutines exactly like
// production (see startTestServer in migrate_test.go).
func startRateLimitedServer(t *testing.T, trustProxy bool) string {
	t.Helper()

	middleware, err := newRateLimitMiddleware(trustProxy)
	if err != nil {
		t.Fatalf("newRateLimitMiddleware(%v): %v", trustProxy, err)
	}

	next := func(ctx *fasthttp.RequestCtx) {
		ctx.SetBodyString("ok")
	}

	server := &fasthttp.Server{
		Handler:            middleware.Handle(next),
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

// TestRateLimitSingleKeyPerSocket is the regression test for the spoofable
// rate-limit key. The production rate is 60 requests per minute per client
// key. A client that forges a distinct X-Forwarded-For header on every
// request used to get a fresh 60-request budget per forged value, defeating
// the DoS throttle. With the fix the default middleware keys by the socket
// peer address, so one socket shares a single budget regardless of the
// X-Forwarded-For values it presents: exactly 60 requests succeed and the
// 61st is rejected with 429.
func TestRateLimitSingleKeyPerSocket(t *testing.T) {
	addr := startRateLimitedServer(t, false)
	client := newTestClient(addr)

	const (
		limit     = 60 // production rate is "60-M"
		totalReqs = limit + 1
	)

	var ok, limited int
	for i := 0; i < totalReqs; i++ {
		// Forge a distinct client IP on every request from the same socket.
		xff := fmt.Sprintf("10.0.0.%d", i+1)
		status, _, err := doRequest(t, client, "/v1/status", map[string]string{"X-Forwarded-For": xff})
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		switch status {
		case fasthttp.StatusOK:
			ok++
		case fasthttp.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("request %d: status %d, want 200 or 429", i, status)
		}
	}

	if ok != limit {
		t.Fatalf("%d requests succeeded with distinct forged X-Forwarded-For values, want %d (single shared budget per socket)", ok, limit)
	}
	if limited != 1 {
		t.Fatalf("got %d 429 responses for %d requests from one socket, want exactly 1", limited, totalReqs)
	}
}

// TestRateLimitDefaultIgnoresRealIPHeader documents that the default
// (no-trusted-proxy) mode also ignores X-Real-IP: the middleware's key
// getter never consults client-controlled headers.
func TestRateLimitDefaultIgnoresRealIPHeader(t *testing.T) {
	addr := startRateLimitedServer(t, false)
	client := newTestClient(addr)

	for i := 0; i < 61; i++ {
		status, _, err := doRequest(t, client, "/v1/status", map[string]string{"X-Real-IP": fmt.Sprintf("10.0.1.%d", i+1)})
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		if i < 60 && status != fasthttp.StatusOK {
			t.Fatalf("request %d: status %d, want 200", i, status)
		}
		if i == 60 && status != fasthttp.StatusTooManyRequests {
			t.Fatalf("request 60: status %d, want 429", status)
		}
	}
}

// TestRateLimitTrustProxyKeysByForwardedIP pins the behavior when
// APP_TRUST_PROXY is enabled: the per-client budget is keyed by the
// X-Forwarded-For value recorded by the (sanitizing) proxy. Two different
// client IPs get independent budgets, while a single client IP exhausts its
// own 60-request budget and is then limited.
func TestRateLimitTrustProxyKeysByForwardedIP(t *testing.T) {
	addr := startRateLimitedServer(t, true)
	client := newTestClient(addr)

	const (
		clientA = "203.0.113.7"
		clientB = "198.51.100.9"
	)

	// Client A exhausts its own budget.
	for i := 0; i < 60; i++ {
		status, _, err := doRequest(t, client, "/v1/status", map[string]string{"X-Forwarded-For": clientA})
		if err != nil {
			t.Fatalf("client A request %d: %v", i, err)
		}
		if status != fasthttp.StatusOK {
			t.Fatalf("client A request %d: status %d, want 200", i, status)
		}
	}
	status, _, err := doRequest(t, client, "/v1/status", map[string]string{"X-Forwarded-For": clientA})
	if err != nil {
		t.Fatalf("client A request 60: %v", err)
	}
	if status != fasthttp.StatusTooManyRequests {
		t.Fatalf("client A request 60: status %d, want 429", status)
	}

	// Client B (different IP from the same socket) still has a fresh budget.
	status, _, err = doRequest(t, client, "/v1/status", map[string]string{"X-Forwarded-For": clientB})
	if err != nil {
		t.Fatalf("client B request: %v", err)
	}
	if status != fasthttp.StatusOK {
		t.Fatalf("client B request: status %d, want 200 (independent budget per client IP)", status)
	}
}
