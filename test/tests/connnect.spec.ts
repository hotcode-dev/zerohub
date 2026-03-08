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

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected");

    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentId)).first()
    ).toHaveText("connected");
  });
});
