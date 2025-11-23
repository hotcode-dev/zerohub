import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

test("migrate", async ({ page }) => {
  await prepareHarnessPage(page);
  let hubId: string = "";
  let hubIdNew: string = "";
  const componentId = uuidv4();
  const componentIdNew = uuidv4();
  const zeroHubHost = "localhost:8080";
  const zeroHubHostNew = "localhost:8081";
  const migrateURL = "http://localhost:8080/v1/admin/migrate";
  const clientSecret = "client_secret";

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "migrate, create hub",
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

  // Make a request to migrate to the new zerohub host
  const res = await fetch(`${migrateURL}?host=${zeroHubHostNew}`, {
    headers: {
      Authorization: Buffer.from(clientSecret).toString("base64"),
    },
  });
  await test.step("migrate success", async () => {
    expect(res.status).toBe(200);
  });

  // test join the first hub after migrate
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "migrate, join hub",
        hubId: joinHubId,
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId, zeroHubHost, hubId }
  );

  await test.step("join hub success", async () => {
    const joinHubIdLoc = page
      .getByTestId(getJoinHubTestId(componentId))
      .first();
    await expect(joinHubIdLoc).toHaveText(hubId);
  });
  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentId)).first()
    ).toHaveText("connected");
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHostNew: host }) => {
      window.ZeroHubHarness.createHub({
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: componentIdNew, zeroHubHostNew }
  );
  await test.step("create hub success", async () => {
    const hubIdLoc = page
      .getByTestId(getCreateHubTestId(componentIdNew))
      .first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubIdNew = (await hubIdLoc.textContent()) || "";
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHostNew: host, hubIdNew: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        hubId: joinHubId,
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: componentIdNew, zeroHubHostNew, hubIdNew }
  );
  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(componentIdNew)).first()
    ).toHaveText(hubIdNew);
  });

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentIdNew)).first()
    ).toHaveText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentIdNew)).first()
    ).toHaveText("connected");
  });
});
