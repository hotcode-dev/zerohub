package handler

import (
	"github.com/valyala/fasthttp"
)

// Migrate
// Set the server to migrate mode. It will forward all request to the new server url,
// until this server got no Hub left for the graceful shutdown.
func (h *handler) Migrate(ctx *fasthttp.RequestCtx) error {
	return nil
}
