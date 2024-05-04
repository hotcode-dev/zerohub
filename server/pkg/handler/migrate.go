package handler

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// Migrate
// Seamless deployment to the new version.
// Set the server to migrate mode. The server will not receive any create Hub request
// until the server got no Hub left for graceful shutdown.
//
// Example deploy scenario,
// 1. Call `admin/migrate?host=localhost:8080`.
// 2. All the new create Hub request will be rejected.
// 3. Client will need to use the forward host instead
// 4. Wait until no hub left.
// 5. Graceful shutdown.
// 6. redeploy the new version of server.
func (h *handler) Migrate(ctx *fasthttp.RequestCtx) error {
	if err := h.CheckAdminAuth(ctx); err != nil {
		return err
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
	backupHost := h.mg.GetBackupHost()

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

	ctx.Response.Header.Set("Location", backupHost)
	h.Response(ctx, fasthttp.StatusMovedPermanently, map[string]string{"backupHost": backupHost})

	return nil
}
