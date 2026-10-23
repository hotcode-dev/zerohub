import { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * In-page unit harness bundle (built by `test/scripts/build-unit-harness.mjs`
 * via `pretest`). Lives one directory below the spec files, so resolve
 * `test/dist/unit-harness.js` relative to this module's own URL.
 */
function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../dist/unit-harness.js",
  );
}

/**
 * Inject the unit harness (mocked `RTCPeerConnection` + the
 * `window.ZeroHubUnitHarness` driver surface) into a page, on the same
 * data-URL stub page used by the e2e harness.
 */
export async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  const html = "<html><head></head><body></body></html>";
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
}
