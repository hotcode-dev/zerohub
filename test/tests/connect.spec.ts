import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
  seedStaticHub,
} from "./utils/harness";

test("seed/join static hub", async ({ page }) => {
  // Endpoint pinning: capture every WebSocket URL the page dials so the
  // spec can prove the harness drove the static-hub endpoint
  // (/v1/static-hubs/join), not the random-hub ones. The init script must
  // be registered before navigation (the data-URL goto inside
  // prepareHarnessPage), so it is installed first.
  await page.addInitScript(() => {
    (window as unknown as { __wsUrls: string[] }).__wsUrls = [];
    const RealWS = window.WebSocket;
    class SpiedWS extends RealWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        (window as unknown as { __wsUrls: string[] }).__wsUrls.push(
          String(url)
        );
        super(url, protocols);
      }
    }
    window.WebSocket = SpiedWS as typeof WebSocket;
  });
  await prepareHarnessPage(page);

  const creatorId = uuidv4();
  const joinerId = uuidv4();
  const zeroHubHost = "localhost:8080";
  // The hub id is spec-provided (the creator's component id): a unique,
  // known value the harness returns verbatim on `onHubInfo`, so the join
  // id can be asserted against a known value instead of a uuid shape.
  const hubId = creatorId;

  // Static hubs are created out-of-band by an admin over plain HTTP
  // (`GET /v1/static-hubs/create`, Authorization-gated — the browser
  // WebSocket API cannot carry custom headers, so the SDK exposes no
  // static-hub create). Seed the hub Node-side first, then drive the
  // WebSocket join path against it.
  await seedStaticHub(hubId, zeroHubHost);

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.createHub({
        testName: "create/join hub, creator joins",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId: creatorId, zeroHubHost, hubId }
  );

  await test.step("creator join success", async () => {
    const hubIdLoc = page.getByTestId(getCreateHubTestId(creatorId)).first();
    await expect(hubIdLoc).toHaveText(hubId);
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "create/join hub, joiner joins",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId: joinerId, zeroHubHost, hubId }
  );

  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(joinerId)).first()
    ).toHaveText(hubId);
  });

  await test.step("dialed the static-hub endpoint", async () => {
    const urls: string[] = await page.evaluate(() => (
      window as unknown as { __wsUrls: string[] }
    ).__wsUrls);
    // Both the creator's and the joiner's dials must hit the static-hub
    // join endpoint with the seeded id, and no random-hub endpoint.
    expect(
      urls.filter((url) => url.includes("/v1/static-hubs/join")).length
    ).toBe(2);
    expect(urls.every((url) => url.includes(`id=${hubId}`))).toBe(true);
    expect(urls.some((url) => url.includes("/v1/random-hubs"))).toBe(false);
  });

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(creatorId)).first()
    ).toHaveText("connected");

    await expect(
      page.getByTestId(getJoinPeerStatusTestId(joinerId)).first()
    ).toHaveText("connected");
  });
});
