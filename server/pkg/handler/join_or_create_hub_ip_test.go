package handler

import (
	"net"
	"strconv"
	"strings"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"github.com/zeebo/xxh3"
	"go.uber.org/mock/gomock"
)

// ipHubKeyFor returns the hub ID the handler should derive for the given
// client IP — the exact hashing scheme JoinOrCreateHubIP applies.
func ipHubKeyFor(clientIP string) string {
	return strconv.FormatUint(xxh3.HashString(clientIP), 10)
}

// captureHubKey builds a mock ZeroHub that records the hub ID passed to
// GetOrCreateHub and returns a shared hub. The websocket handshake then
// fails (plain GET, no upgrade) — a benign, expected error.
func captureHubKey(t *testing.T, got *string) zerohub.ZeroHub {
	t.Helper()
	ctrl := gomock.NewController(t)
	sharedHub, err := hub.NewHub("shared", "", nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	zerohubMock.EXPECT().
		GetOrCreateHub(gomock.Any(), gomock.Any(), false).
		DoAndReturn(func(hubId string, metadata string, isPermanent bool) (hub.Hub, error) {
			*got = hubId
			return sharedHub, nil
		})
	return zerohubMock
}

// joinOrCreateHubIPRequest assembles a handler-level request with the given
// socket peer address and optional X-Forwarded-For value, then invokes
// JoinOrCreateHubIP on it, returning the hub ID the handler derived.
func joinOrCreateHubIPRequest(t *testing.T, h *handler, got *string, socketIP, xff string) string {
	t.Helper()

	ctx := &fasthttp.RequestCtx{}
	// RemoteIP() only reads *net.TCPAddr values (addrToIP), so the
	// socket peer must be a TCP address for the fallback key to be
	// meaningful.
	ctx.SetRemoteAddr(&net.TCPAddr{IP: net.ParseIP(socketIP)})
	if xff != "" {
		ctx.Request.Header.Set("X-Forwarded-For", xff)
	}

	zh := captureHubKey(t, got)
	if err := h.JoinOrCreateHubIP(ctx, zh); err != nil && strings.Contains(err.Error(), "create hub error") {
		t.Fatalf("JoinOrCreateHubIP: %v (hub resolution failed)", err)
	}
	return *got
}

// TestJoinOrCreateHubIPTrustProxyKeysByRealClientIP is the regression test
// for the IP-hub key ignoring APP_TRUST_PROXY. Behind a trusted proxy the
// hub must be keyed by the real client IP recorded in X-Forwarded-For — the
// same source the rate limiter keys on — not the proxy's socket address.
// Two different real clients sharing one proxy socket must therefore land in
// two different hubs. Before the fix, every request was hashed from
// ctx.RemoteIP() (the proxy), so all clients collapsed into one shared hub.
func TestJoinOrCreateHubIPTrustProxyKeysByRealClientIP(t *testing.T) {
	const (
		socketIP = "203.0.113.5" // the proxy's socket address
		clientA  = "10.0.0.1"
		clientB  = "10.0.0.2"
	)

	h := newTestHandler()
	h.trustProxy = true

	// Same socket peer for every request: only the forwarded header
	// distinguishes the real clients.
	t.Run("client A", func(t *testing.T) {
		var got string
		if got = joinOrCreateHubIPRequest(t, h, &got, socketIP, clientA); got != ipHubKeyFor(clientA) {
			t.Fatalf("hub key = %q, want %q (keyed by real client IP %s)", got, ipHubKeyFor(clientA), clientA)
		}
	})
	t.Run("client B", func(t *testing.T) {
		var got string
		if got = joinOrCreateHubIPRequest(t, h, &got, socketIP, clientB); got != ipHubKeyFor(clientB) {
			t.Fatalf("hub key = %q, want %q (keyed by real client IP %s)", got, ipHubKeyFor(clientB), clientB)
		}
	})
	t.Run("distinct keys", func(t *testing.T) {
		if ipHubKeyFor(clientA) == ipHubKeyFor(clientB) {
			t.Fatal("two distinct real clients derived the same hub key — hub isolation broken")
		}
	})
	t.Run("header absent falls back to socket peer", func(t *testing.T) {
		var got string
		if got = joinOrCreateHubIPRequest(t, h, &got, socketIP, ""); got != ipHubKeyFor(socketIP) {
			t.Fatalf("hub key = %q, want %q (fallback to socket peer)", got, ipHubKeyFor(socketIP))
		}
	})
}

// TestJoinOrCreateHubIPIgnoresForwardedHeaderByDefault pins that with
// trustProxy=false (the default), the X-Forwarded-For header must NOT change
// the derived key: the hub is keyed by the socket peer address, which a
// client cannot spoof.
func TestJoinOrCreateHubIPIgnoresForwardedHeaderByDefault(t *testing.T) {
	const (
		socketIP = "203.0.113.5"
		forgedA  = "10.0.0.1"
		forgedB  = "10.0.0.2"
	)

	// trustProxy = false (newTestHandler default).
	h := newTestHandler()

	var gotA, gotB string
	gotA = joinOrCreateHubIPRequest(t, h, &gotA, socketIP, forgedA)
	gotB = joinOrCreateHubIPRequest(t, h, &gotB, socketIP, forgedB)

	if want := ipHubKeyFor(socketIP); gotA != want || gotB != want {
		t.Fatalf("hub keys = (%q, %q), want both %q (keyed by socket peer, X-Forwarded-For ignored)", gotA, gotB, want)
	}
}
