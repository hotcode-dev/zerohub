import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test (P0): the message dispatcher must never crash on malformed
 * hub/peer metadata.
 *
 * The server stored and broadcast `hubMetadata`/`peerMetadata` verbatim from
 * unauthenticated, unvalidated query params. `handleZeroHubMessage` used to
 * `JSON.parse` them with only a truthy guard, so a non-JSON value threw a
 * `SyntaxError` inside the `ws.onmessage` handler — wedging the socket so that
 * every subsequent message (hub info, offers, answers, joins, disconnects) was
 * silently dropped, and every reconnect re-received the poisoned payload and
 * crashed again.
 *
 * These specs feed malformed payloads through the bundled client and assert:
 *  1. no throw escapes `handleZeroHubMessage`,
 *  2. the metadata falls back to `{}` instead of crashing,
 *  3. a follow-up message is still processed (the dispatcher is not wedged).
 *
 * Runs without a server or real WebRTC via `window.ZeroHubUnitHarness`
 * (mocked `RTCPeerConnection`, no-op topology).
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  feedHubInfoWithMetadata(
    id: number,
    myPeerId: string,
    peerIds: string[],
    hubMetadata: string,
    peerMetadata: string
  ): {
    threw: boolean;
    errorMessage: string;
    parsedHubMetadata: string;
    parsedPeerMetadata: string;
  };
  feedPeerJoinedWithMetadata(
    id: number,
    peerId: string,
    peerMetadata: string
  ): {
    threw: boolean;
    errorMessage: string;
    parsedPeerMetadata: string | null;
    peerStatus: string | null;
  };
  survivesPoisonedHubInfo(
    id: number,
    myPeerId: string,
    followUpPeerId: string
  ): {
    firstThrew: boolean;
    followUpThrew: boolean;
    peerRegistered: boolean;
  };
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
    "../dist/unit-harness.js"
  );
}

test("malformed hubMetadata in hubInfoMessage does not throw and falls back to {}", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  const result = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        [],
        "not-json",
        ""
      ),
    id
  );

  expect(result.threw).toBe(false);
  // Fallback to an empty object, not a crash.
  expect(result.parsedHubMetadata).toBe(JSON.stringify({}));
});

test("malformed peer metadata in hubInfoMessage does not throw and falls back to {}", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  const result = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-a"],
        "",
        "not-json"
      ),
    id
  );

  expect(result.threw).toBe(false);
  expect(result.parsedPeerMetadata).toBe(JSON.stringify({}));
});

test("malformed peer metadata in peerJoinedMessage does not throw and falls back to {}", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  // Seed hubInfo (required by the peerJoinedMessage guard) with clean values.
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(clientId, "me", [], "", ""),
    id
  );

  const result = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedPeerJoinedWithMetadata(clientId, "peer-a", "not-json"),
    id
  );

  expect(result.threw).toBe(false);
  expect(result.parsedPeerMetadata).toBe(JSON.stringify({}));
  expect(result.peerStatus).toBe("pending");
});

test("dispatcher survives a poisoned hubInfoMessage and still processes the next message", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  const result = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.survivesPoisonedHubInfo(clientId, "me", "peer-b"),
    id
  );

  // The poisoned payload must not throw.
  expect(result.firstThrew).toBe(false);
  // The follow-up message must still be handled (the socket is not wedged).
  expect(result.followUpThrew).toBe(false);
  expect(result.peerRegistered).toBe(true);
});
