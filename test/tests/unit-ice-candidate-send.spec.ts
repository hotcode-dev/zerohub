import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the shared `armSendOnIceReady` helper extracted out of
 * `ZeroHubClient.sendOffer` / `sendAnswer` (the "wait for ICE candidates or
 * time out, then send the local SDP exactly once" block).
 *
 * Both methods previously carried a near-identical ~30-line copy of this
 * concurrency-critical logic (an `isSent` guard, an `onicecandidate` wiring
 * with the `event.candidate` trailing-candidate check, a clear of the prior
 * `this.iceTimeouts[peerId]` handle, and a `waitIceCandidatesTimeout`
 * fallback). The refactor collapses it into one private helper so the two
 * paths can no longer silently drift.
 *
 * These tests drive the helper end-to-end through the real `sendOffer` /
 * `sendAnswer` methods using the unit harness (mocked `RTCPeerConnection`,
 * no-op topology, capturing stubbed `client.ws`). No server, no real WebRTC
 * stack.
 *
 * Covers:
 *  (a) the offer/answer is sent EXACTLY ONCE when ICE candidates arrive after
 *      the offer/answer is created — in-flight candidates (carrying a
 *      `candidate`) are ignored, only the candidate-less "gathering complete"
 *      event fires the send, and a second candidate event does not re-send.
 *  (b) when no candidates arrive within `waitIceCandidatesTimeout`, the send
 *      fires exactly once from the timeout (not twice from both
 *      onicecandidate and the timer), and the late candidate then does not
 *      re-send.
 *  (c) the two call sites (sendOffer vs. sendAnswer) both funnel through the
 *      same helper: same send-once semantics, same trailing-candidate guard.
 */

type Send = { kind: "offer" | "answer"; peerId: string; sdp: string };

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  stubSocket(id: number): void;
  setWaitIceTimeout(id: number, ms: number): void;
  invokeSendOffer(
    id: number,
    peerId: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
  ): Promise<{ configOptions: string; sentOptions: string }>;
  invokeSendAnswer(
    id: number,
    peerId: string,
    offerSdp: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
  ): Promise<{ configOptions: string; sentOptions: string }>;
  fireIceCandidate(id: number, peerId: string, candidate: unknown): void;
  getSends(id: number): Send[];
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

/** A short fallback, but comfortably above the accumulated latency of the
 * several `page.evaluate` round-trips (invoke + fire) that precede each
 * assertion, so the fallback timer can't race in and send before we assert
 * that in-flight candidates were ignored. */
const FALLBACK_TIMEOUT_MS = 300;
/** Long enough that, by the time we check after this wait, the fallback
 * timer has definitely fired for the no-candidate tests. */
const WAIT_AFTER_SEND_MS = 500;

test.describe("ZeroHubClient armSendOnIceReady (send-once ICE-candidate wait)", () => {
  test("sendOffer sends exactly once when candidates arrive after offer creation", async ({
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

    await test.step("in-flight ICE candidates (carrying a candidate) are ignored", async () => {
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
      });
      await page.waitForTimeout(30);
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("the candidate-less 'gathering complete' event fires the send", async () => {
      await h.fireIceCandidate(id, "2", null);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("offer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("offer-sdp");
    });

    await test.step("a further candidate event does not re-send", async () => {
      await h.fireIceCandidate(id, "2", null);
      await page.waitForTimeout(20);
      expect((await h.getSends(id)) as Send[]).toHaveLength(1);
    });
  });

  test("sendAnswer sends exactly once when candidates arrive after answer creation", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);
    await h.invokeSendAnswer(id, "2", "v=0\n");

    await test.step("an in-flight ICE candidate is ignored", async () => {
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:2 1 udp 184549489 5.6.7.8 9010 typ host",
      });
      await page.waitForTimeout(30);
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("the gathering-complete event fires the answer send exactly once", async () => {
      await h.fireIceCandidate(id, "2", null);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("answer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("answer-sdp");
    });
  });

  test("sendOffer fires exactly once from the timeout when no candidates arrive", async ({
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

    await test.step("a late candidate arriving after the timeout does not re-send", async () => {
      await h.fireIceCandidate(id, "2", null);
      await page.waitForTimeout(20);
      expect((await h.getSends(id)) as Send[]).toHaveLength(1);
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

  test("sendOffer and sendAnswer share the same send-once contract (no drift)", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.setWaitIceTimeout(id, FALLBACK_TIMEOUT_MS);
    await h.sendHubInfo(id, "1", ["2", "3"]);
    h.stubSocket(id);

    await test.step("both paths ignore in-flight candidates", async () => {
      await h.invokeSendOffer(id, "2");
      await h.invokeSendAnswer(id, "3", "v=0\n");
      await h.fireIceCandidate(id, "2", { candidate: "cand-a" });
      await h.fireIceCandidate(id, "3", { candidate: "cand-b" });
      await page.waitForTimeout(30);
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("each path sends exactly once on gathering-complete", async () => {
      await h.fireIceCandidate(id, "2", null);
      await h.fireIceCandidate(id, "3", null);
      const sends = (await h.getSends(id)) as Send[];
      const offers = sends.filter((s) => s.kind === "offer");
      const answers = sends.filter((s) => s.kind === "answer");
      expect(offers).toHaveLength(1);
      expect(answers).toHaveLength(1);
      expect(offers[0].peerId).toBe("2");
      expect(answers[0].peerId).toBe("3");
    });

    await test.step("re-firing the same events does not add more sends", async () => {
      await h.fireIceCandidate(id, "2", null);
      await h.fireIceCandidate(id, "3", null);
      expect((await h.getSends(id)) as Send[]).toHaveLength(2);
    });
  });
});
