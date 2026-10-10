package handler

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

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
	if err := validateBackupHost(backupHost); err != nil {
		// Invalid redirect target: refuse without touching any state, so a
		// typo or an attacker holding APP_CLIENT_SECRET cannot send every
		// client reconnecting to a garbage or malicious host.
		log.Error().Err(err).Send()
		_ = h.Response(ctx, fasthttp.StatusBadRequest, map[string]string{"error": err.Error()})
		return nil
	}

	// Set backupHost before flipping isMigrating so that a reader who
	// observes isMigrating == true is guaranteed (via the atomic store
	// release semantics + RLock) to see the non-empty backupHost.
	h.migrateMu.Lock()
	h.backupHost = backupHost
	h.migrateMu.Unlock()
	h.isMigrating.Store(true)

	log.Info().Msg("migrate mode enabled backup host: " + backupHost)

	ctx.SetStatusCode(fasthttp.StatusOK)

	return nil
}

func (h *handler) ForwardMigrate(ctx *fasthttp.RequestCtx) error {
	backupHost := h.getBackupHost()

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

// getBackupHost returns the current backup host under a read lock so it is
// safe to read concurrently with Migrate.
func (h *handler) getBackupHost() string {
	h.migrateMu.RLock()
	defer h.migrateMu.RUnlock()
	return h.backupHost
}

// validateBackupHost enforces that the migrate host is a bare host or
// host:port — no scheme, no "//", no path/query/fragment, no userinfo, no
// whitespace or control characters, and a port in 0..65535. The client
// embeds the stored value verbatim as ws(s)://<host> on reconnect, so a full
// URL, "evil.com//8080", or any other malformed target would break the
// connection or redirect clients to an arbitrary host.
func validateBackupHost(host string) error {
	u, err := url.Parse("http://" + host)
	if err != nil {
		return fmt.Errorf("invalid host %q: %w", host, err)
	}
	// Any component besides the host (scheme, "//" path, query, fragment,
	// userinfo such as "user@host") makes this not a bare host.
	if u.Opaque != "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("invalid host %q: must be a bare host or host:port", host)
	}
	// u.Hostname()/u.Port() only split on the colon after a valid host or
	// bracketed IPv6 literal; a bare "::1" or "::1:8080" parses its first
	// group as the port and fails here.
	hostname, port := u.Hostname(), u.Port()
	if port != "" {
		p, err := strconv.Atoi(port)
		if err != nil || p > 65535 {
			return fmt.Errorf("invalid host %q: port out of range", host)
		}
	}
	// Canonical form: host for a plain name, [ipv6] for a literal, plus
	// :port when present. Rejecting any host that doesn't round-trip keeps
	// the stored value exactly what the client can use in ws(s)://<host>.
	// (url.Parse already rejects whitespace and control characters.)
	canonical := hostname
	if strings.Contains(hostname, ":") {
		canonical = "[" + hostname + "]"
	}
	if port != "" {
		canonical += ":" + port
	}
	if u.Host != canonical {
		return fmt.Errorf("invalid host %q: must be a bare host or host:port", host)
	}
	return nil
}
