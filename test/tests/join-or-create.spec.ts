import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinOrCreateHubTestId,
  getJoinOrCreatePeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

// `/v1/hubs/join-or-create` had zero E2E coverage: the harness's
// createHub/joinHub functions silently drove the random-hub endpoints,
// and no spec exercised the static join-or-create handler. These specs
// pin both branches: create when absent, join when present.

test("join-or-create creates the hub when it does not exist", async ({
  page,
}) => {
  await prepareHarnessPage(page);
  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.joinOrCreateHub({
        testName: "join-or-create, new hub",
        zeroHubHosts: [host],
        hubId: id,
        componentId: id,
      });
    },
    { componentId, zeroHubHost }
  );

  await test.step("join-or-create success", async () => {
    // The hub id returned by /v1/hubs/join-or-create must be the id the
    // client sent (the hub was created under it).
    const hubIdLoc = page
      .getByTestId(getJoinOrCreateHubTestId(componentId))
      .first();
    await expect(hubIdLoc).toHaveText(componentId);
  });
});

test("join-or-create joins the hub when it already exists", async ({
  page,
}) => {
  await prepareHarnessPage(page);
  const creatorId = uuidv4();
  const joinerId = uuidv4();
  const zeroHubHost = "localhost:8080";

  // Seed the hub via the static-hub create endpoint.
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "join-or-create, seed hub",
        zeroHubHosts: [host],
        componentId: id,
      });
    },
    { componentId: creatorId, zeroHubHost }
  );

  await test.step("seed hub success", async () => {
    // The harness creates the hub with the componentId as the static hub
    // id; point the joiner at that known id instead of a fresh uuid.
    const seededHubIdLoc = page
      .getByTestId(getCreateHubTestId(creatorId))
      .first();
    await expect(seededHubIdLoc).toHaveText(creatorId);
  });

  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinOrCreateHub({
        testName: "join-or-create, existing hub",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId: joinerId, zeroHubHost, hubId: creatorId }
  );

  await test.step("join-or-create into existing hub", async () => {
    const hubIdLoc = page
      .getByTestId(getJoinOrCreateHubTestId(joinerId))
      .first();
    await expect(hubIdLoc).toHaveText(creatorId);
  });

  await test.step("both peers connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(creatorId)).first()
    ).toHaveText("connected", { timeout: 15000 });
    await expect(
      page.getByTestId(getJoinOrCreatePeerStatusTestId(joinerId)).first()
    ).toHaveText("connected", { timeout: 15000 });
  });
});
