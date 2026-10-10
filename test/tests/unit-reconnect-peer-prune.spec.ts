import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: on (re)connect, `hubInfoMessage` must RECONCILE the peer
 * roster against the authoritative server roster — not only add missing
 * peers. Before the fix, `handleZeroHubMessage`'s hubInfoMessage branch was
 * one-directional: it added peers absent from `this.peers` but never pruned
 * peers absent from the message, so every auto-reconnect (close codes
 * 1006/1011) left stale `Peer` objects (each holding a live, unclosed
 * `RTCPeerConnection`) in the map — a WebRTC connection / memory leak over
 * the lifetime of a long-lived session with transient reconnects.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `RTCPeerConnection`, no-op topology) and a reconnect is
 * simulated by re-issuing a `hubInfoMessage` with a SMALLER roster.
 *
 * Covers:
 *  1. A peer missing from the re-issued roster is removed from `client.peers`
 *     and its `RTCPeerConnection` is closed with its state handlers nulled.
 *  2. The prune emits the same teardown status as `peerDisconnectedMessage`
 *     (`ZeroHubDisconnected`) via `onPeerStatusChange`.
 *  3. Peers still in the roster are preserved (same live connection, no
 *     reset), and `myPeerId` is never pruned even when the roster omits it.
 *  4. An empty roster prunes every peer but leaves the map empty and
 *     `myPeerId` intact.
 */

type PeerSnapshot = {
  status: string;
  rtcConnId: number;
  hasConnStateHandler: boolean;
  hasIceHandler: boolean;
  restartIceCount: number;
  connClosed: boolean;
  connectionState: string;
  iceConnectionState: string;
  metadata: string;
  joinTimeMs: number;
};

type ConnSnapshot = {
  closed: boolean;
  hasConnStateHandler: boolean;
  hasIceHandler: boolean;
};

type StatusChange = {
  peerId: string;
  status: string;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  setConnectionState(id: number, peerId: string, state: string): PeerSnapshot;
  getPeer(id: number, peerId: string): PeerSnapshot;
  peerIds(id: number): string[];
  getMyPeerId(id: number): string | null;
  getConnection(id: number, connId: number): ConnSnapshot;
  recordStatusChanges(id: number): void;
  drainStatusChanges(id: number): StatusChange[];
  connectionsCreated(id: number): number;
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

/** Inject the unit harness into a page. */
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
    setConnectionState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setConnectionState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    getPeer: (id: number, peerId: string) =>
      page.evaluate(([id, peerId]) => ZeroHubUnitHarness.getPeer(id, peerId), [
        id,
        peerId,
      ] as const),
    peerIds: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.peerIds(id), id),
    getMyPeerId: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getMyPeerId(id), id),
    getConnection: (id: number, connId: number) =>
      page.evaluate(
        ([id, connId]) => ZeroHubUnitHarness.getConnection(id, connId),
        [id, connId] as const,
      ),
    recordStatusChanges: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordStatusChanges(id), id),
    drainStatusChanges: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.drainStatusChanges(id),
        id,
      ),
    connectionsCreated: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.connectionsCreated(id), id),
  };
}

test.describe("ZeroHubClient roster reconciliation on reconnect (hubInfo)", () => {
  test("stale peer absent from the re-issued roster is pruned and its connection closed", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    // Initial join: we are peer "1"; peers "2" and "3" are in the roster.
    await h.sendHubInfo(id, "1", ["2", "3"]);
    expect(await h.peerIds(id)).toEqual(["2", "3"]);
    const stalePeer = (await h.getPeer(id, "3")) as PeerSnapshot;
    const staleConnId = stalePeer.rtcConnId;
    expect(staleConnId).toBeGreaterThan(0);

    const connsBefore = await h.connectionsCreated(id);

    // Reconnect: the server re-issues the full roster, and peer "3" has left
    // the hub while we were disconnected (no peerDisconnectedMessage is
    // broadcast for it, so only the roster reconcile can clean it up).
    await h.sendHubInfo(id, "1", ["2"]);

    await test.step("the stale peer is removed from the peers map", async () => {
      expect(await h.peerIds(id)).toEqual(["2"]);
      expect(((await h.getPeer(id, "3")) as PeerSnapshot).status).toBe(
        "__absent__",
      );
    });

    await test.step("the stale peer's RTCPeerConnection is closed and handlers nulled", async () => {
      const conn = (await h.getConnection(id, staleConnId)) as ConnSnapshot;
      expect(conn.closed).toBe(true);
      expect(conn.hasConnStateHandler).toBe(false);
      expect(conn.hasIceHandler).toBe(false);
    });

    await test.step("the prune emits ZeroHubDisconnected, matching the disconnect-broadcast teardown", async () => {
      await h.recordStatusChanges(id);
      await h.sendHubInfo(id, "1", ["4"]); // peer "2" leaves now, "4" joins
      const changes = (await h.drainStatusChanges(id)) as StatusChange[];
      // addPeer(pending) for "4" first, then the prune of "2".
      expect(changes).toEqual([
        { peerId: "4", status: "pending" },
        { peerId: "2", status: "zerohub_disconnected" },
      ]);
    });

    await test.step("no extra RTCPeerConnection is created during reconcile", async () => {
      // "4" created exactly one connection; "2" was pruned, not re-created.
      expect(await h.connectionsCreated(id)).toBe(connsBefore + 1);
    });
  });

  test("peers still in the roster are preserved across a reconnect", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2", "3"]);
    const kept = (await h.getPeer(id, "2")) as PeerSnapshot;
    const keptConnId = kept.rtcConnId;

    // Drive peer "2" to a live state so a status reset would be observable.
    await h.setConnectionState(id, "2", "connected");
    expect(((await h.getPeer(id, "2")) as PeerSnapshot).status).toBe(
      "connected",
    );

    // Reconnect with an identical roster: nothing should be torn down or reset.
    await h.sendHubInfo(id, "1", ["2", "3"]);

    await test.step("the surviving peer keeps its live connection and status", async () => {
      const after = (await h.getPeer(id, "2")) as PeerSnapshot;
      expect(after.rtcConnId).toBe(keptConnId);
      expect(after.status).toBe("connected");
      expect(after.hasConnStateHandler).toBe(true);
      expect(after.hasIceHandler).toBe(true);
      const conn = (await h.getConnection(id, keptConnId)) as ConnSnapshot;
      expect(conn.closed).toBe(false);
    });
  });

  test("myPeerId is never pruned, even when the roster omits it", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);

    // Reconnect with a roster that does NOT list ourselves (defensive:
    // servers always include our own entry, but the client must never
    // register or prune itself).
    await h.sendHubInfo(id, "1", ["2"]);

    await test.step("we never appear in the peers map", async () => {
      expect(await h.peerIds(id)).toEqual(["2"]);
      expect(
        ((await h.getPeer(id, "1")) as PeerSnapshot).status,
      ).toBe("__absent__");
    });

    await test.step("myPeerId is tracked on the client", async () => {
      expect(await h.getMyPeerId(id)).toBe("1");
    });
  });

  test("an empty roster prunes every peer but keeps the map empty and the session alive", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2", "3"]);
    const conn2 = (await h.getPeer(id, "2")) as PeerSnapshot;
    const conn3 = (await h.getPeer(id, "3")) as PeerSnapshot;
    expect(conn2.rtcConnId).toBeGreaterThan(0);
    expect(conn3.rtcConnId).toBeGreaterThan(0);

    // Reconnect into an empty hub (everyone else left while we were down).
    await h.sendHubInfo(id, "1", []);

    await test.step("every peer is pruned and every connection closed", async () => {
      expect(await h.peerIds(id)).toEqual([]);
      expect(((await h.getPeer(id, "2")) as PeerSnapshot).status).toBe(
        "__absent__",
      );
      expect(((await h.getPeer(id, "3")) as PeerSnapshot).status).toBe(
        "__absent__",
      );
      expect((await h.getConnection(id, conn2.rtcConnId)) as ConnSnapshot).toEqual({
        closed: true,
        hasConnStateHandler: false,
        hasIceHandler: false,
      });
      expect((await h.getConnection(id, conn3.rtcConnId)) as ConnSnapshot).toEqual({
        closed: true,
        hasConnStateHandler: false,
        hasIceHandler: false,
      });
    });

    await test.step("a later join still works (session not broken by the prune)", async () => {
      await h.sendHubInfo(id, "1", ["5"]);
      const fresh = (await h.getPeer(id, "5")) as PeerSnapshot;
      expect(fresh.status).toBe("pending");
      expect(fresh.rtcConnId).toBeGreaterThan(0);
    });
  });
});
