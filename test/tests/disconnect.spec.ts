import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

type PeersInfo = {
  peerIds: string[];
  rtcStates: Record<string, string>;
};

type PeerStatusLogEntry = {
  peerId: string;
  status: string;
  rtcConnConnectionState: string;
};

async function getPeersInfo(page: import("@playwright/test").Page, componentId: string) {
  return page.evaluate(
    ({ id }) => window.ZeroHubHarness.getPeersInfo(id) as PeersInfo,
    { id: componentId }
  );
}

async function getPeerStatusLog(
  page: import("@playwright/test").Page,
  componentId: string
) {
  return page.evaluate(
    ({ id }) => window.ZeroHubHarness.getPeerStatusLog(id) as PeerStatusLogEntry[],
    { id: componentId }
  );
}

test("peer disconnect tears down RTCPeerConnection and removes peer from map", async ({
  page,
}) => {
  await prepareHarnessPage(page);
  const componentId = uuidv4();
  const joinComponentId = `${componentId}-joiner`;
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";

  // Create a hub (Peer A).
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host }) => {
      window.ZeroHubHarness.createHub({
        testName: "disconnect teardown, create hub",
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

  // Join the hub (Peer B) — this is a mid-session joiner.
  await page.evaluate(
    ({ componentId: id, zeroHubHost: host, hubId: joinHubId }) => {
      window.ZeroHubHarness.joinHub({
        testName: "disconnect teardown, join hub",
        zeroHubHosts: [host],
        hubId: joinHubId,
        componentId: id,
      });
    },
    { componentId: joinComponentId, zeroHubHost, hubId }
  );

  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(joinComponentId)).first()
    ).toHaveText(hubId);
  });

  await test.step("both peers connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toHaveText("connected", { timeout: 15000 });
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(joinComponentId)).first()
    ).toHaveText("connected", { timeout: 15000 });
  });

  const peersBefore = await getPeersInfo(page, componentId);
  expect(peersBefore.peerIds).toHaveLength(1);
  const joinerPeerId = peersBefore.peerIds[0];

  // Simulate Peer B leaving by closing its WebSocket.
  await page.evaluate(
    ({ componentId: id }) => {
      window.ZeroHubHarness.closeWs(id);
    },
    { componentId: joinComponentId }
  );

  await test.step(
    "creator observes ZeroHubDisconnected status change",
    async () => {
      // The creator's onPeerStatusChange must have observed the joiner
      // transitioning to zerohub_disconnected (fired before teardown).
      await expect
        .poll(async () => {
          const log = await getPeerStatusLog(page, componentId);
          return log.some(
            (e) => e.peerId === joinerPeerId && e.status === "zerohub_disconnected"
          );
        }, { timeout: 10000, intervals: [100] }).toBeTruthy();
    }
  );

  await test.step("peer removed from peers map after disconnect", async () => {
    // The creator's peers map must no longer contain the disconnected peer.
    await expect
      .poll(async () => {
        const info = await getPeersInfo(page, componentId);
        return info.peerIds.includes(joinerPeerId);
      }, { timeout: 10000, intervals: [100] })
      .toBeFalsy();
  });

  await test.step("RTCPeerConnection closed after disconnect", async () => {
    // The joiner's Peer object (retained by the status log) must have a
    // closed RTCPeerConnection, proving teardown ran (no leaked live
    // connection).
    await expect
      .poll(async () => {
        const log = await getPeerStatusLog(page, componentId);
        const joinerEvents = log.filter((e) => e.peerId === joinerPeerId);
        if (joinerEvents.length === 0) {
          return "no-events";
        }
        // All captured events reference the same underlying peer; the
        // connection state must be closed.
        return joinerEvents[joinerEvents.length - 1].rtcConnConnectionState;
      }, { timeout: 10000, intervals: [100] })
      .toBe("closed");
  });
});
