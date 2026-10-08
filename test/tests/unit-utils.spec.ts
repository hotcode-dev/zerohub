import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit test for `getWS` (client/src/utils.ts) — the sole remaining export of
 * that module after `getHTTP` / `fetchWithTimeout` were removed as dead code.
 *
 * Runs without a server or WebRTC: the helper is exercised through the same
 * in-page unit harness (`window.ZeroHubUnitHarness`) used by the peer-wiring
 * unit specs (see `test/tests/unit-peer-wiring.spec.ts`).
 */

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: {
    wsUrl(host: string, tls: boolean): string;
  };
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

function wsUrl(page: Page, host: string, tls: boolean) {
  return page.evaluate(
    ([host, tls]) => ZeroHubUnitHarness.wsUrl(host, tls),
    [host, tls] as const,
  );
}

test.describe("getWS", () => {
  test("returns a ws:// URL when tls is false", async ({ page }) => {
    await prepareUnitHarnessPage(page);
    expect(await wsUrl(page, "localhost:8080", false)).toBe(
      "ws://localhost:8080",
    );
  });

  test("returns a wss:// URL when tls is true", async ({ page }) => {
    await prepareUnitHarnessPage(page);
    expect(await wsUrl(page, "hub.example.com", true)).toBe(
      "wss://hub.example.com",
    );
  });
});
