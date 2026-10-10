package handler

import (
	"strings"

	"github.com/valyala/fasthttp"
)

// validHubId reports whether a hub ID is usable: non-empty and not
// whitespace-only. Callers of the shared by-ID helpers pass either the
// static ID read verbatim from the `id` query parameter or a
// server-generated ID (uuid for random hubs, xxh3 hash for IP hubs) — the
// latter are never empty, so this check is a no-op for those paths.
// Rejecting an empty ID up front stops a request with a missing/empty `id`
// from silently creating a hub under the empty-string key, which would
// squat that key forever (every later empty-id create gets 409, and any
// join without `id` lands in that junk hub instead of a clean 404).
func validHubId(hubId string) bool {
	return strings.TrimSpace(hubId) != ""
}

// rejectInvalidHubIdParam writes the 400 for a missing/empty `id` query
// parameter. It reuses Response (which returns nil on success) so the
// caller's 503 error fallback in Serve cannot overwrite the 400 body.
func (h *handler) rejectInvalidHubIdParam(ctx *fasthttp.RequestCtx) error {
	return h.Response(ctx, fasthttp.StatusBadRequest,
		map[string]string{"error": "id query parameter is required"})
}
