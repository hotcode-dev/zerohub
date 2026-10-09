import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: a terminal reconnect failure (all ZeroHub hosts
 * exhausted) must surface through the public `onZeroHubError` callback.
 *
 * `reconnect()` with no backup host left rejects from
 * `getZeroHubBackupHost()`; before the fix that rejection was only logged
 * and `onZeroHubError` never fired, violating the documented contract
 * ("Listen to `onZeroHubError` to surface unrecoverable errors").
 *
 * Runs without a server or real WebRTC: the client is bundled with the
 * unit harness (mocked `RTCPeerConnection`, no-op topology) and driven
 * through `window.ZeroHubUnitHarness`.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  triggerAllHostsExhausted(id: number): Promise<string[]>;
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

test("terminal all-hosts-exhausted reconnect failure fires onZeroHubError", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  // The client was created with a single host (`localhost:1`), so it is
  // already on its last host. Triggering `reconnect()` exhausts the list
  // and the rejection must reach `onZeroHubError`.
  const errors = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.triggerAllHostsExhausted(clientId),
    id
  );

  expect(errors).toHaveLength(1);
  expect(errors[0]).toBe(
    "all ZeroHub hosts are not working, please check the ZeroHub hosts"
  );
});
