package handler

import (
	"net/url"
	"strings"

	"github.com/valyala/fasthttp"
)

// Status returns the status of the server.
//
// CORS: the response is readable by same-origin callers without any
// cross-origin permission. For a cross-origin reader (a browser page on a
// different origin calling /v1/status), Access-Control-Allow-Origin is
// emitted ONLY when the request's Origin header is a valid http/https origin
// whose host equals the configured APP_DOMAIN (h.domain, case-insensitive).
// This deliberately does NOT reflect the Origin header back: an attacker
// sending Origin: https://evil.com must not be able to read the migration
// state (status + backupHost) from their page. Origin: "*", "null",
// non-http(s) schemes, or an absent Origin all yield no CORS headers, so a
// browser cross-origin read is blocked while the legitimate same-site UI
// (and any non-browser client) keeps working unchanged. Vary: Origin is
// emitted alongside the allow header so caches never serve an allow-origin
// response to a different origin.
func (h *handler) Status(ctx *fasthttp.RequestCtx) error {
	origin := string(ctx.Request.Header.Peek("Origin"))
	if allowed, v := h.originAllowed(origin); allowed {
		ctx.Response.Header.Set("Access-Control-Allow-Origin", v)
		ctx.Response.Header.Add("Vary", "Origin")
	}

	if h.isMigrating.Load() {
		return h.Response(ctx, fasthttp.StatusMovedPermanently, map[string]string{"status": "migrating", "backupHost": h.getBackupHost()})
	}

	return h.Response(ctx, fasthttp.StatusOK, map[string]string{"status": "ok"})
}

// originAllowed reports whether the raw Origin request header value is allowed
// to read /v1/status cross-origin, and returns the value to echo in
// Access-Control-Allow-Origin. Only exact http/https origins whose host
// matches the configured APP_DOMAIN pass. An empty result (origin absent or
// rejected) means no CORS headers must be set.
func (h *handler) originAllowed(origin string) (bool, string) {
	// An absent Origin (plain same-origin GET or non-browser client) needs no
	// CORS headers; it is readable as-is.
	if origin == "" {
		return false, ""
	}
	// Reject wildcards and the "null" opaque-origin literal before parsing,
	// so they can never satisfy the host match.
	if origin == "*" || origin == "null" {
		return false, ""
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false, ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false, ""
	}
	if u.Host == "" || !strings.EqualFold(u.Host, h.domain) {
		return false, ""
	}
	return true, origin
}
