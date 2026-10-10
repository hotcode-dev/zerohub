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
  createClientWithLogger(): number;
  getWarnings(id: number): string[];
  clearWarnings(id: number): void;
  invokeSafeParse(id: number, raw: string | undefined, fallback: string): string;
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

/** Messages logged via the client's `logger.warn` when the payload is bad. */
const INVALID_JSON_WARNING = "invalid JSON metadata from server, using fallback";

test("valid metadata does not trigger the 'invalid JSON' warning", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() =>
    ZeroHubUnitHarness.createClientWithLogger()
  );

  // Valid JSON (even a value that matches the fallback) must parse cleanly.
  const valid = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-a"],
        '{"hub":"meta"}',
        '{"a":1}'
      ),
    id
  );
  expect(valid.threw).toBe(false);
  expect(valid.parsedHubMetadata).toBe(JSON.stringify({ hub: "meta" }));
  expect(valid.parsedPeerMetadata).toBe(JSON.stringify({ a: 1 }));
  const quietWarnings = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getWarnings(clientId),
    id
  );
  expect(quietWarnings).toEqual([]);

  // A valid JSON primitive that equals the fallback must still not warn —
  // the warning must diagnose a parse failure, not a value match.
  const matching = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedPeerJoinedWithMetadata(clientId, "peer-b", "{}"),
    id
  );
  expect(matching.threw).toBe(false);
  const matchingWarnings = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getWarnings(clientId),
    id
  );
  expect(matchingWarnings).toEqual([]);

  // Direct repro from the bug report: valid JSON whose parsed value equals a
  // scalar fallback. The old reference-equality guard warned here; a
  // successful parse must never warn.
  page.evaluate((clientId) => ZeroHubUnitHarness.clearWarnings(clientId), id);
  const scalar = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.invokeSafeParse(clientId, '"ok"', "ok"),
    id
  );
  expect(scalar).toBe(JSON.stringify("ok"));
  const scalarWarnings = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getWarnings(clientId),
    id
  );
  expect(scalarWarnings).toEqual([]);

  // And the malformed branch of the same call does warn.
  page.evaluate((clientId) => ZeroHubUnitHarness.clearWarnings(clientId), id);
  const badScalar = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.invokeSafeParse(clientId, "not-json", "ok"),
    id
  );
  expect(badScalar).toBe(JSON.stringify("ok"));
  const badScalarWarnings = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getWarnings(clientId),
    id
  );
  expect(badScalarWarnings).toEqual([INVALID_JSON_WARNING]);
});

test("'invalid JSON' warning fires only on the empty/malformed branch", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() =>
    ZeroHubUnitHarness.createClientWithLogger()
  );

  // Malformed hub metadata → exactly one warning.
  const malformed = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-1"],
        "not-json",
        '{"a":1}'
      ),
    id
  );
  expect(malformed.threw).toBe(false);
  // The roster reconcile prunes peers absent from the roster (logging its
  // own warning), so only count the "invalid JSON" warnings.
  expect(
    (await page.evaluate((clientId) => ZeroHubUnitHarness.getWarnings(clientId), id))
      .filter((w) => w === INVALID_JSON_WARNING)
  ).toEqual([INVALID_JSON_WARNING]);

  // Malformed peer metadata → exactly one invalid-JSON warning; the valid hub
  // value adds none. Distinct peer id: already-known roster peers are skipped
  // by `addPeer`, so this must be a peer the client has not registered yet.
  await page.evaluate((clientId) => ZeroHubUnitHarness.clearWarnings(clientId), id);
  const malformedPeer = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-2"],
        '{"ok":true}',
        "not-json"
      ),
    id
  );
  expect(malformedPeer.threw).toBe(false);
  expect(
    (await page.evaluate((clientId) => ZeroHubUnitHarness.getWarnings(clientId), id))
      .filter((w) => w === INVALID_JSON_WARNING)
  ).toEqual([INVALID_JSON_WARNING]);

  // Missing (empty-string) metadata takes the fallback branch too — the
  // documented "missing or malformed" case — so it warns as well.
  await page.evaluate((clientId) => ZeroHubUnitHarness.clearWarnings(clientId), id);
  const missing = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-3"],
        "",
        ""
      ),
    id
  );
  expect(missing.threw).toBe(false);
  expect(
    (await page.evaluate((clientId) => ZeroHubUnitHarness.getWarnings(clientId), id))
      .filter((w) => w === INVALID_JSON_WARNING)
  ).toEqual([INVALID_JSON_WARNING, INVALID_JSON_WARNING]);

  // Clean payloads add no invalid-JSON warnings at all.
  await page.evaluate((clientId) => ZeroHubUnitHarness.clearWarnings(clientId), id);
  const clean = await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.feedHubInfoWithMetadata(
        clientId,
        "me",
        ["peer-4"],
        '{"ok":true}',
        '{"a":1}'
      ),
    id
  );
  expect(clean.threw).toBe(false);
  expect(
    (await page.evaluate((clientId) => ZeroHubUnitHarness.getWarnings(clientId), id))
      .filter((w) => w === INVALID_JSON_WARNING)
  ).toEqual([]);
});
