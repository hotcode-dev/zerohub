import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: a second connection entry-point call (e.g. `joinHub`
 * while a `createHub` socket is still open) must not leak the previous
 * `WebSocket`.
 *
 * `connectToZeroHub` used to assign `this.ws = new WebSocket(url)` without
 * tearing down the previous socket. The orphaned socket kept its
 * `onmessage`/`onerror`/`onclose`/`onopen` handlers live: it kept decoding
 * signaling traffic for its old hub into the shared client state, and — when
 * it later closed abnormally — its `onclose` fired `reconnect()`, advancing
 * `hostIndex` a second time for a single logical failure.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 */

/** Serializable snapshot of a mock WebSocket. */
type SocketSnapshot = {
  instanceId: number;
  url: string;
  closed: boolean;
  closeCodes: number[];
  hasMessageHandler: boolean;
  hasErrorHandler: boolean;
  hasCloseHandler: boolean;
  hasOpenHandler: boolean;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */

/** Inject the unit harness into a page. */
async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  const html = "<html><head></head><body></body></html>";
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
}

function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist/unit-harness.js",
  );
}

test("second connection without disconnect() closes and clears the previous socket", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  // First connection entry point: opens socket #1 with live handlers.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.createHub(clientId, "hub-a"),
    id
  );

  const first = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.snapshotSockets(clientId),
    id
  );
  expect(first).toHaveLength(1);
  expect(first[0].hasMessageHandler).toBe(true);
  expect(first[0].hasCloseHandler).toBe(true);
  expect(first[0].closed).toBe(false);

  // Second connection entry point WITHOUT disconnect(): the previous socket
  // must be closed (code 1000) and every handler nulled, so it can no longer
  // decode signaling for the old hub or fire reconnect() when it dies.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.joinHub(clientId, "hub-b"),
    id
  );

  const sockets = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.snapshotSockets(clientId),
    id
  );
  expect(sockets).toHaveLength(2);
  const [replaced, live] = sockets;
  expect(replaced).toEqual({
    instanceId: first[0].instanceId,
    url: first[0].url,
    closed: true,
    closeCodes: [1000],
    hasMessageHandler: false,
    hasErrorHandler: false,
    hasCloseHandler: false,
    hasOpenHandler: false,
  });
  // The replacement socket is the only live one.
  expect(live.closed).toBe(false);
  expect(live.hasMessageHandler).toBe(true);
  expect(live.hasCloseHandler).toBe(true);

  // Exactly one logical failure can advance hostIndex: the replaced socket's
  // nulled onclose can no longer call reconnect() a second time.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(0);
});
