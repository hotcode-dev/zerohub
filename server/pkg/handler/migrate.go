package handler

import (
	"encoding/base64"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// Migrate
// Set the server to migrate mode. It will forward all new hub to the new server url,
// until this server got no Hub left for graceful shutdown.
// The DNS need to change to the new server
//
// Example deploy scenario,
// 1. Current DNS sg1.zerohub.dev to old-server-url
// 2. Deploy the new server
// 3. Change DNS sg1.zerohub.dev to new-server-url (not affect immediatly, waiting TTL or update)
// 4. Call `old-server-url/configs/migrate?url=new-server-url`
// 5. All the new create Hub request will forward to `new-server-url`, and store the new hub id
// 6. If join request have the new hub id, it will forward to the new server
// 7. If no hub left, the old server will shutdown
func (h *handler) Migrate(ctx *fasthttp.RequestCtx) error {
	authCode, err := base64.StdEncoding.DecodeString(string(ctx.Request.Header.Peek("Authorization")))
	if err != nil {
		return fmt.Errorf("error decoding authorization code: %w", err)
	}
	if string(authCode) != h.cfg.App.ClientSecret {
		return fmt.Errorf("invalid authorization code")
	}

	h.mg.Migrate(string(ctx.QueryArgs().Peek("url")))

	log.Warn().Msg("migrate mode enabled")

	return nil
}

func (h *handler) Forward(ctx *fasthttp.RequestCtx) error {
	newReleaseURL := h.mg.GetNewReleaseURL()

	// TODO

	req := fasthttp.AcquireRequest()
	defer fasthttp.ReleaseRequest(req)

	// Set original request body to the new request
	req.SetBody(ctx.Request.Body())

	// Set original request headers to the new request
	ctx.Request.Header.CopyTo(&req.Header)

	// Set the request URL to the new release URL
	req.SetRequestURI(newReleaseURL)

	// Perform the request
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseResponse(resp)
	if err := fasthttp.Do(req, resp); err != nil {
		return fmt.Errorf("error forwarding request: %w", err)
	}

	// Write the response back to the original client
	ctx.SetStatusCode(resp.StatusCode())
	resp.Header.VisitAll(func(key, value []byte) {
		ctx.Response.Header.SetBytesKV(key, value)
	})
	ctx.Write(resp.Body())

	return nil
}
