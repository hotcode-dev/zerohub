import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

test("multiple concurrent connections", async ({ page }) => {
  await prepareHarnessPage(page);
  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";
  const numberOfConcurrentConnections = 10;
  const joinedComponentIds: string[] = [];

  // Create a hub first
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "concurrent test, create hub",
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

  // Join multiple components concurrently
  await test.step("join multiple components concurrently", async () => {
    for (let i = 0; i < numberOfConcurrentConnections; i++) {
      const joinComponentId = `${componentId}-join-${i}`;
      joinedComponentIds.push(joinComponentId);
      await page.evaluate(
        ({ componentId: id, zeroHubHost: host, hubId: joinHubId, index }) => {
          window.ZeroHubHarness.joinHub({
            testName: `concurrent test, join hub ${index}`,
            zeroHubHosts: [host],
            hubId: joinHubId,
            componentId: id,
          });
        },
        {
          componentId: joinComponentId,
          zeroHubHost,
          hubId,
          index: i,
        }
      );

      await expect(
        page.getByTestId(getJoinHubTestId(joinComponentId)).first()
      ).toHaveText(hubId);
    }
  });

  // Verify all connections are established
  await test.step("verify all peers are connected", async () => {
    // Check that the creator is connected to all peers
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected", { timeout: 15000 });

    // Check that all joiners are connected
    for (let i = 0; i < numberOfConcurrentConnections; i++) {
      await expect(
        page
          .getByTestId(getJoinPeerStatusTestId(joinedComponentIds[i]))
          .first()
      ).toHaveText("connected", { timeout: 15000 });
    }
  });
});

test("multiple concurrent hub creation and joining", async ({ page }) => {
  await prepareHarnessPage(page);
  const zeroHubHost = "localhost:8080";
  const numberOfHubs = 3;
  const peersPerHub = 2;

  const hubIds: string[] = [];
  const creatorIds: string[] = [];

  // Step 1: Create multiple hubs concurrently
  await test.step("create multiple hubs concurrently", async () => {
    for (let i = 0; i < numberOfHubs; i++) {
      const creatorId = `creator-${uuidv4()}-${i}`;
      creatorIds.push(creatorId);

      await page.evaluate(
        ({ componentId: id, zeroHubHost: host, index }) => {
          window.ZeroHubHarness.createHub({
            testName: `concurrent hub creation ${index}`,
            zeroHubHosts: [host],
            componentId: id,
          });
        },
        { componentId: creatorId, zeroHubHost, index: i }
      );

      // Verify hub creation success
      const hubIdLoc = page
        .getByTestId(getCreateHubTestId(creatorId))
        .first();

      await expect(hubIdLoc).toHaveText(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      const hubId = (await hubIdLoc.textContent()) || "";
      hubIds.push(hubId);
    }
  });

  // Step 2: Join peers to each hub concurrently
  const hubPeerIds: Array<Array<string>> = [];

  await test.step("join peers to hubs concurrently", async () => {
    for (let hubIndex = 0; hubIndex < numberOfHubs; hubIndex++) {
      const peerIdsForCurrentHub: string[] = [];

      for (let peerIndex = 0; peerIndex < peersPerHub; peerIndex++) {
        const peerId = `joiner-${uuidv4()}-hub${hubIndex}-peer${peerIndex}`;
        peerIdsForCurrentHub.push(peerId);

        await page.evaluate(
          ({ componentId: id, zeroHubHost: host, hubId: joinHubId, hubIndex: hIndex, peerIndex: pIndex }) => {
            window.ZeroHubHarness.joinHub({
              testName: `join hub ${hIndex}, peer ${pIndex}`,
              zeroHubHosts: [host],
              hubId: joinHubId,
              componentId: id,
            });
          },
          {
            componentId: peerId,
            zeroHubHost,
            hubId: hubIds[hubIndex],
            hubIndex,
            peerIndex,
          }
        );

        // Verify the peer joined the correct hub
        await expect(
          page.getByTestId(getJoinHubTestId(peerId)).first()
        ).toHaveText(hubIds[hubIndex]);
      }

      hubPeerIds.push(peerIdsForCurrentHub);
    }
  });

  // Step 3: Verify all connections are established
  await test.step("verify all peers are connected across all hubs", async () => {
    // Verify hub creators are connected
    for (let hubIndex = 0; hubIndex < numberOfHubs; hubIndex++) {
      await expect(
        page
          .getByTestId(getCreatePeerStatusTestId(creatorIds[hubIndex]))
          .first()
      ).toHaveText("connected", { timeout: 15000 });

      // Verify all peers in this hub are connected
      for (let peerIndex = 0; peerIndex < peersPerHub; peerIndex++) {
        await expect(
          page
            .getByTestId(
              getJoinPeerStatusTestId(hubPeerIds[hubIndex][peerIndex])
            )
            .first()
        ).toHaveText("connected", { timeout: 15000 });
      }
    }
  });

  // Optional: Test message passing between peers in each hub
  // This would depend on the implementation of message passing in your components
});
