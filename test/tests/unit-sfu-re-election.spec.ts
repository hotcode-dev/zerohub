import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for `SFUTopology` SFU re-election on SFU departure
 * (client/src/topology/sfuTopology.ts).
 *
 * Regression: the SFU was chosen by deterministic numeric minimum of peer
 * IDs, but election only ever ran implicitly on the *local* peer's own
 * connect/disconnect events. When the peer that was the SFU left the hub
 * (its status transitioned to `ZeroHubDisconnected`), the topology only
 * logged a warning and did nothing — no remaining peer re-elected, so the
 * star conference silently degraded and never recovered, even when a new
 * lower-id peer joined later.
 *
 * Fix: on `ZeroHubDisconnected` for the departing SFU, each remaining peer
 * re-runs the election against the *remaining* roster. The departed peer is
 * still in `peers` at handler time because `removePeer` runs after the
 * status callback, so it is excluded explicitly. The numerically lowest
 * remaining peer becomes the new SFU and connects out to the other
 * survivors; every other survivor points its client-to-SFU connection at
 * the new SFU. A dedup field (`lastElectingSfuId`) makes a duplicate/delayed
 * departure event for the same peer a no-op.
 *
 * Driven through the unit harness (`window.ZeroHubUnitHarness`, mocked
 * `RTCPeerConnection`, no server, no real WebRTC stack). "Reconnect" here
 * means: the new SFU's fresh offer goes out over the (stubbed) signaling
 * socket exactly once, the remaining clients auto-answer it through the
 * existing `offerMessage` path, the roster prunes the departed peer, and no
 * second offer/answer cycle fires for a duplicate departure event.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */

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

type Send = {
  kind: "offer" | "answer" | "iceCandidate";
  peerId: string;
  sdp?: string;
  candidate?: string;
};

/** Thin serializable wrappers over the in-page driver. */
function driver(page: Page) {
  return {
    createSfuClient: (myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([myPeerId, peerIds]) => {
          const id = ZeroHubUnitHarness.createClientWithTopology("sfu");
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds);
          ZeroHubUnitHarness.stubSocket(id);
          ZeroHubUnitHarness.setWaitIceTimeout(id, 50);
          return id;
        },
        [myPeerId, peerIds] as const,
      ),
    sendOfferMessage: (id: number, offerPeerId: string, offerSdp: string) =>
      page.evaluate(
        ([id, offerPeerId, offerSdp]) =>
          ZeroHubUnitHarness.sendOfferMessage(id, offerPeerId, offerSdp),
        [id, offerPeerId, offerSdp] as const,
      ),
    sendPeerDisconnected: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerDisconnected(id, peerId),
        [id, peerId] as const,
      ),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
    drainSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.drainSends(id), id),
    getPeerIds: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.peerIds(id), id),
    getSfuLastElectingPeerId: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSfuLastElectingPeerId(id), id),
    wait: (ms: number) => page.evaluate((ms) => ZeroHubUnitHarness.wait(ms), ms),
  };
}

type Driver = ReturnType<typeof driver>;

/**
 * Outlasts the fire-and-forget offer/answer the SFU topology's `sendOffer`
 * queued: the short `waitIceCandidatesTimeout` fallback (50ms, set by the
 * client-creation helper) fires the SDP send that `armSendOnIceReady` armed
 * in a microtask chain. Returns the accumulated sends since the buffer's
 * last drain.
 */
async function flushSends(h: Driver, id: number): Promise<Send[]> {
  await h.wait(150);
  return h.getSends(id);
}

test.describe("SFUTopology re-election on SFU departure", () => {
  test("lowest-id SFU leaves: surviving lowest-id peer re-elects, reconnects the other client, no duplicate connections", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // 3-peer SFU hub: "1" (SFU), "2" (will become the new SFU), "3" (client).
    // Each surviving client's view of the hub; the SFU "1" itself is not a
    // client here (its outbound offers are simulated via sendOfferMessage).
    const sfu2 = await h.createSfuClient("2", ["1", "3"]);
    const client3 = await h.createSfuClient("3", ["1", "2"]);

    // Establish the initial star around SFU "1": it offers to each client
    // and both auto-answer. This is the "before" state the regression
    // re-elects from. The answerer (client) never offers of its own, so no
    // client-side offer is expected.
    await h.sendOfferMessage(sfu2, "1", "offer-sdp");
    const baseline2 = await flushSends(h, sfu2);
    expect(baseline2.filter((s) => s.kind === "answer")).toEqual([
      { kind: "answer", peerId: "1", sdp: "answer-sdp" },
    ]);
    await h.sendOfferMessage(client3, "1", "offer-sdp");
    const baseline3 = await flushSends(h, client3);
    expect(baseline3.filter((s) => s.kind === "answer")).toEqual([
      { kind: "answer", peerId: "1", sdp: "answer-sdp" },
    ]);
    // Clear the buffers so the re-election assertions see only the new sends.
    expect(await h.drainSends(sfu2)).toEqual(baseline2);
    expect(await h.drainSends(client3)).toEqual(baseline3);

    // The SFU leaves the hub.
    await h.sendPeerDisconnected(sfu2, "1");
    await h.sendPeerDisconnected(client3, "1");
    const sfu2sends = await flushSends(h, sfu2);
    const client3sends = await flushSends(h, client3);

    await test.step(
      "new SFU (lowest remaining id) reconnects the remaining client exactly once",
      async () => {
        // "2" is the new SFU: it re-elected and offered "3" exactly once.
        expect(sfu2sends.filter((s) => s.kind === "offer")).toEqual([
          { kind: "offer", peerId: "3", sdp: "offer-sdp" },
        ]);
        // No answer from "2" itself (it is the offerer to "3").
        expect(sfu2sends.filter((s) => s.kind === "answer")).toEqual([]);
      },
    );

    await test.step(
      "the other surviving client is the answerer and does not offer of its own",
      async () => {
        // "3" re-pointed its SFU connection at "2": it never sends its own
        // offer, and it has not answered yet (the new SFU's offer has not
        // arrived through signaling in this client-side spec — that is the
        // new SFU's responsibility and is asserted below).
        expect(client3sends).toEqual([]);
      },
    );

    await test.step("the departed peer is pruned from the roster", async () => {
      expect(await h.getPeerIds(sfu2)).toEqual(["3"]);
      expect(await h.getPeerIds(client3)).toEqual(["2"]);
    });

    await test.step(
      "duplicate/delayed departure event is a no-op (idempotency)",
      async () => {
        // A second `peerDisconnectedMessage` for the same departed peer must
        // not re-run the election, re-offer, or open a second connection.
        await h.sendPeerDisconnected(sfu2, "1");
        await h.sendPeerDisconnected(client3, "1");
        await h.wait(150);
        expect((await h.getSends(sfu2)).filter((s) => s.kind === "offer")).toEqual([
          { kind: "offer", peerId: "3", sdp: "offer-sdp" },
        ]);
        expect(await h.getSends(client3)).toEqual([]);
      },
    );

    await test.step(
      "the new SFU's offer reaches the client and is auto-answered",
      async () => {
        // Feed the new SFU's offer through the (stubbed) signaling socket the
        // way the real server would relay it: the client auto-answers.
        await h.sendOfferMessage(client3, "2", "offer-sdp");
        const client3afterAnswer = await flushSends(h, client3);
        expect(client3afterAnswer.filter((s) => s.kind === "answer")).toEqual([
          { kind: "answer", peerId: "2", sdp: "answer-sdp" },
        ]);
      },
    );

    await test.step("re-election ran exactly once", async () => {
      expect(await h.getSfuLastElectingPeerId(sfu2)).toBe("1");
      expect(await h.getSfuLastElectingPeerId(client3)).toBe("1");
    });
  });

  test("re-election uses numeric (not lexicographic) peer-id ordering for the new SFU", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // Peers "1" (SFU), "2", "10". After "1" leaves, the remaining ids are
    // "2" and "10". Numerically the lowest is "2"; lexicographically the
    // lowest would be "10" (since "1" < "2" in string order). So whether
    // "2" claims SFU or defers to "10" distinguishes the two orderings.
    const local2 = await h.createSfuClient("2", ["1", "10"]);
    const local10 = await h.createSfuClient("10", ["1", "2"]);

    await h.sendPeerDisconnected(local2, "1");
    await h.sendPeerDisconnected(local10, "1");
    await h.wait(150);

    // "2" is the new SFU (numeric minimum): it re-elects and offers "10".
    // Under a lexicographic election "2" would instead defer to "10" and
    // emit no offer of its own, so this assertion pins the numeric rule.
    expect((await h.getSends(local2)).filter((s) => s.kind === "offer")).toEqual([
      { kind: "offer", peerId: "10", sdp: "offer-sdp" },
    ]);
    // "10" is the client: it re-points at "2" and stays silent.
    expect(await h.getSends(local10)).toEqual([]);
    expect(await h.getSfuLastElectingPeerId(local2)).toBe("1");
    expect(await h.getSfuLastElectingPeerId(local10)).toBe("1");
    expect(await h.getPeerIds(local2)).toEqual(["10"]);
    expect(await h.getPeerIds(local10)).toEqual(["2"]);
  });

  test("a non-SFU surviving client re-points at the new SFU without duplicating its own connection", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // 4-peer hub: "1" (SFU), "2" (new SFU), "3", "4" (client under test).
    const local4 = await h.createSfuClient("4", ["1", "2", "3"]);

    // Baseline: no SDP from "4" (it is the answerer to SFU "1").
    expect(await h.getSends(local4)).toEqual([]);

    // "1" leaves; "2" becomes the new SFU. "4" must point at "2" (it does
    // not offer of its own — it is the answerer to the new SFU).
    await h.sendPeerDisconnected(local4, "1");
    await h.wait(150);
    expect(await h.getSends(local4)).toEqual([]);
    expect(await h.getPeerIds(local4)).toEqual(["2", "3"]);

    // A duplicate departure event for "1" must be a no-op: no second
    // connection, no second offer, no second answer.
    await h.sendPeerDisconnected(local4, "1");
    await h.wait(150);
    expect(await h.getSends(local4)).toEqual([]);
    expect(await h.getPeerIds(local4)).toEqual(["2", "3"]);
    expect(await h.getSfuLastElectingPeerId(local4)).toBe("1");
  });
});
