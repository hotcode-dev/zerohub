import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: `autoAnswer: false` (the documented "manual offer
 * handling" path) used to be unusable. The docs pointed at an `acceptOffer`
 * method that does not exist, and even the real `sendAnswer` was unreachable
 * because the incoming offer SDP was silently dropped by the `offerMessage`
 * branch. With `autoAnswer: false` a peer got stuck in `AnswerPending`
 * forever.
 *
 * This spec pins the fixed behavior through `window.ZeroHubUnitHarness`
 * (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology):
 *
 *  1. With `autoAnswer: false`, an incoming offer is surfaced to the
 *     application via the `onOffer` callback carrying the offering peer and
 *     the exact offer SDP.
 *  2. The `AnswerPending` status fires before the `onOffer` callback.
 *  3. A subsequent `sendAnswer` (the documented manual path) succeeds: the
 *     answer SDP is sent and the peer transitions off `AnswerPending`
 *     (to `Answering`).
 *  4. A dangling offer (peer not in the roster) is not surfaced and does not
 *     crash the dispatcher.
 *  5. With `autoAnswer: true` (the default) the offer is answered
 *     automatically and `onOffer` is not invoked.
 */

type Send = { kind: "offer" | "answer"; peerId: string; sdp: string };

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

function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    setAutoAnswer: (id: number, autoAnswer: boolean) =>
      page.evaluate(
        ([id, autoAnswer]) => ZeroHubUnitHarness.setAutoAnswer(id, autoAnswer),
        [id, autoAnswer] as const,
      ),
    recordOffers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordOffers(id), id),
    getOffers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getOffers(id), id),
    sendOfferMessage: (id: number, offerPeerId: string, offerSdp: string) =>
      page.evaluate(
        ([id, offerPeerId, offerSdp]) =>
          ZeroHubUnitHarness.sendOfferMessage(id, offerPeerId, offerSdp),
        [id, offerPeerId, offerSdp] as const,
      ),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    invokeSendAnswer: (
      id: number,
      peerId: string,
      offerSdp: string,
      options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
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

test("autoAnswer:false surfaces the incoming offer SDP via onOffer and sendAnswer completes the exchange", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.setAutoAnswer(id, false);
  await h.recordOffers(id);

  const OFFER_SDP = "v=0\r\nmanual-offer-sdp";

  await test.step("the peer starts in Pending (discovered via the roster)", async () => {
    expect(await h.getPeerStatus(id, "2")).toBe("pending");
  });

  await test.step("an incoming offer is delivered to onOffer with the exact SDP", async () => {
    await h.sendOfferMessage(id, "2", OFFER_SDP);
    const offers = await h.getOffers(id);
    expect(offers).toHaveLength(1);
    expect(offers[0].peerId).toBe("2");
    expect(offers[0].offerSdp).toBe(OFFER_SDP);
  });

  await test.step("the peer moved to AnswerPending and awaits the manual answer", async () => {
    expect(await h.getPeerStatus(id, "2")).toBe("answer_pending");
    // No automatic answer was sent.
    expect(await h.getSends(id)).toHaveLength(0);
  });

  await test.step("the documented manual path sendAnswer(peer.id, offerSdp) succeeds", async () => {
    h.stubSocket(id);
    const result = await h.invokeSendAnswer(id, "2", OFFER_SDP);
    // The answer used the caller-provided offer options (the default config
    // merged in), and setRemoteDescription took the surfaced offer SDP.
    expect(result.sentOptions).toContain("offerToReceiveAudio");

    // sendAnswer defers the SDP send until ICE gathering completes (or the
    // waitIceCandidatesTimeout fallback); fire the gathering-complete event.
    await h.fireIceCandidate(id, "2", null);

    await test.step("the answer SDP was sent and the peer left AnswerPending", async () => {
      const sends = await h.getSends(id);
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("answer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("answer-sdp");
      expect(await h.getPeerStatus(id, "2")).toBe("answering");
    });
  });
});

test("autoAnswer:false does not surface a dangling offer for an unknown peer", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.setAutoAnswer(id, false);
  await h.recordOffers(id);

  // Feed an offer from a peer that is not in the roster.
  await h.sendOfferMessage(id, "42", "v=0\r\nstray-offer");

  await test.step("the dispatcher survived and did not surface the dangling offer", async () => {
    expect(await h.getOffers(id)).toHaveLength(0);
    // The known peer is untouched.
    expect(await h.getPeerStatus(id, "2")).toBe("pending");
  });
});

test("autoAnswer:true answers automatically and does not invoke onOffer", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.recordOffers(id);
  h.stubSocket(id);

  const OFFER_SDP = "v=0\r\nauto-offer-sdp";
  await h.sendOfferMessage(id, "2", OFFER_SDP);

  await test.step("the answer was sent automatically (default autoAnswer)", async () => {
    // The automatic sendAnswer defers the SDP send until ICE gathering
    // completes; fire the gathering-complete event to release it.
    await h.fireIceCandidate(id, "2", null);
    const sends = await h.getSends(id);
    expect(sends).toHaveLength(1);
    expect(sends[0].kind).toBe("answer");
    expect(sends[0].peerId).toBe("2");
  });

  await test.step("onOffer was not invoked on the automatic path", async () => {
    expect(await h.getOffers(id)).toHaveLength(0);
  });
});
