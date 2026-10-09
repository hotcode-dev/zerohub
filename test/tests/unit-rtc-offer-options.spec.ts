import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the `rtcOfferOptions` merge in `ZeroHubClient.sendOffer` /
 * `sendAnswer`.
 *
 * Regression: both methods used `Object.assign(this.config.rtcOfferOptions,
 * rtcOfferOptions)` — merging the per-call options INTO the client's shared,
 * long-lived `config.rtcOfferOptions` object. A single media-capable call
 * (e.g. `{ offerToReceiveVideo: true }`) permanently mutated the defaults, so
 * every later offer/answer on that client (including the default
 * `MeshTopology` path, which passes `config.rtcOfferOptions` through) silently
 * inherited the media options.
 *
 * The fix merges into a fresh object:
 * `{ ...this.config.rtcOfferOptions, ...rtcOfferOptions }`.
 *
 * Driven through the unit harness (mocked `RTCPeerConnection`, no-op
 * topology, stubbed `client.ws`) — no server, no real WebRTC stack. The mock
 * connection records the exact options it received, so specs can assert both
 * that the shared config is not mutated AND that the merged options are what
 * was actually used to create the offer/answer.
 */

type InvokeResult = {
  configOptions: string;
  sentOptions: string;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  stubSocket(id: number): void;
  invokeSendOffer(
    id: number,
    peerId: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
  ): Promise<InvokeResult>;
  invokeSendAnswer(
    id: number,
    peerId: string,
    offerSdp: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
  ): Promise<InvokeResult>;
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
  };
}

const DEFAULTS = { offerToReceiveAudio: false, offerToReceiveVideo: false };

test.describe("ZeroHubClient rtcOfferOptions merge (no shared-config mutation)", () => {
  test("sendOffer with media options does not mutate config.rtcOfferOptions", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    // Peer "2" exists; stub the socket so sendOffer passes its guard.
    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);

    await test.step("a media-capable call reaches the mock with the merged options", async () => {
      const first = await h.invokeSendOffer(id, "2", {
        offerToReceiveVideo: true,
      });
      // The call's options are still honoured on that call...
      expect(JSON.parse(first.sentOptions)).toEqual({
        offerToReceiveAudio: false,
        offerToReceiveVideo: true,
      });
    });

    await test.step("...but the shared config is left untouched", async () => {
      const second = await h.invokeSendOffer(id, "2");
      expect(JSON.parse(second.configOptions)).toEqual(DEFAULTS);
      // A follow-up call with no options resolves to the ORIGINAL defaults.
      expect(JSON.parse(second.sentOptions)).toEqual(DEFAULTS);
    });
  });

  test("sendAnswer with media options does not mutate config.rtcOfferOptions", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);

    await test.step("a media-capable answer reaches the mock with the merged options", async () => {
      const first = await h.invokeSendAnswer(id, "2", "v=0\n", {
        offerToReceiveAudio: true,
      });
      expect(JSON.parse(first.sentOptions)).toEqual({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
    });

    await test.step("...but the shared config is left untouched", async () => {
      const second = await h.invokeSendAnswer(id, "2", "v=0\n");
      expect(JSON.parse(second.configOptions)).toEqual(DEFAULTS);
      expect(JSON.parse(second.sentOptions)).toEqual(DEFAULTS);
    });
  });

  test("both sendOffer and sendAnswer keep the config pristine across interleaved calls", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);
    h.stubSocket(id);

    await h.invokeSendOffer(id, "2", { offerToReceiveVideo: true });
    await h.invokeSendAnswer(id, "2", "v=0\n", { offerToReceiveAudio: true });

    const final = await h.invokeSendOffer(id, "2");
    expect(JSON.parse(final.configOptions)).toEqual(DEFAULTS);
    expect(JSON.parse(final.sentOptions)).toEqual(DEFAULTS);
  });
});
