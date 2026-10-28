import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

/**
 * Heads-up: this spec permanently mutates shared server state.
 *
 * The `/v1/admin/migrate` call below sets the server's `isMigrating` flag —
 * a one-way latch (`Migrate()` in `server/pkg/handler/migrate.go`); there is
 * no endpoint that clears it. From that point on, every signaling connection
 * to `localhost:8080` receives a 1001 close redirecting to `localhost:8081`,
 * and every hub create on 8080 is forwarded there (`ForwardMigrate`).
 *
 * Because the latch outlives the server session the whole suite shares, the
 * Playwright config runs this suite with `workers: 1` and this file is named
 * `zz-migrate.spec.ts` so that in the serial order it runs LAST: every spec
 * that dials `localhost:8080` finishes before the latch is set. If the suite
 * ever runs in parallel again, or this file is renamed out of last position,
 * the specs that dial 8080 will silently reconnect to 8081 and their
 * assertions will fail or pass against the wrong server.
 */
test("migrate (latches :8080 permanently; must stay last in the suite)", async ({ page }) => {
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
