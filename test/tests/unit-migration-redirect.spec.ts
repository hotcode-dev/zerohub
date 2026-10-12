import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: a server-side migration redirect (close code 1001 with
 * the backup host in the close reason) must update the client's internal
 * `host` / `hostIndex` state, not just the URL it is passed.
 *
 * `reconnect(url, newHost)` used to set only `currentURL.host`. Every
 * public entry point (`createHub`, `joinHub`, ...) builds its URL from
 * `this.host` (`openHubConnection`), so after a migration redirect the next
 * entry-point call dialed the OLD (still-migrating or shut-down) host
 * instead of the redirected one. This spec pins:
 *
 *  1. After a 1001 + reason close, `this.host` equals the redirect host and
 *     a subsequent `joinHub()` opens a socket against it (not the old host).
 *  2. When the redirect host is in the configured host list, `hostIndex`
 *     moves to its position, so a following 1006 automatic failover starts
 *     from the redirected host instead of a stale position.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClientWithHosts(hosts: string[]): number;
  createHub(id: number, hubId: string): void;
  joinHub(id: number, hubId: string): void;
  getHost(id: number): string;
  getHostIndex(id: number): number;
  getLastSocketUrl(id: number): string | null;
  simulateMigrationClose(id: number, reason: string): void;
  simulateAbnormalClose(id: number): void;
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

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

test("migration redirect (1001 + reason) updates host state for the next entry point", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev", "b.zerohub.dev"])
  );

  // Initial connection entry point: socket #1 opens against host `a`.
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://a.zerohub.dev/v1/hubs/create?id=room"
  );

  // Operator migrates server A: the live socket is closed with code 1001
  // and the backup host in the reason (server `ForwardMigrate` behavior).
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "b.zerohub.dev"),
    id
  );

  // The redirect branch must have moved the client's host state.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "b.zerohub.dev"
  );

  // The redirected reconnect dialed host `b`.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/create?id=room"
  );

  // The next entry-point call builds its URL from the UPDATED host, not the
  // stale one: it must open against `b.zerohub.dev`, never the old `a`.
  await page.evaluate((clientId) => ZeroHubUnitHarness.joinHub(clientId, "room"), id);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/join?id=room"
  );
});

test("migration redirect to a configured host starts automatic failover from that position", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev", "b.zerohub.dev"])
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);

  // Redirect from `a` to `b`: hostIndex must land on `b`'s position (1).
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "b.zerohub.dev"),
    id
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(1);

  // Now the (mocked) connection to `b` dies with an abnormal 1006: the
  // automatic failover must advance from the redirected position to the end
  // of the list and reject cleanly instead of hopping a stale index.
  await page.evaluate((clientId) => ZeroHubUnitHarness.simulateAbnormalClose(clientId), id);
  // `getZeroHubBackupHost()` rejection settles in microtasks; flush them.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  // State stays consistent on the dead redirected host; no further socket
  // was opened (the last one is still the redirected-to `b` socket).
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "b.zerohub.dev"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/create?id=room"
  );
});
