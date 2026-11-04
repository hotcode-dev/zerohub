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

/**
 * Heads-up: this spec permanently mutates shared server state.
 *
 * The `/v1/admin/migrate` call below sets the server's `isMigrating` flag —
 * a one-way latch (`Migrate()` in `server/pkg/handler/migrate.go`); there is
 * no endpoint that clears it. From that point on, every signaling connection
 * to `localhost:8080` receives a 1001 close redirecting to `localhost:8081`,
 * and every unknown-hub join on 8080 is forwarded there (`ForwardMigrate`).
 *
 * Because the latch outlives the server session the whole suite shares, the
 * Playwright config runs this suite with `workers: 1` and this file is named
 * `zz-migrate.spec.ts` so that in the serial order it runs LAST: every spec
 * that dials `localhost:8080` finishes before the latch is set. If the suite
 * ever runs in parallel again, or this file is renamed out of last position,
 * the specs that dial 8080 will silently reconnect to 8081 and their
 * assertions will fail or pass against the wrong server.
 *
 * Both hubs in this spec are static hubs (admin-created; static hubs never
 * expire), so they stay joinable across the migration: the first is seeded
 * on BOTH :8080 and :8081 before the latch, so the redirected joiner on
 * 8081 can find the same hub id it was sent to.
 */
test("migrate (latches :8080 permanently; must stay last in the suite)", async ({ page }) => {
  await prepareHarnessPage(page);
  const creatorId = uuidv4();
  const joinerId = uuidv4();
  const creatorIdNew = uuidv4();
  const joinerIdNew = uuidv4();
  const zeroHubHost = "localhost:8080";
  const zeroHubHostNew = "localhost:8081";
  const migrateURL = "http://localhost:8080/v1/admin/migrate";
  const clientSecret = "client_secret";
  // Hub 1: seeded on both hosts so it survives the migration redirect.
  const hubId = uuidv4();
  await seedStaticHub(hubId, zeroHubHost);
  await seedStaticHub(hubId, zeroHubHostNew);

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.createHub({
        testName: "migrate, creator joins",
        zeroHubHosts: [host],
        componentId: id,
        hubId: joinHubId,
      });
    },
    { componentId: creatorId, zeroHubHost, hubId }
  );
  await test.step("create hub success", async () => {
    const hubIdLoc = page.getByTestId(getCreateHubTestId(creatorId)).first();
    await expect(hubIdLoc).toHaveText(hubId);
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "migrate, join hub",
        hubId: joinHubId,
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: joinerId, zeroHubHost, hubId }
  );
  await test.step("join hub success", async () => {
    const joinHubIdLoc = page
      .getByTestId(getJoinHubTestId(joinerId))
      .first();
    await expect(joinHubIdLoc).toHaveText(hubId);
  });
  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(creatorId)).first()
    ).toHaveText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(joinerId)).first()
    ).toHaveText("connected");
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

  // A fresh joiner now dials 8080 after the latch: the 1001 redirect must
  // reconnect it to 8081, where the same hub id is joinable (seeded above).
  const joinerIdMigrated = uuidv4();
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "migrate, redirected join",
        hubId: joinHubId,
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: joinerIdMigrated, zeroHubHost, hubId }
  );
  await test.step("post-migrate join via 8080 redirects to 8081", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(joinerIdMigrated)).first()
    ).toHaveText(hubId);
  });

  // Hub 2: on the new host only — the post-migration join path against the
  // instance that never latches.
  const hubIdNew = uuidv4();
  await seedStaticHub(hubIdNew, zeroHubHostNew);
  await page.evaluate(
    ({ componentId: id, zeroHubHostNew: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.createHub({
        testName: "migrate, new host creator joins",
        zeroHubHosts: [host],
        componentId: id,
        hubId: joinHubId,
      });
    },
    { componentId: creatorIdNew, zeroHubHostNew, hubId: hubIdNew }
  );
  await test.step("new-host create success", async () => {
    const hubIdLoc = page
      .getByTestId(getCreateHubTestId(creatorIdNew))
      .first();
    await expect(hubIdLoc).toHaveText(hubIdNew);
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHostNew: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "migrate, new host join",
        hubId: joinHubId,
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: joinerIdNew, zeroHubHostNew, hubId: hubIdNew }
  );
  await test.step("new-host join success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(joinerIdNew)).first()
    ).toHaveText(hubIdNew);
  });
  await test.step("new-host peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(creatorIdNew)).first()
    ).toHaveText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(joinerIdNew)).first()
    ).toHaveText("connected");
  });
});
