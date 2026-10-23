import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Unit tests for the shared `armSendOnIceReady` helper extracted out of
 * `ZeroHubClient.sendOffer` / `sendAnswer` (the "send the local SDP exactly
 * once, then keep trickling ICE candidates" block).
 *
 * Both methods previously carried a near-identical ~30-line copy of this
 * concurrency-critical logic (an `isSent` guard, an `onicecandidate` wiring
 * with a `waitIceCandidatesTimeout` fallback). The refactor collapses it into
 * one private helper so the two paths can no longer silently drift.
 *
 * These tests drive the helper end-to-end through the real `sendOffer` /
 * `sendAnswer` methods using the unit harness (mocked `RTCPeerConnection`,
 * no-op topology, capturing stubbed `client.ws`). No server, no real WebRTC
 * stack.
 *
 * Covers:
 *  (a) the offer/answer is sent EXACTLY ONCE: the first event that carries a
 *      candidate (or the gathering-complete marker) fires the send, and no
 *      later event re-sends it.
 *  (b) trickle ICE: every candidate that trickles in AFTER the SDP has been
 *      sent is forwarded to the remote peer via `sendIceCandidateMessage`
 *      (one `SendIceCandidateMessage` per candidate, with the candidate
 *      verbatim) instead of being silently dropped.
 *  (c) when no candidates arrive within `waitIceCandidatesTimeout`, the send
 *      fires exactly once from the timeout, and candidates trickling in after
 *      the timeout are still forwarded (not re-sending the SDP).
 *  (d) the two call sites (sendOffer vs. sendAnswer) both funnel through the
 *      same helper: same send-once semantics, same trickle forwarding.
 */

type Send = {
  kind: "offer" | "answer" | "iceCandidate";
  peerId: string;
  sdp?: string;
  candidate?: string;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */

function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    setWaitIceTimeout: (id: number, ms: number) =>
      page.evaluate(
        ([id, ms]) => ZeroHubUnitHarness.setWaitIceTimeout(id, ms),
        [id, ms] as const,
      ),
    invokeSendOffer: (
      id: number,
      peerId: string,
      options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
    ) =>
      page.evaluate(
        ([id, peerId, options]) =>
          ZeroHubUnitHarness.invokeSendOffer(id, peerId, options),
        [id, peerId, options] as const,
      ),
    invokeSendAnswer: (
      id: number,
      peerId: string,
      offerSdp: string,
      options?: {
        offerToReceiveAudio?: boolean;
        offerToReceiveVideo?: boolean;
      },
    ) =>
      page.evaluate(
        ([id, peerId, offerSdp, options]) =>
          ZeroHubUnitHarness.invokeSendAnswer(id, peerId, offerSdp, options),
        [id, peerId, offerSdp, options] as const,
      ),
    fireIceCandidate: (id: number, peerId: string, candidate: unknown) =>
      page.evaluate(
        ([id, peerId, candidate]) =>
          ZeroHubUnitHarness.fireIceCandidate(id, peerId, candidate),
        [id, peerId, candidate] as const,
      ),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
  };
}

/** Short fallback window used by the no-candidate tests. */
const FALLBACK_TIMEOUT_MS = 300;
/** Long enough that, by the time we check after this wait, the fallback
 * timer has definitely fired for the no-candidate tests. */
const WAIT_AFTER_SEND_MS = 500;

/** The host candidate a real browser trickles in first. */
const HOST_CANDIDATE =
  "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host";
/** A second, later candidate (e.g. a STUN reflexive one). */
const SRFLX_CANDIDATE =
  "candidate:2 1 udp 184549489 5.6.7.8 9010 typ srflx raddr 0.0.0.0 rport 0";

test.describe("ZeroHubClient armSendOnIceReady (send-once + trickle ICE)", () => {
  test("sendOffer sends exactly once and trickles post-SDP candidates", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    // Shorten the fallback so it cannot race in, then arm the offer.
    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendOffer(id, "2");

    await test.step("the first in-flight candidate fires the SDP send exactly once", async () => {
      await h.fireIceCandidate(id, "2", { candidate: HOST_CANDIDATE });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      const sdpSends = sends.filter((s) => s.kind !== "iceCandidate");
      expect(sdpSends).toHaveLength(1);
      expect(sdpSends[0].kind).toBe("offer");
      expect(sdpSends[0].peerId).toBe("2");
      expect(sdpSends[0].sdp).toBe("offer-sdp");
      // and the same candidate is trickled to the remote peer
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(1);
      expect(candidates[0].peerId).toBe("2");
      expect(candidates[0].candidate).toContain(HOST_CANDIDATE);
    });

    await test.step("candidates trickled in AFTER the SDP are forwarded, not re-sent", async () => {
      await h.fireIceCandidate(id, "2", { candidate: SRFLX_CANDIDATE });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      // still exactly ONE SDP send
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
      // both candidates were forwarded
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(2);
      expect(candidates[0].candidate).toContain(HOST_CANDIDATE);
      expect(candidates[1].candidate).toContain(SRFLX_CANDIDATE);
    });

    await test.step("a further candidate event does not re-send", async () => {
      await h.fireIceCandidate(id, "2", null);
      await page.waitForTimeout(20);
      expect(
        ((await h.getSends(id)) as Send[]).filter((s) => s.kind !== "iceCandidate"),
      ).toHaveLength(1);
      expect(
        ((await h.getSends(id)) as Send[]).filter((s) => s.kind === "iceCandidate"),
      ).toHaveLength(2);
    });
  });

  test("sendAnswer sends exactly once and trickles post-SDP candidates", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendAnswer(id, "2", "v=0\n");

    await test.step("the first in-flight candidate fires the answer send exactly once", async () => {
      await h.fireIceCandidate(id, "2", { candidate: HOST_CANDIDATE });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
      expect(sends[0].kind).toBe("answer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("answer-sdp");
    });

    await test.step("a candidate trickled in AFTER the SDP is forwarded", async () => {
      await h.fireIceCandidate(id, "2", { candidate: SRFLX_CANDIDATE });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(2);
      expect(candidates[0].candidate).toContain(HOST_CANDIDATE);
      expect(candidates[1].candidate).toContain(SRFLX_CANDIDATE);
    });
  });

  test("sendOffer fires exactly once from the timeout, then trickles late candidates", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendOffer(id, "2");

    await test.step("nothing is sent before the timeout window elapses", async () => {
      await page.waitForTimeout(20);
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("the fallback timer sends the offer exactly once", async () => {
      await page.waitForTimeout(WAIT_AFTER_SEND_MS);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("offer");
      expect(sends[0].sdp).toBe("offer-sdp");
    });

    await test.step("a candidate trickled in after the timeout is forwarded, not re-sent", async () => {
      await h.fireIceCandidate(id, "2", { candidate: HOST_CANDIDATE });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(1);
      expect(candidates[0].peerId).toBe("2");
      expect(candidates[0].candidate).toContain(HOST_CANDIDATE);
    });
  });

  test("sendAnswer fires exactly once from the timeout when no candidates arrive", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendAnswer(id, "2", "v=0\n");

    await test.step("the fallback timer sends the answer exactly once", async () => {
      await page.waitForTimeout(WAIT_AFTER_SEND_MS);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("answer");
      expect(sends[0].sdp).toBe("answer-sdp");
    });
  });

  test("sendOffer and sendAnswer share the same send-once + trickle contract (no drift)", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2", "3"]);
    h.stubSocket(id);

    await test.step("each path sends the SDP exactly once on the first candidate", async () => {
      await h.invokeSendOffer(id, "2");
      await h.invokeSendAnswer(id, "3", "v=0\n");
      await h.fireIceCandidate(id, "2", { candidate: "cand-a" });
      await h.fireIceCandidate(id, "3", { candidate: "cand-b" });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      const offers = sends.filter((s) => s.kind === "offer");
      const answers = sends.filter((s) => s.kind === "answer");
      expect(offers).toHaveLength(1);
      expect(answers).toHaveLength(1);
      expect(offers[0].peerId).toBe("2");
      expect(answers[0].peerId).toBe("3");
    });

    await test.step("each path trickles a later candidate without re-sending", async () => {
      await h.fireIceCandidate(id, "2", { candidate: "cand-a-2" });
      await h.fireIceCandidate(id, "3", { candidate: "cand-b-2" });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind === "offer")).toHaveLength(1);
      expect(sends.filter((s) => s.kind === "answer")).toHaveLength(1);
      expect(
        sends.filter(
          (s) => s.kind === "iceCandidate" && s.peerId === "2",
        ),
      ).toHaveLength(2);
      expect(
        sends.filter(
          (s) => s.kind === "iceCandidate" && s.peerId === "3",
        ),
      ).toHaveLength(2);
    });

    await test.step("re-firing the gathering-complete event does not add more SDP sends", async () => {
      await h.fireIceCandidate(id, "2", null);
      await h.fireIceCandidate(id, "3", null);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(2);
    });
  });

  test("candidates are serialized via toJSON so sdpMid/sdpMLineIndex are preserved", async ({
    page,
  }) => {
    // `RTCIceCandidateInit.sdpMid`/`sdpMLineIndex` are optional and the remote
    // peer's `addIceCandidate` rejects a candidate that lacks them. The client
    // must therefore emit the full `RTCIceCandidateInit` on the wire. We model
    // a real `RTCIceCandidate` in-page: `sdpMid`/`sdpMLineIndex` as prototype
    // accessors (NOT own enumerable properties — plain object serialization
    // drops them) and a `toJSON()` returning the spec-correct init. The object
    // must be built in-page (a `page.evaluate` arg would be JSON-serialized and
    // lose its accessors/toJSON on the way in).
    const LEGACY_CANDIDATE = "candidate:legacy 1 udp 2130 9.9.9.9 777 typ host";

    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendOffer(id, "2");

    await test.step("a candidate whose init fields live on toJSON reaches the wire complete", async () => {
      await page.evaluate(
        ({ clientId, peerId, legacyCandidate }) => {
        const proto = {
          get sdpMid() {
            return "0";
          },
          get sdpMLineIndex() {
            return 0;
          },
          // `this` gains `candidate` only at runtime (own property added
          // after `Object.create`), which the structural type can't model.
          toJSON(this: {
            candidate?: string;
            sdpMid: string;
            sdpMLineIndex: number;
          }): { candidate: string; sdpMid: string; sdpMLineIndex: number } {
            return {
              candidate: this.candidate ?? "",
              sdpMid: this.sdpMid,
              sdpMLineIndex: this.sdpMLineIndex,
            };
          },
        };
        const legacy = Object.create(proto);
        legacy.candidate = legacyCandidate;
        // Own-enumerable view only: `candidate` — the init fields are reachable
        // through toJSON() alone.
        ZeroHubUnitHarness.fireIceCandidate(clientId, peerId, legacy);
      }, { clientId: id, peerId: "2", legacyCandidate: LEGACY_CANDIDATE });
      await page.waitForTimeout(30);

      const sends = (await h.getSends(id)) as Send[];
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(1);
      const parsed = JSON.parse(candidates[0].candidate as string);
      // The full init, not just the own-enumerable `candidate` property.
      expect(parsed).toEqual({
        candidate: LEGACY_CANDIDATE,
        sdpMid: "0",
        sdpMLineIndex: 0,
      });
    });

    await test.step("a candidate without toJSON is forwarded verbatim (own init fields survive)", async () => {
      // The fallback branch (`typeof candidate.toJSON !== "function"`): a plain
      // init-shaped object must reach the wire with its own fields intact.
      const plain = {
        candidate: "candidate:p 1 udp 1 8.8.8.8 55 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      await h.fireIceCandidate(id, "2", plain);
      await page.waitForTimeout(30);

      const sends = (await h.getSends(id)) as Send[];
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(2);
      const parsed = JSON.parse(candidates[1].candidate as string);
      expect(parsed).toEqual(plain);
    });
  });
});
