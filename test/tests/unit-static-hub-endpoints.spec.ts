import { test, expect } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Coverage for the `joinStaticHub` entry point on `ZeroHubClient`.
 *
 * The server implements static hubs — never-expires named hubs, used for
 * always-on collaboration rooms — at `/v1/static-hubs/join` (WebSocket)
 * and `/v1/static-hubs/create` (plain HTTP JSON, admin-gated via the
 * `Authorization` header; see `server/pkg/handler/handler.go` and
 * `create_static_hub.go`).
 *
 * Creation is deliberately NOT exposed on the SDK: the browser WebSocket
 * API cannot send custom headers, so `new WebSocket()` could never carry
 * the `Authorization` header the create endpoint requires (and every
 * signaling endpoint on the server upgrades to WebSocket, so a browser
 * client hitting the JSON create endpoint just gets a failed handshake).
 * Static hubs are therefore created out-of-band with an HTTP client
 * (curl / Node fetch) that can set the header. `joinStaticHub` is the
 * public SDK entry point.
 *
 * These specs pin the URL the entry point must dial (path, `id` query
 * param, and `peerMetadata` serialization).
 *
 * Runs without a server or real WebRTC: the client is bundled with the
 * unit harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op
 * topology) and driven through `window.ZeroHubUnitHarness`.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */

/** `createClient` builds against `localhost:1` with the default `tls: true`. */
const HOST = "localhost:1";

test("joinStaticHub dials /v1/static-hubs/join with the hub id", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.joinStaticHub(clientId, "room"),
    id
  );

  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    `wss://${HOST}/v1/static-hubs/join?id=room`
  );
});

test("joinStaticHub forwards peerMetadata as a query param", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const id = await page.evaluate(() => ZeroHubUnitHarness.createClient());

  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.joinStaticHub(clientId, "room", { name: "Bob" }),
    id
  );

  const expected =
    `wss://${HOST}/v1/static-hubs/join?id=room` +
    `&peerMetadata=${encodeURIComponent(JSON.stringify({ name: "Bob" }))}`;
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    expected
  );
});
