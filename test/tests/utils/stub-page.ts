import { Page } from "@playwright/test";

/**
 * Minimal blank page used as a neutral host for harness injection. Both the
 * e2e harness (`harness.ts`) and the unit harness (`unit-harness.ts`) load the
 * client bundle onto a data-URL page instead of a real document, so the exact
 * HTML skeleton is shared here as a single source of truth.
 */
export const STUB_PAGE_HTML = "<html><head></head><body></body></html>";

/** Navigate a page to the blank data-URL stub page. */
export async function gotoStubPage(page: Page): Promise<void> {
  await page.goto(`data:text/html,${encodeURIComponent(STUB_PAGE_HTML)}`);
}
