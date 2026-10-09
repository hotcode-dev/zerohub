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
