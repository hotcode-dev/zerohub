import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

test("create/join hub", async ({ page }) => {
  // Endpoint pinning: capture every WebSocket URL the page dials so the
  // spec can prove the harness drove the static-hub endpoints
  // (/v1/hubs/create + /v1/hubs/join), not the random-hub ones. The
  // init script must be registered before navigation (the data-URL goto
  // inside prepareHarnessPage), so it is installed first.
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

  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "create/join hub, create hub",
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId, zeroHubHost }
  );

  await test.step("create hub success", async () => {
    const hubIdLoc = page.getByTestId(getCreateHubTestId(componentId)).first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubId = (await hubIdLoc.textContent()) || "";
  });

  await test.step("created hub id round-trips the static-hub endpoint", async () => {
    // The harness creates the hub with the componentId as the static hub
    // id, and /v1/hubs/create returns it verbatim — a regression that
    // drops or rewrites the id param must fail here, not silently pass
    // against a random-hub uuid.
    expect(hubId).toBe(componentId);
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "create/join hub, join hub",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId, zeroHubHost, hubId }
  );

  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(componentId)).first()
    ).toHaveText(hubId);
  });

  await test.step("dialed the static-hub endpoints", async () => {
    const urls: string[] = await page.evaluate(() => (
      window as unknown as { __wsUrls: string[] }
    ).__wsUrls);
    expect(
      urls.some((url) => url.includes("/v1/hubs/create") && url.includes(`id=${hubId}`))
    ).toBe(true);
    expect(
      urls.some((url) => url.includes("/v1/hubs/join") && url.includes(`id=${hubId}`))
    ).toBe(true);
    expect(
      urls.some((url) => url.includes("/v1/random-hubs"))
    ).toBe(false);
  });

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected");

    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentId)).first()
    ).toHaveText("connected");
  });
});
