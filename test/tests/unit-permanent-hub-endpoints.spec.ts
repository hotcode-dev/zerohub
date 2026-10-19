import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage for the `joinPermanentHub` entry point on `ZeroHubClient`.
 *
 * The server implements permanent hubs — hubs that never expire, used for
 * always-on collaboration rooms — at `/v1/permanent-hubs/join` (WebSocket)
 * and `/v1/permanent-hubs/create` (plain HTTP JSON, admin-gated via the
 * `Authorization` header; see `server/pkg/handler/handler.go` and
 * `create_hub_permanent.go`).
 *
 * Creation is deliberately NOT exposed on the SDK: the browser WebSocket
 * API cannot send custom headers, so `new WebSocket()` could never carry
 * the `Authorization` header the create endpoint requires (and every
 * signaling endpoint on the server upgrades to WebSocket, so a browser
 * client hitting the JSON create endpoint just gets a failed handshake).
 * Permanent hubs are therefore created out-of-band with an HTTP client
 * (curl / Node fetch) that can set the header. `joinPermanentHub` is the
 * public SDK entry point.
 *
 * These specs pin the URL the entry point must dial (path, `id` query
 * param, and `peerMetadata` serialization), mirroring the static-hub pair
 * (`createHub` → `/v1/hubs/create`, `joinHub` → `/v1/hubs/join`).
 *
 * Runs without a server or real WebRTC: the client is bundled with the
 * unit harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op
 * topology) and driven through `window.ZeroHubUnitHarness`.
 */

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

/** `createClient` builds against `localhost:1` with the default `tls: true`. */
const HOST = "localhost:1";

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
