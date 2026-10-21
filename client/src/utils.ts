/**
 * Get the WebSocket URL based on the host and TLS flag.
 *
 * @param host - The host for the WebSocket connection.
 * @param tls - A flag indicating whether to use TLS.
 * @returns The WebSocket URL with or without the TLS scheme based on the flag.
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
 * path/query/fragment, no userinfo, no whitespace or control characters, and
 * a port in 0..65535.
 *
 * Mirrors the server's `validateBackupHost`
 * (`server/pkg/handler/migrate.go`), which enforces the same shape for the
 * host emitted as the reason of a `1001` ("going away") close on
 * `/admin/migrate`. The check delegates the shape to the WHATWG host parser
 * and compares component-wise rather than raw-string round-tripping the
 * input, so every non-canonical-but-valid form the server accepts and emits
 * is accepted here too: uppercase hostnames, uppercase IPv6 literals,
 * zero-padded ports, and zero-padded (octal) IPv4 octets. The server stores
 * the value verbatim and emits it as the close reason; the client embeds it
 * in `ws(s)://<host>`, and both parsers connect to the same target.
 *
 * Two intentional divergences where this guard is *stricter* than the server
 * (both safe: the client refuses and falls back to host-failover rather than
 * building an invalid `ws://` URL):
 *   - Percent-encoded host spellings (`a%C3%BC.com`). Go's parser accepts
 *     them, but WHATWG percent-*decodes* the host — `new WebSocket("ws://…")`
 *     would resolve to a different target than the server emitted. The server
 *     stores the URL-*decoded* value (fasthttp decodes the query arg), so the
 *     raw percent form never reaches the client via the close reason.
 *   - A bare empty hostname with a port (`:80`). Go's round-trip accepts it,
 *     but `ws://:80` is an invalid URL and would throw on connect.
 *
 * Close code `1001` is generic, though: any intermediate hop (reverse
 * proxy, load balancer, edge device) may close with `1001` and a
 * human-readable reason. This guard keeps the client from trusting such a
 * reason as a redirect host.
 *
 * @param host - Candidate host string, e.g. `a.zerohub.dev` or `localhost:8080`.
 * @returns `true` when `host` can be used in `ws(s)://<host>`.
 */
export function isWellFormedHost(host: string): boolean {
  if (typeof host !== "string" || host === "") {
    return false;
  }
  // ASCII-printable-only, no percent-encoding. Raw control characters /
  // DEL (Go's parser rejects) and `%` (WHATWG percent-decodes the host, so
  // `ws://new%41example.com` would throw — see docblock) are the two
  // spellings the URL parser cannot catch alone.
  for (const ch of host) {
    const code = ch.charCodeAt(0);
    if (ch === "%" || code <= 0x20 || code === 0x7f) {
      return false;
    }
  }
  // A leading `/` makes `http://<host>` parse as a network-path URL with an
  // empty host (`//evil.com` -> hostname "", pathname "//evil.com"), a
  // trailing `/` as a path, and a trailing `:` as a bare empty port — all
  // rejected by Go's `validateBackupHost` round-trip. A leading `:` alone
  // (`:80`) is caught by the character loop above.
  if (host.startsWith("/") || host.endsWith("/") || host.endsWith(":")) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    // Forms the host parser rejects outright: bare (unbracketed) IPv6
    // literals, whitespace inside the host, out-of-range ports, trailing
    // port junk (`a.com:8080x`), ... — Go's validator rejects these too.
    return false;
  }
  // Anything besides the host makes this not a bare host: userinfo, a
  // path/query/fragment, or a scheme/`//` prefix that changes how the
  // string parses. `pathname === "/"` is the no-path form.
  return (
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === ""
  );
}
