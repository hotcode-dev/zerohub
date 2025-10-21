/**
 * Returns the appropriate HTTP or HTTPS URL based on the host and tls flag.
 *
 * @param host - The host name or IP address
 * @param tls - A flag indicating whether to use HTTPS or not
 * @returns The constructed HTTP or HTTPS URL
 */
export function getHTTP(host: string, tls: boolean) {
  if (tls) {
    return `https://${host}`;
  }
  return `http://${host}`;
}

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
 * Fetch with a timeout.
 * @param input - The resource that you wish to fetch.
 * @param init - An object containing any custom settings that you want to apply to the request.
 * @param timeout - The timeout in milliseconds. Default is 2000ms.
 * @returns A Promise that resolves to the Response object.
 * @throws Throws a DOMException if the request times out.
 */
export async function fetchWithTimeout(
  input: string | URL | globalThis.Request,
  init?: RequestInit,
  timeout = 2000
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(input, {
    ...init,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}
