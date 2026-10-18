package handler

import (
	"testing"

	"github.com/valyala/fasthttp"
)

// newWSHandshakeCtx builds a fresh RequestCtx shaped like a real browser
// WebSocket handshake against the static-hub create endpoint: absolute
// request URI (Host derived from it) plus the four handshake headers, and
// an optional Origin. Mirrors newRequestCtx, which lacks the handshake
// headers the upgrader requires.
func newWSHandshakeCtx(host string, origin string) *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://" + host + "/v1/hubs/create?id=room")
	ctx.Request.Header.Set("Upgrade", "websocket")
	ctx.Request.Header.Set("Connection", "Upgrade")
	ctx.Request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	ctx.Request.Header.Set("Sec-WebSocket-Version", "13")
	if origin != "" {
		ctx.Request.Header.Set("Origin", origin)
	}
	return ctx
}

// wsUpgradeStatus runs the real upgrader path (h.Upgrade -> newWSUpgrader ->
// FastHTTPUpgrader.Upgrade) and reports the response status it produced:
// 403 Forbidden when CheckOrigin rejects the Origin, 101 Switching Protocols
// when the gate passes and the handshake completes (the hijacked connection
// has no real network behind it in-process, but the 101 response is already
// written at that point).
func wsUpgradeStatus(t *testing.T, h *handler, host, origin string) int {
	t.Helper()
	ctx := newWSHandshakeCtx(host, origin)
	seed, _, err := h.zeroHub.GetOrCreateHub("room", "", false)
	if err != nil {
		t.Fatalf("seed hub: %v", err)
	}
	_, _ = h.Upgrade(ctx, h.zeroHub, seed)
	return ctx.Response.StatusCode()
}

// TestWSOriginValidation pins the cross-site WebSocket hijacking fix: the
// upgrader's CheckOrigin (previously a blanket `return true`) must reject a
// request whose Origin host does not match the request Host, accept a
// same-origin request, accept a request with no Origin header (non-browser
// / tooling clients), accept an origin listed in APP_ALLOWED_ORIGINS, and
// reject an unlisted origin.
func TestWSOriginValidation(t *testing.T) {
	t.Run("cross-origin rejected", func(t *testing.T) {
		h := newTestHandler()
		h.zeroHub = newRealZeroHub(t)
		if status := wsUpgradeStatus(t, h, "localhost:8080", "http://evil.example"); status != fasthttp.StatusForbidden {
			t.Fatalf("cross-origin handshake status = %d, want 403", status)
		}
	})

	t.Run("same-origin accepted", func(t *testing.T) {
		h := newTestHandler()
		h.zeroHub = newRealZeroHub(t)
		// Origin host == request Host (including the port).
		if status := wsUpgradeStatus(t, h, "hub.example.com:8080", "http://hub.example.com:8080"); status != fasthttp.StatusSwitchingProtocols {
			t.Fatalf("same-origin handshake status = %d, want 101", status)
		}
	})

	t.Run("no origin accepted", func(t *testing.T) {
		h := newTestHandler()
		h.zeroHub = newRealZeroHub(t)
		if status := wsUpgradeStatus(t, h, "hub.example.com:8080", ""); status != fasthttp.StatusSwitchingProtocols {
			t.Fatalf("no-origin handshake status = %d, want 101", status)
		}
	})

	t.Run("allow-listed origin accepted", func(t *testing.T) {
		h := newTestHandler()
		h.zeroHub = newRealZeroHub(t)
		h.allowedOrigins = parseAllowedOrigins("https://ui.example.com, http://evil.example,")
		if status := wsUpgradeStatus(t, h, "hub.example.com:8080", "http://evil.example"); status != fasthttp.StatusSwitchingProtocols {
			t.Fatalf("allow-listed origin handshake status = %d, want 101", status)
		}
	})

	t.Run("unlisted origin rejected", func(t *testing.T) {
		h := newTestHandler()
		h.zeroHub = newRealZeroHub(t)
		h.allowedOrigins = parseAllowedOrigins("https://ui.example.com")
		if status := wsUpgradeStatus(t, h, "hub.example.com:8080", "http://attacker.example"); status != fasthttp.StatusForbidden {
			t.Fatalf("unlisted origin handshake status = %d, want 403", status)
		}
	})
}

// TestParseAllowedOrigins pins the APP_ALLOWED_ORIGINS parse contract:
// comma-separated, entries trimmed of surrounding whitespace, empty entries
// (trailing commas / blank runs) dropped, and an empty value yielding a nil
// slice (strict same-origin only).
func TestParseAllowedOrigins(t *testing.T) {
	cases := map[string][]string{
		"":                                    nil,
		"  ":                                  nil,
		"https://a.example,":                  {"https://a.example"},
		"https://a.example, http://b.example": {"https://a.example", "http://b.example"},
		"a,b, ,c":                             {"a", "b", "c"},
	}
	for raw, want := range cases {
		t.Run(raw, func(t *testing.T) {
			got := parseAllowedOrigins(raw)
			if len(got) != len(want) {
				t.Fatalf("parseAllowedOrigins(%q) = %v, want %v", raw, got, want)
			}
			for i := range want {
				if got[i] != want[i] {
					t.Fatalf("parseAllowedOrigins(%q)[%d] = %q, want %q", raw, i, got[i], want[i])
				}
			}
		})
	}
}

// TestSameOriginOrAllowed covers the gate helper directly: true with no
// Origin, when the Origin host equals the request Host, and when the full
// Origin value is allow-listed; false on a cross-origin host, an unlisted
// origin, and an unparseable Origin.
func TestSameOriginOrAllowed(t *testing.T) {
	allowed := []string{"https://ui.example.com"}
	cases := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{"no origin", "hub.example.com:8080", "", true},
		{"same origin", "hub.example.com:8080", "http://hub.example.com:8080", true},
		{"allow-listed", "hub.example.com:8080", "https://ui.example.com", true},
		{"cross origin", "hub.example.com:8080", "http://evil.example", false},
		{"unlisted", "hub.example.com:8080", "http://attacker.example", false},
		{"unparseable", "hub.example.com:8080", "://bad", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := newWSHandshakeCtx(tc.host, tc.origin)
			if got := sameOriginOrAllowed(ctx, allowed); got != tc.want {
				t.Fatalf("sameOriginOrAllowed(host=%s, origin=%q) = %v, want %v", tc.host, tc.origin, got, tc.want)
			}
		})
	}
}
