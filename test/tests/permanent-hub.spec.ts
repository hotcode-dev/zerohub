import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getJoinPermanentHubTestId,
  getJoinPermanentPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

/**
 * Exercises the real `/v1/permanent-hubs/join` WebSocket upgrade against the
 * live server (no mocked WebSocket), analogous to the static-hub
 * create/join spec.
 *
 * Permanent hubs are created out-of-band via the admin HTTP endpoint
 * `GET /v1/permanent-hubs/create` (requires the `Authorization` header) —
 * the browser WebSocket API cannot send custom headers, so this spec creates
 * the hub from Node.js with `fetch`, then two SDK clients join it with
 * `joinPermanentHub`. Proving both joiners reach the "connected" signaling
 * state verifies the join endpoint upgrades to WebSocket and the two peers
 * establish a real WebRTC connection.
 *
 * Targets `localhost:8081` (the backup server from `zz-migrate.spec.ts`): the
 * plain-HTTP create cannot use the SDK's migration failover, so it must hit
 * a host that is never put into migrate mode. `zz-migrate.spec.ts` latches
 * `localhost:8080` into migrate mode permanently (301 forward for plain HTTP,
 * 1001 close-forward for WebSocket signaling; see its docblock), while 8081
 * is never migrated — so the HTTP create there always sees the real handler,
 * regardless of execution order. (The suite runs serially — `workers: 1` in
 * `playwright.config.ts` — and `zz-migrate.spec.ts` runs last via its file
 * name.)
 */
test("permanent hub create (HTTP) + join (WebSocket) connects", async ({
  page,
}, testInfo) => {
  // ICE candidates + the data channel exchange can take several seconds in a
  // headless Chrome; the default 5s expect window is not enough.
  testInfo.setTimeout(60 * 1000);
  const zeroHubHost = "localhost:8081";
  // base64(APP_CLIENT_SECRET) used by the server's admin endpoints
  // (`make server-serve` sets APP_CLIENT_SECRET=client_secret).
  const adminAuth = Buffer.from("client_secret").toString("base64");
  const hubId = uuidv4();
  const creatorId = uuidv4();
  const joinerId = uuidv4();

  await test.step("create permanent hub out-of-band via admin HTTP", async () => {
    const res = await fetch(
      `http://${zeroHubHost}/v1/permanent-hubs/create?id=${encodeURIComponent(
        hubId
      )}`,
      { headers: { Authorization: adminAuth } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isPermanent: boolean; id: string };
    expect(body.id).toBe(hubId);
    expect(body.isPermanent).toBe(true);
  });

  await test.step("open two SDK joiners", async () => {
    await prepareHarnessPage(page);
    for (const componentId of [creatorId, joinerId]) {
      await page.evaluate(
        ({ id, host, hub: hubId }) => {
          window.ZeroHubHarness.joinPermanentHub({
            testName: "permanent hub join",
            zeroHubHosts: [host],
            hubId: hubId,
            componentId: id,
          });
        },
        { id: componentId, host: zeroHubHost, hub: hubId }
      );
    }
  });

  await test.step("both joiners receive the hub info", async () => {
    for (const componentId of [creatorId, joinerId]) {
      await expect(
        page.getByTestId(getJoinPermanentHubTestId(componentId)).first()
      ).toHaveText(hubId);
    }
  });

  await test.step("peer status connected", async () => {
    for (const componentId of [creatorId, joinerId]) {
      await expect(
        page.getByTestId(getJoinPermanentPeerStatusTestId(componentId)).first()
      )
        .toHaveText("connected", { timeout: 30 * 1000 });
    }
  });
});
