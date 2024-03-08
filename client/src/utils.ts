export function getHTTP(host: string, tls: boolean) {
  if (tls) {
    return `https://${host}`;
  }
  return `http://${host}`;
}

export function getWS(host: string, tls: boolean) {
  if (tls) {
    return `wss://${host}`;
  }
  return `ws://${host}`;
}
