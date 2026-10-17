import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the incoming trickle-ICE path: when the server relays an
 * `IceCandidateMessage` (a candidate the remote peer gathered AFTER its SDP
 * was sent), the client must apply it to the target peer's
 * `RTCPeerConnection` via `addIceCandidate`.
 *
 * This closes the loop on the P0 bug where post-SDP candidates were silently
 * dropped on both ends: the sender side (forwarding later candidates) is
 * covered in `unit-ice-candidate-send.spec.ts`; here we verify the receiver
 * actually consumes them instead of ignoring the message.
 *
 * Driven through the unit harness (mocked `RTCPeerConnection`, no-op
 * topology, no server, no real WebRTC stack).
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  sendIceCandidateMessage(id: number, peerId: string, candidate: string): void;
  getAddedIceCandidates(id: number, peerId: string): string[];
  getPeerStatus(id: number, peerId: string): string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

/** Inject the unit harness (mocked RTCPeerConnection + driver) into a page. */
async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  const html = "<html><head></head><body></body></html>";
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
}

function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist/unit-harness.js",
  );
}

function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    sendIceCandidateMessage: (
      id: number,
      peerId: string,
      candidate: string,
    ) =>
      page.evaluate(
        ([id, peerId, candidate]) =>
          ZeroHubUnitHarness.sendIceCandidateMessage(id, peerId, candidate),
        [id, peerId, candidate] as const,
      ),
    getAddedIceCandidates: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) =>
          ZeroHubUnitHarness.getAddedIceCandidates(id, peerId),
        [id, peerId] as const,
      ),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
  };
}

/** A post-SDP trickle candidate as the sender serializes it (JSON). */
const POST_SDP_CANDIDATE = JSON.stringify({
  candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
});

test.describe("ZeroHubClient incoming IceCandidateMessage (trickle ICE receive)", () => {
  test("an incoming post-SDP candidate is applied to the target peer via addIceCandidate", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);
    expect(await h.getPeerStatus(id, "2")).toBe("pending");

    await test.step("no candidate applied before any message arrives", async () => {
      expect(await h.getAddedIceCandidates(id, "2")).toHaveLength(0);
    });

    await test.step("the server-relayed candidate reaches the target peer's RTCPeerConnection", async () => {
      await h.sendIceCandidateMessage(id, "2", POST_SDP_CANDIDATE);
      const added = await h.getAddedIceCandidates(id, "2");
      expect(added).toHaveLength(1);
      expect(added[0]).toBe(POST_SDP_CANDIDATE);
    });

    await test.step("multiple trickled candidates are all applied, in order", async () => {
      const second = JSON.stringify({
        candidate: "candidate:2 1 udp 184549489 5.6.7.8 9010 typ srflx",
        sdpMid: "0",
        sdpMLineIndex: 0,
      });
      await h.sendIceCandidateMessage(id, "2", second);
      const added = await h.getAddedIceCandidates(id, "2");
      expect(added).toHaveLength(2);
      expect(added[0]).toBe(POST_SDP_CANDIDATE);
      expect(added[1]).toBe(second);
    });

    await test.step("the candidate does not disturb the peer's status", async () => {
      // Applying a candidate must not transition the peer out of Pending.
      expect(await h.getPeerStatus(id, "2")).toBe("pending");
    });
  });

  test("a candidate for an unknown peer is dropped without crashing the dispatcher", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);

    await test.step("a candidate for a missing peer does not throw", async () => {
      await h.sendIceCandidateMessage(id, "99", POST_SDP_CANDIDATE);
      expect(await h.getAddedIceCandidates(id, "2")).toHaveLength(0);
    });

    await test.step("the dispatcher survives and still routes subsequent candidates", async () => {
      await h.sendIceCandidateMessage(id, "2", POST_SDP_CANDIDATE);
      const added = await h.getAddedIceCandidates(id, "2");
      expect(added).toHaveLength(1);
      expect(added[0]).toBe(POST_SDP_CANDIDATE);
    });
  });
});
