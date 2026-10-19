import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: `autoAcceptAnswer: false` (the documented "manual answer
 * handling" path) used to be unusable. The `answerMessage` branch set the
 * peer to `AcceptPending` and then did nothing — the incoming answer SDP was
 * silently dropped and there was no callback to surface it, so
 * `acceptAnswer` was unreachable and the peer stayed stuck at
 * `AcceptPending` forever.
 *
 * This spec pins the fixed behavior through `window.ZeroHubUnitHarness`
 * (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology):
 *
 *  1. With `autoAcceptAnswer: false`, an incoming answer is surfaced to the
 *     application via the `onAnswer` callback carrying the answering peer
 *     and the exact answer SDP.
 *  2. The answer is NOT accepted automatically: the peer stays in
 *     `AcceptPending` and no `setRemoteDescription` happens until the
 *     application acts.
 *  3. The documented manual path `acceptAnswer(peer.id, answerSdp)` (called
 *     from `onAnswer`) completes the exchange: the exact answer SDP is
 *     applied to the peer's connection as an `answer`.
 *  4. A dangling answer (peer not in the roster) is not surfaced and does
 *     not crash the dispatcher.
 *  5. With `autoAcceptAnswer: true` (the default) the answer is accepted
 *     automatically and `onAnswer` is not invoked.
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

function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    setAutoAcceptAnswer: (id: number, autoAcceptAnswer: boolean) =>
      page.evaluate(
        ([id, autoAcceptAnswer]) =>
          ZeroHubUnitHarness.setAutoAcceptAnswer(id, autoAcceptAnswer),
        [id, autoAcceptAnswer] as const,
      ),
    recordAnswers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordAnswers(id), id),
    getAnswers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getAnswers(id), id),
    sendAnswerMessage: (id: number, answerPeerId: string, answerSdp: string) =>
      page.evaluate(
        ([id, answerPeerId, answerSdp]) =>
          ZeroHubUnitHarness.sendAnswerMessage(id, answerPeerId, answerSdp),
        [id, answerPeerId, answerSdp] as const,
      ),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
    invokeAcceptAnswer: (id: number, peerId: string, answerSdp: string) =>
      page.evaluate(
        ([id, peerId, answerSdp]) =>
          ZeroHubUnitHarness.invokeAcceptAnswer(id, peerId, answerSdp),
        [id, peerId, answerSdp] as const,
      ),
    getRemoteDescriptions: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getRemoteDescriptions(id), id),
  };
}

test("autoAcceptAnswer:false surfaces the incoming answer SDP via onAnswer and acceptAnswer completes the exchange", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.setAutoAcceptAnswer(id, false);
  await h.recordAnswers(id);

  const ANSWER_SDP = "v=0\r\nmanual-answer-sdp";

  await test.step("the peer starts in Pending (discovered via the roster)", async () => {
    expect(await h.getPeerStatus(id, "2")).toBe("pending");
  });

  await test.step("an incoming answer is delivered to onAnswer with the exact SDP", async () => {
    await h.sendAnswerMessage(id, "2", ANSWER_SDP);
    const answers = await h.getAnswers(id);
    expect(answers).toHaveLength(1);
    expect(answers[0].peerId).toBe("2");
    expect(answers[0].answerSdp).toBe(ANSWER_SDP);
  });

  await test.step("the peer moved to AcceptPending and nothing was auto-accepted", async () => {
    expect(await h.getPeerStatus(id, "2")).toBe("accept_pending");
    // No automatic acceptAnswer was invoked.
    expect(await h.getRemoteDescriptions(id)).toHaveLength(0);
  });

  await test.step("the documented manual path acceptAnswer(peer.id, answerSdp) succeeds", async () => {
    await h.invokeAcceptAnswer(id, "2", ANSWER_SDP);

    await test.step("the exact answer SDP was applied to the peer connection", async () => {
      const descs = await h.getRemoteDescriptions(id);
      expect(descs).toEqual([
        { peerId: "2", type: "answer", sdp: ANSWER_SDP },
      ]);
    });
  });
});

test("autoAcceptAnswer:false does not surface a dangling answer for an unknown peer", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.setAutoAcceptAnswer(id, false);
  await h.recordAnswers(id);

  // Feed an answer from a peer that is not in the roster.
  await h.sendAnswerMessage(id, "42", "v=0\r\nstray-answer");

  await test.step("the dispatcher survived and did not surface the dangling answer", async () => {
    expect(await h.getAnswers(id)).toHaveLength(0);
    // The known peer is untouched.
    expect(await h.getPeerStatus(id, "2")).toBe("pending");
  });
});

test("autoAcceptAnswer:true accepts automatically and does not invoke onAnswer", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const id = await h.createClient();

  await h.sendHubInfo(id, "1", ["2"]);
  await h.recordAnswers(id);

  const ANSWER_SDP = "v=0\r\nauto-answer-sdp";
  await h.sendAnswerMessage(id, "2", ANSWER_SDP);

  await test.step("the answer was accepted automatically (default autoAcceptAnswer)", async () => {
    // acceptAnswer() is a short async chain; by the time this separate
    // evaluate runs its microtasks have settled.
    const descs = await h.getRemoteDescriptions(id);
    expect(descs).toEqual([
      { peerId: "2", type: "answer", sdp: ANSWER_SDP },
    ]);
  });

  await test.step("onAnswer was not invoked on the automatic path", async () => {
    expect(await h.getAnswers(id)).toHaveLength(0);
  });
});
