package handler

import (
	"net"
	"strconv"
	"testing"

	"github.com/valyala/fasthttp"
)

// These tests pin the intended relationship between the two per-client
// identity sources in this package so they cannot silently diverge or
// converge without a deliberate, reviewed change:
//
//   - clientIP (the IP-hub key, see JoinOrCreateHubIP) is IP-only
//     (RemoteIP, port dropped) so that every connection from one client IP
//     lands in the same hub.
//   - remoteAddrKey (the limiter's default key) and forwardedIPKey (the
//     limiter's trustProxy key) key the rate limiter and are NOT the
//     IP-hub key.
//
// The non-trustProxy sources intentionally differ: remoteAddrKey is the full
// socket address (IP:port), giving each TCP connection its own DoS budget,
// while clientIP drops the port so one IP shares one hub. The test below
// asserts that difference holds; if the two are ever "unified", this test
// fails and the change must be reviewed against both the per-socket throttle
// (ratelimit_test.go) and the IP-hub grouping tests
// (join_or_create_hub_ip_test.go).

// socketCtx builds a RequestCtx whose TCP socket peer is ip:port — the shape
// a real incoming connection has (a non-zero source port).
func socketCtx(ip string, port int) *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.SetRemoteAddr(&net.TCPAddr{IP: net.ParseIP(ip), Port: port})
	return ctx
}

// TestIPHubKeyIsNotLimiterKey pins that the two identity sources are distinct
// on the default (non-trustProxy) path: the IP-hub key is the port-less IP,
// the limiter's key is the full IP:port socket address. This is the
// intentional divergence the docblocks describe — and it is what keeps IP
// hubs grouping by IP while the limiter throttles per socket.
func TestIPHubKeyIsNotLimiterKey(t *testing.T) {
	const (
		socketIP = "203.0.113.5"
		port     = 54321
	)
	ctx := socketCtx(socketIP, port)
	h := newTestHandler() // trustProxy = false

	hubKey := h.clientIP(ctx)
	limiterKey := remoteAddrKey(ctx)

	if hubKey != socketIP {
		t.Fatalf("IP-hub key = %q, want %q (port-less client IP)", hubKey, socketIP)
	}
	if limiterKey != socketIP+":"+strconv.Itoa(port) {
		t.Fatalf("limiter key = %q, want %q (full IP:port socket address)", limiterKey, socketIP+":"+strconv.Itoa(port))
	}
	if hubKey == limiterKey {
		t.Fatalf("IP-hub key and limiter key are both %q — the sources have converged; that changes per-socket throttling and IP-hub grouping, so re-check ratelimit_test.go and join_or_create_hub_ip_test.go", hubKey)
	}
}

// TestTrustProxyKeysShareForwardedSource pins that, behind a trusted proxy,
// BOTH the IP-hub key and the limiter's trustProxy key key off the same
// sanitized X-Forwarded-For value (so real-client budgeting and real-client
// hub grouping stay consistent), and that they only diverge in their
// header-absent fallback (clientIP drops the port, the limiter keeps it).
func TestTrustProxyKeysShareForwardedSource(t *testing.T) {
	const (
		socketIP = "203.0.113.5" // the proxy's socket address
		clientA  = "10.0.0.1"    // the real client recorded by the proxy
	)

	h := newTestHandler()
	h.trustProxy = true

	// With a well-formed X-Forwarded-For, both sources use it.
	ctx := socketCtx(socketIP, 54321)
	ctx.Request.Header.Set("X-Forwarded-For", clientA)
	if got, want := h.clientIP(ctx), clientA; got != want {
		t.Fatalf("IP-hub key = %q, want forwarded client %q", got, want)
	}
	if got, want := forwardedIPKey(ctx), clientA; got != want {
		t.Fatalf("limiter key = %q, want forwarded client %q", got, want)
	}

	// Header absent: both fall back to the socket, but only the limiter
	// keeps the port — so they intentionally differ here too.
	fallback := socketCtx(socketIP, 54321)
	hubFallback := h.clientIP(fallback)
	limiterFallback := forwardedIPKey(fallback)
	if hubFallback != socketIP {
		t.Fatalf("IP-hub fallback = %q, want %q (port-less socket IP)", hubFallback, socketIP)
	}
	if limiterFallback != socketIP+":54321" {
		t.Fatalf("limiter fallback = %q, want %q (full IP:port)", limiterFallback, socketIP+":54321")
	}
	if hubFallback == limiterFallback {
		t.Fatalf("fallbacks are both %q — the IP-hub/limiter divergence has been erased; review the per-socket throttle and IP-hub grouping before accepting", hubFallback)
	}
}
