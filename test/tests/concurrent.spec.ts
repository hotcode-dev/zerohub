import { test, expect } from "@playwright/experimental-ct-svelte";
import CreateHub from "./components/CreateHub.svelte";
import JoinHub from "./components/JoinHub.svelte";
import { v4 as uuidv4 } from "uuid";

test.use({ viewport: { width: 500, height: 500 } });

test("multiple concurrent connections", async ({ mount }) => {
  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";
  const numberOfConcurrentConnections = 10;
  const joinedComponentIds: string[] = [];
  const joinedComponents: any[] = [];

  // Create a hub first
  const createHub = await mount(CreateHub, {
    props: {
      testName: "concurrent test, create hub",
      zeroHubHosts: [zeroHubHost],
      componentId: componentId,
    },
  });

  await test.step("create hub success", async () => {
    const hubIdLoc = createHub
      .getByTestId(`create-hub-id-${componentId}`)
      .first();
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

      const joinComponent = await mount(JoinHub, {
        props: {
          testName: `concurrent test, join hub ${i}`,
          zeroHubHosts: [zeroHubHost],
          hubId: hubId,
          componentId: joinComponentId,
        },
      });

      joinedComponents.push(joinComponent);

      // Verify the component joined the right hub
      await expect(
        joinComponent.getByTestId(`join-hub-id-${joinComponentId}`).first()
      ).toHaveText(hubId);
    }
  });

  // Verify all connections are established
  await test.step("verify all peers are connected", async () => {
    // Check that the creator is connected to all peers
    await expect(
      createHub.getByTestId(`create-peer-status-${componentId}`).first()
    ).toHaveText("connected");

    // Check that all joiners are connected
    for (let i = 0; i < numberOfConcurrentConnections; i++) {
      await expect(
        joinedComponents[i]
          .getByTestId(`join-peer-status-${joinedComponentIds[i]}`)
          .first()
      ).toHaveText("connected");
    }
  });
});

test("multiple concurrent hub creation and joining", async ({ mount }) => {
  const zeroHubHost = "localhost:8080";
  const numberOfHubs = 3;
  const peersPerHub = 2;

  const hubCreators: any[] = [];
  const hubIds: string[] = [];
  const creatorIds: string[] = [];

  // Step 1: Create multiple hubs concurrently
  await test.step("create multiple hubs concurrently", async () => {
    for (let i = 0; i < numberOfHubs; i++) {
      const creatorId = `creator-${uuidv4()}-${i}`;
      creatorIds.push(creatorId);

      const hubCreator = await mount(CreateHub, {
        props: {
          testName: `concurrent hub creation ${i}`,
          zeroHubHosts: [zeroHubHost],
          componentId: creatorId,
        },
      });

      hubCreators.push(hubCreator);

      // Verify hub creation success
      const hubIdLoc = hubCreator
        .getByTestId(`create-hub-id-${creatorId}`)
        .first();

      await expect(hubIdLoc).toHaveText(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      const hubId = (await hubIdLoc.textContent()) || "";
      hubIds.push(hubId);
    }
  });

  // Step 2: Join peers to each hub concurrently
  const hubPeers: Array<Array<any>> = [];
  const hubPeerIds: Array<Array<string>> = [];

  await test.step("join peers to hubs concurrently", async () => {
    for (let hubIndex = 0; hubIndex < numberOfHubs; hubIndex++) {
      const peersForCurrentHub: any[] = [];
      const peerIdsForCurrentHub: string[] = [];

      for (let peerIndex = 0; peerIndex < peersPerHub; peerIndex++) {
        const peerId = `joiner-${uuidv4()}-hub${hubIndex}-peer${peerIndex}`;
        peerIdsForCurrentHub.push(peerId);

        const peer = await mount(JoinHub, {
          props: {
            testName: `join hub ${hubIndex}, peer ${peerIndex}`,
            zeroHubHosts: [zeroHubHost],
            hubId: hubIds[hubIndex],
            componentId: peerId,
          },
        });

        peersForCurrentHub.push(peer);

        // Verify the peer joined the correct hub
        await expect(
          peer.getByTestId(`join-hub-id-${peerId}`).first()
        ).toHaveText(hubIds[hubIndex]);
      }

      hubPeers.push(peersForCurrentHub);
      hubPeerIds.push(peerIdsForCurrentHub);
    }
  });

  // Step 3: Verify all connections are established
  await test.step("verify all peers are connected across all hubs", async () => {
    // Verify hub creators are connected
    for (let hubIndex = 0; hubIndex < numberOfHubs; hubIndex++) {
      await expect(
        hubCreators[hubIndex]
          .getByTestId(`create-peer-status-${creatorIds[hubIndex]}`)
          .first()
      ).toHaveText("connected");

      // Verify all peers in this hub are connected
      for (let peerIndex = 0; peerIndex < peersPerHub; peerIndex++) {
        await expect(
          hubPeers[hubIndex][peerIndex]
            .getByTestId(`join-peer-status-${hubPeerIds[hubIndex][peerIndex]}`)
            .first()
        ).toHaveText("connected");
      }
    }
  });

  // Optional: Test message passing between peers in each hub
  // This would depend on the implementation of message passing in your components
});
