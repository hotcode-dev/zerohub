import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

test("multi hosts", async ({ page }) => {
  await prepareHarnessPage(page);
  let hubId: string = "";
  const componentId = uuidv4();
  const zeroHubBadHost = "this_is_bad_host:8080";
  const zeroHubGoodHost = "localhost:8080";

  await page.evaluate(
    ({ componentId: id, zeroHubBadHost: badHost, zeroHubGoodHost: goodHost }) => {
      window.ZeroHubHarness.createHub({
        testName: "multi hosts, create hub",
        zeroHubHosts: [badHost, goodHost],
        componentId: id,
      });
    },
    { componentId, zeroHubBadHost, zeroHubGoodHost }
  );

  await test.step("create hub success", async () => {
    const hubIdLoc = page.getByTestId(getCreateHubTestId(componentId)).first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubId = (await hubIdLoc.textContent()) || "";
  });

  await page.evaluate(
    ({ componentId: id, zeroHubBadHost: badHost, zeroHubGoodHost: goodHost, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "multi hosts, join hub",
        hubId: joinHubId,
        zeroHubHosts: [badHost, goodHost],
        componentId: id,
      });
    },
    { componentId, zeroHubBadHost, zeroHubGoodHost, hubId }
  );
  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(componentId)).first()
    ).toHaveText(hubId);
  });

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toContainText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentId)).first()
    ).toContainText("connected");
  });
});
