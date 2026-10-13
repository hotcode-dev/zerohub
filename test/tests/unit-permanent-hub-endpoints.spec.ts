import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage for the permanent-hub entry points `createPermanentHub` /
 * `joinPermanentHub` on `ZeroHubClient`.
 *
 * The server implements permanent hubs (`/v1/permanent-hubs/create` and
 * `/v1/permanent-hubs/join`; see `server/pkg/handler/handler.go`) — hubs
 * that never expire, used for always-on collaboration rooms — but the
 * client SDK had no public methods reaching them, so documented
 * permanent-hub mode was unreachable through the public API.
 *
 * These specs pin the URL each entry point must dial (path, `id` query
 * param, and `hubMetadata`/`peerMetadata` serialization), mirroring the
 * static-hub pair (`createHub` → `/v1/hubs/create`, `joinHub` →
 * `/v1/hubs/join`).
 *
 * Runs without a server or real WebRTC: the client is bundled with the
 * unit harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op
 * topology) and driven through `window.ZeroHubUnitHarness`.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  createPermanentHub(
    id: number,
    hubId: string,
    peerMetadata?: object,
    hubMetadata?: object
  ): void;
  joinPermanentHub(id: number, hubId: string, peerMetadata?: object): void;
  getLastSocketUrl(id: number): string | null;
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

/** `createClient` builds against `localhost:1` with the default `tls: true`. */
const HOST = "localhost:1";

test("createPermanentHub dials /v1/permanent-hubs/create with the hub id", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.createPermanentHub(clientId, "room"),
    id
  );

  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    `wss://${HOST}/v1/permanent-hubs/create?id=room`
  );
});

test("createPermanentHub forwards peerMetadata and hubMetadata as query params", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.createPermanentHub(
        clientId,
        "room",
        { name: "Alice" },
        { theme: "dark" }
      ),
    id
  );

  const expected =
    `wss://${HOST}/v1/permanent-hubs/create?id=room` +
    `&hubMetadata=${encodeURIComponent(JSON.stringify({ theme: "dark" }))}` +
    `&peerMetadata=${encodeURIComponent(JSON.stringify({ name: "Alice" }))}`;
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    expected
  );
});

test("joinPermanentHub dials /v1/permanent-hubs/join with the hub id", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.joinPermanentHub(clientId, "room"),
    id
  );

  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    `wss://${HOST}/v1/permanent-hubs/join?id=room`
  );
});

test("joinPermanentHub forwards peerMetadata as a query param", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.joinPermanentHub(clientId, "room", { name: "Bob" }),
    id
  );

  const expected =
    `wss://${HOST}/v1/permanent-hubs/join?id=room` +
    `&peerMetadata=${encodeURIComponent(JSON.stringify({ name: "Bob" }))}`;
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    expected
  );
});
