/**
 * Returns the appropriate HTTP or HTTPS URL based on the host and tls flag.
 *
 * @param {string} host - The host name or IP address
 * @param {boolean} tls - A flag indicating whether to use HTTPS or not
 * @return {string} The constructed HTTP or HTTPS URL
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
 * @param {string} host - The host for the WebSocket connection.
 * @param {boolean} tls - A flag indicating whether to use TLS.
 * @return {string} The WebSocket URL with or without TLS based on the flag.
 */
export function getWS(host: string, tls: boolean) {
  if (tls) {
    return `wss://${host}`;
  }
  return `ws://${host}`;
}

/**
 * Fetch with a timeout.
 * @param {string | URL | Request} input - The resource that you wish to fetch.
 * @param {RequestInit} [init] - An object containing any custom settings that you want to apply to the request.
 * @param {number} [timeout=2000] - The timeout in milliseconds. Default is 2000ms.
 * @return {Promise<Response>} A Promise that resolves to the Response object.
 * @throws {DOMException} Throws a DOMException if the request times out.
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
