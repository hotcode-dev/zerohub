/**
 * Get the WebSocket URL based on the host and TLS flag.
 *
 * @param host - The host for the WebSocket connection.
 * @param tls - A flag indicating whether to use TLS.
 * @returns The WebSocket URL with or without TLS based on the flag.
 */
export function getWS(host: string, tls: boolean) {
  if (tls) {
    return `wss://${host}`;
  }
  return `ws://${host}`;
}

/**
 * Checks whether `host` is a well-formed ZeroHub host: a bare hostname or
 * `host:port` (bracketed IPv6 literals allowed), with no scheme, no
 * path/query/fragment, no userinfo, no whitespace or control characters,
 * and a port in 0..65535. Mirrors the server's `validateBackupHost`
 * (`server/pkg/handler/migrate.go`), which enforces the same shape for the
 * host emitted as the reason of a `1001` ("going away") close on
 * `/admin/migrate`.
 *
 * Close code `1001` is generic, though: any intermediate hop (reverse
 * proxy, load balancer, edge device) may close with `1001` and a
 * human-readable reason. This guard keeps the client from trusting such a
 * reason as a redirect host.
 *
 * @param host - Candidate host string, e.g. `a.zerohub.dev` or `localhost:8080`.
 * @returns `true` when `host` can be used verbatim in `ws(s)://<host>`.
 */
export function isWellFormedHost(host: string): boolean {
  if (typeof host !== "string" || host === "") {
    return false;
  }
  try {
    const url = new URL(`http://${host}`);
    // Anything besides the host makes this not a bare host: userinfo, a
    // path/query/fragment, or a scheme/`//` prefix that changes how the
    // string parses. `pathname === "/"` is the no-path form; the
    // round-trip check below rejects a trailing slash.
    if (
      url.username !== "" ||
      url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return false;
    }
    // `url.host` echoes the host but strips an explicit default port, so
    // `evil.com:80` round-trips to `evil.com`; accept that form too (the
    // server's validator does).
    return (
      url.host === host ||
      (host.endsWith(":80") && url.host === host.slice(0, -3))
    );
  } catch {
    return false;
  }
}
