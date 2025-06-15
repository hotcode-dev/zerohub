package handler

import (
	"fmt"

	"github.com/fasthttp/websocket"
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

	backupHost := string(ctx.QueryArgs().Peek("host"))
	if backupHost == "" {
		return fmt.Errorf("new release host not found")
	}

	h.isMigrating = true
	h.backupHost = backupHost

	log.Info().Msg("migrate mode enabled backup host: " + backupHost)

	ctx.SetStatusCode(fasthttp.StatusOK)

	return nil
}

func (h *handler) ForwardMigrate(ctx *fasthttp.RequestCtx) error {
	backupHost := h.backupHost

	// The 301 status is not working on multi library following the rfc6455
	// But the Native browser Websocket not support the redirection
	// If the connection error, client need to call `/status` to get the redirectURL
	// https://www.rfc-editor.org/rfc/rfc6455#section-4.1

	// We decide to upgrade the connection to send a close message
	// to the client, so that the client can handle the redirection
	// and reconnect to the new host.
	if backupHost == "" {
		return fmt.Errorf("backup host not found, please call /admin/migrate?host=localhost:8080")
	}
	err := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
		closeErr := ws.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseGoingAway, backupHost))
		if closeErr != nil {
			log.Error().Msgf("error sending close message: %v", closeErr)
		}
		ws.Close()
	})

	if err != nil {
		if _, ok := err.(websocket.HandshakeError); ok {
			return fmt.Errorf("websocket handshake: %v", err)
		}
		return fmt.Errorf("websocket upgrade error: %v", err)
	}

	return nil
}
