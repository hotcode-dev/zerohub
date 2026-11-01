package handler

import (
	"strconv"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"github.com/zeebo/xxh3"
)

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

	return h.JoinOrCreateHubByID(ctx, zh, strconv.FormatUint(xxh3.HashString(h.clientIP(ctx)), 10))
}
