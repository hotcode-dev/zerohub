import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreatePeerStatusTestId,
  getCreateHubTestId,
  getDisconnectStatusTestId,
  getJoinHubTestId,
  prepareHarnessPage,
} from "./utils/harness";

test("disconnect tears down websocket and peer connections", async ({
  page,
}) => {
  await prepareHarnessPage(page);
  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "disconnect, create hub",
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
        testName: "disconnect, join hub",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId, zeroHubHost, hubId }
  );

  await test.step("peer status connected before disconnect", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected");
  });

  await page.evaluate(
    ({ componentId: id }) => {
      window.ZeroHubHarness.disconnect({
        componentId: id,
      });
    },
    { componentId }
  );

  await test.step("websocket and peer connection are closed", async () => {
    await expect(
      page.getByTestId(getDisconnectStatusTestId(componentId)).first()
    ).toHaveText("status:disconnected,ws:closed,peers:closed,count:1");
  });

  // keep the joined client alive so the hub does not fully drain during the test
  await expect(
    page.getByTestId(getJoinHubTestId(componentId)).first()
  ).toHaveText(hubId);
});
