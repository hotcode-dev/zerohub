import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Unit test for `getWS` (client/src/utils.ts) — the sole remaining export of
 * that module after `getHTTP` / `fetchWithTimeout` were removed as dead code.
 *
 * Runs without a server or WebRTC: the helper is exercised through the same
 * in-page unit harness (`window.ZeroHubUnitHarness`) used by the peer-wiring
 * unit specs (see `test/tests/unit-peer-wiring.spec.ts`).
 */

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
