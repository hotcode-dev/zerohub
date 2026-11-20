package handler

import (
	"hash/fnv"
	"strconv"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// fnvHash64a returns the FNV-1a 64-bit hash of s as a base-10 string. The
// IP-hub key is a server-generated opaque id; FNV-1a is a stable stdlib
// hash (no third-party dep) whose output is fine for an opaque,
// collision-resistant-enough key over IPv4/IPv6 literals.
func fnvHash64a(s string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return strconv.FormatUint(h.Sum64(), 10)
}

// JoinOrCreateHubIP joins or creates a hub using the client's IP address as
// the hub ID. The key comes from h.clientIP so that, behind a trusted
// reverse proxy (APP_TRUST_PROXY=true), it is derived from the real client IP
// recorded in X-Forwarded-For — rather than the proxy's socket address.
//
// Note the IP-hub key is IP-only (RemoteIP, port dropped) so that all
// connections from one client IP share a hub; that is intentionally
// different from the rate limiter, which keys by the full socket address
// (IP:port) so each connection gets its own DoS budget. See clientIP.
func (h *handler) JoinOrCreateHubIP(ctx *fasthttp.RequestCtx, zh zerohub.ZeroHub) error {
	if h.isMigrating.Load() {
		return h.ForwardMigrate(ctx)
	}

	return h.JoinOrCreateHubByID(ctx, zh, fnvHash64a(h.clientIP(ctx)))
}
