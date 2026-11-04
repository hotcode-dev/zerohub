import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreatePeerStatusTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
  getCreateHubTestId,
  getJoinHubTestId,
  seedStaticHub,
} from "./utils/harness";

test.slow();

test("data channels open for creator and joiner", async ({ page }) => {
  await prepareHarnessPage(page);

  const creatorId = uuidv4();
  const joinerId = uuidv4();
  const zeroHubHost = "localhost:8080";
  // The hub is seeded out-of-band (admin HTTP; the SDK has no static-hub
  // create) and the "creator" is just its first joiner.
  const hubId = uuidv4();
  await seedStaticHub(hubId, zeroHubHost);

  await page.evaluate(
    ({ creatorId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.createHub({
        componentId: id,
        zeroHubHosts: [host],
        testName: "data channel creator",
        hubId: joinHubId,
      });
    },
    { creatorId, zeroHubHost, hubId }
  );

  const hubIdLocator = page.getByTestId(getCreateHubTestId(creatorId)).first();
  await expect(hubIdLocator).toHaveText(hubId);

  await page.evaluate(
    ({ joinerId: id, zeroHubHost: host, hubId: existingHubId }) => {
      window.ZeroHubHarness.joinHub({
        componentId: id,
        zeroHubHosts: [host],
        testName: "data channel joiner",
        hubId: existingHubId,
      });
    },
    { joinerId, zeroHubHost, hubId }
  );

  await expect(
    page.getByTestId(getJoinHubTestId(joinerId)).first()
  ).toHaveText(hubId);

  const waitForConnected = { timeout: 30000 } as const;

  await expect(
    page.getByTestId(getCreatePeerStatusTestId(creatorId)).first()
  ).toHaveText("connected", waitForConnected);
  await expect(
    page.getByTestId(getJoinPeerStatusTestId(joinerId)).first()
  ).toHaveText("connected", waitForConnected);

  const creatorContainer = page.locator(
    `[data-component-id="${creatorId}"]`
  );
  const joinerContainer = page.locator(`[data-component-id="${joinerId}"]`);

  const waitForOpen = { timeout: 30000 } as const;

  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ componentId }) =>
            window.ZeroHubHarness.getDataChannelStatus(componentId, "0"),
          { componentId: creatorId }
        ),
      waitForOpen
    )
    .toBe("open");
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ componentId }) =>
            window.ZeroHubHarness.getDataChannelStatus(componentId, "0"),
          { componentId: joinerId }
        ),
      waitForOpen
    )
    .toBe("open");

  await expect(creatorContainer).toHaveAttribute(
    "data-0-status",
    "open",
    waitForOpen
  );
  await expect(joinerContainer).toHaveAttribute(
    "data-0-status",
    "open",
    waitForOpen
  );
});
