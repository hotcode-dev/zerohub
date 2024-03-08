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

	newReleaseHost := string(ctx.QueryArgs().Peek("host"))
	if newReleaseHost == "" {
		return fmt.Errorf("new release host not found")
	}

	h.mg.Migrate(newReleaseHost)

	log.Debug().Msg("migrate mode enabled: " + newReleaseHost)

	ctx.SetStatusCode(fasthttp.StatusOK)

	return nil
}

func (h *handler) ForwardMigrate(ctx *fasthttp.RequestCtx) error {
	newReleaseHost := h.mg.GetNewReleaseHost()

	// The 301 status is working fine on multi library following the rfc6455
	// https://www.rfc-editor.org/rfc/rfc6455#section-4.1
	//
	// If the status code received from the server is not 101, the
	// client handles the response per HTTP [RFC2616] procedures.  In
	// particular, the client might perform authentication if it
	// receives a 401 status code; the server might redirect the client
	// using a 3xx status code (but clients are not required to follow
	// them), etc.
	//
	// But the Native browser Websocket not suppot the redirection
	// If the connection error, client need to call `/status` to get the redirectURL

	ctx.Response.Header.Set("Location", newReleaseHost)
	ctx.SetStatusCode(fasthttp.StatusMovedPermanently)

	return nil
}
