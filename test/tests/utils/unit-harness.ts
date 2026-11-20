import { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gotoStubPage } from "./stub-page";

/**
 * In-page unit harness bundle (built by `test/scripts/build-unit-harness.mjs`
 * via `pretest`). Lives one directory below the spec files, so resolve
 * `test/dist/unit-harness.js` relative to this module's own URL.
 */
function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../dist/unit-harness.js",
  );
}

/**
 * Inject the unit harness (mocked `RTCPeerConnection` + the
 * `window.ZeroHubUnitHarness` driver surface) into a page, on the same
 * data-URL stub page used by the e2e harness.
 */
export async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  await gotoStubPage(page);
}

/**
 * The in-page driver surface (window.ZeroHubUnitHarness). `ZeroHubUnitHarness`
 * is a global installed by the harness's init script, so every call runs
 * inline in the page and only scalar/serializable args are passed across the
 * boundary — never the harness handle itself (Playwright serializes evaluate
 * arguments and rejects non-serializable values like function-bearing
 * objects).
 *
 * Single source of truth for the ~15 unit specs: each spec used to hand-roll
 * this wrapper object word-for-word. Specs that need one-off composite
 * methods can spread this driver and extend locally
 * (`const h = { ...createUnitDriver(page), myExtra: ... }`).
 */
export function createUnitDriver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    createClientWithHosts: (hosts: string[]) =>
      page.evaluate(
        (hostList) => ZeroHubUnitHarness.createClientWithHosts(hostList),
        hosts,
      ),
    createClientWithTopology: (topology: "mesh" | "sfu") =>
      page.evaluate(
        (t) => ZeroHubUnitHarness.createClientWithTopology(t),
        topology,
      ),
    createClientWithMedia: (trackCount: number) =>
      page.evaluate(
        (trackCount) => ZeroHubUnitHarness.createClientWithMedia(trackCount),
        trackCount,
      ),
    createClientWithMediaNoStream: () =>
      page.evaluate(() => ZeroHubUnitHarness.createClientWithMediaNoStream()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    sendHubInfoOnSocket: (id: number, hubId: string, myPeerId: string) =>
      page.evaluate(
        ([id, hubId, myPeerId]) =>
          ZeroHubUnitHarness.sendHubInfoOnSocket(id, hubId, myPeerId),
        [id, hubId, myPeerId] as const,
      ),
    sendPeerJoined: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerJoined(id, peerId),
        [id, peerId] as const,
      ),
    sendPeerDisconnected: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerDisconnected(id, peerId),
        [id, peerId] as const,
      ),
    sendOfferMessage: (id: number, offerPeerId: string, offerSdp: string) =>
      page.evaluate(
        ([id, offerPeerId, offerSdp]) =>
          ZeroHubUnitHarness.sendOfferMessage(id, offerPeerId, offerSdp),
        [id, offerPeerId, offerSdp] as const,
      ),
    sendAnswerMessage: (id: number, answerPeerId: string, answerSdp: string) =>
      page.evaluate(
        ([id, answerPeerId, answerSdp]) =>
          ZeroHubUnitHarness.sendAnswerMessage(id, answerPeerId, answerSdp),
        [id, answerPeerId, answerSdp] as const,
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
    setWaitIceTimeout: (id: number, ms: number) =>
      page.evaluate(
        ([id, ms]) => ZeroHubUnitHarness.setWaitIceTimeout(id, ms),
        [id, ms] as const,
      ),
    setConfig: (id: number, overrides: Record<string, unknown>) =>
      page.evaluate(
        ([id, overrides]) => ZeroHubUnitHarness.setConfig(id, overrides),
        [id, overrides] as const,
      ),
    setAutoAnswer: (id: number, autoAnswer: boolean) =>
      page.evaluate(
        ([id, autoAnswer]) =>
          ZeroHubUnitHarness.setAutoAnswer(id, autoAnswer),
        [id, autoAnswer] as const,
      ),
    setAutoAcceptAnswer: (id: number, autoAcceptAnswer: boolean) =>
      page.evaluate(
        ([id, autoAcceptAnswer]) =>
          ZeroHubUnitHarness.setAutoAcceptAnswer(id, autoAcceptAnswer),
        [id, autoAcceptAnswer] as const,
      ),
    setConnectionState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setConnectionState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    setIceState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setIceState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    setPeerRemoteDescription: (id: number, peerId: string, type: string) =>
      page.evaluate(
        ([id, peerId, type]) =>
          ZeroHubUnitHarness.setPeerRemoteDescription(id, peerId, type),
        [id, peerId, type] as const,
      ),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    captureSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.captureSocket(id), id),
    getSocketCount: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSocketCount(id), id),
    getLastSocketUrl: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getLastSocketUrl(id), id),
    markSocketConnecting: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.markSocketConnecting(id), id),
    simulateAbnormalClose: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.simulateAbnormalClose(id), id),
    disconnectClient: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.disconnectClient(id), id),
    joinStaticHub: (id: number, hubId: string, peerMetadata?: object) =>
      page.evaluate(
        ([id, hubId, peerMetadata]) =>
          ZeroHubUnitHarness.joinStaticHub(id, hubId, peerMetadata),
        [id, hubId, peerMetadata] as const,
      ),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
    drainSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.drainSends(id), id),
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
    referencedConnectionIds: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.referencedConnectionIds(id), id),
    webrtcRecoveryEntries: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.webrtcRecoveryEntries(id), id),
    iceTimeoutEntries: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.iceTimeoutEntries(id), id),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
    getAddedIceCandidates: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) =>
          ZeroHubUnitHarness.getAddedIceCandidates(id, peerId),
        [id, peerId] as const,
      ),
    getAddedTracks: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getAddedTracks(id, peerId),
        [id, peerId] as const,
      ),
    fireOnTrack: (id: number, peerId: string, remoteStreamId: string) =>
      page.evaluate(
        ([id, peerId, remoteStreamId]) =>
          ZeroHubUnitHarness.fireOnTrack(id, peerId, remoteStreamId),
        [id, peerId, remoteStreamId] as const,
      ),
    getMediaOnTrackCalls: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getMediaOnTrackCalls(id), id),
    invokeSendOffer: (
      id: number,
      peerId: string,
      options?: {
        offerToReceiveAudio?: boolean;
        offerToReceiveVideo?: boolean;
      },
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
    invokeAcceptAnswer: (id: number, peerId: string, answerSdp: string) =>
      page.evaluate(
        ([id, peerId, answerSdp]) =>
          ZeroHubUnitHarness.invokeAcceptAnswer(id, peerId, answerSdp),
        [id, peerId, answerSdp] as const,
      ),
    recordOffers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordOffers(id), id),
    getOffers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getOffers(id), id),
    recordAnswers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordAnswers(id), id),
    getAnswers: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getAnswers(id), id),
    getRemoteDescriptions: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getRemoteDescriptions(id), id),
    fireIceCandidate: (id: number, peerId: string, candidate: unknown) =>
      page.evaluate(
        ([id, peerId, candidate]) =>
          ZeroHubUnitHarness.fireIceCandidate(id, peerId, candidate),
        [id, peerId, candidate] as const,
      ),
    getSfuLastElectingPeerId: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.getSfuLastElectingPeerId(id),
        id,
      ),
    captureZeroHubErrors: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.captureZeroHubErrors(id), id),
    getZeroHubErrorMessages: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.getZeroHubErrorMessages(id),
        id,
      ),
    getReconnectAttempts: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.getReconnectAttempts(id),
        id,
      ),
    getReconnectRound: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getReconnectRound(id), id),
    getHostIndex: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getHostIndex(id), id),
    getHost: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getHost(id), id),
    installFakeWebSocket: () =>
      page.evaluate(() => ZeroHubUnitHarness.installFakeWebSocket()),
    markFakeWebSocketHealthy: (host: string) =>
      page.evaluate(
        (host) => ZeroHubUnitHarness.markFakeWebSocketHealthy(host),
        host,
      ),
    markFakeWebSocketDead: (host: string) =>
      page.evaluate(
        (host) => ZeroHubUnitHarness.markFakeWebSocketDead(host),
        host,
      ),
    settleOpen: () => page.evaluate(() => ZeroHubUnitHarness.settleOpen()),
    fireLiveClose: (code: number, reason: string) =>
      page.evaluate(
        ([code, reason]) => ZeroHubUnitHarness.fireLiveClose(code, reason),
        [code, reason] as const,
      ),
    getFakeDials: () => page.evaluate(() => ZeroHubUnitHarness.getFakeDials()),
    teardownFakeWebSocket: () =>
      page.evaluate(() => ZeroHubUnitHarness.teardownFakeWebSocket()),
    wait: (ms: number) => page.evaluate((ms) => ZeroHubUnitHarness.wait(ms), ms),
  };
}

/** The shared unit driver surface (see `createUnitDriver`). */
export type UnitDriver = ReturnType<typeof createUnitDriver>;

/**
 * The reconnect flow (`reconnect` → failover/wraparound re-dial) settles in
 * microtasks; flush them so the reconnected socket exists before the next
 * assertion.
 */
export async function flushMicrotasks(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}
