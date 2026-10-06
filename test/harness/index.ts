import {
  LogLevel,
  Peer,
  ZeroHubClient,
} from "../../client/src/index";

type PeerMetadata = {
  name: string;
};

type BaseOptions = {
  componentId: string;
  zeroHubHosts: string[];
  testName?: string;
};

type CreateHubOptions = BaseOptions;
type JoinHubOptions = BaseOptions & { hubId: string };
type DisconnectOptions = Pick<BaseOptions, "componentId">;
type ReuseCreateHubOptions = Pick<BaseOptions, "componentId">;

type HarnessInstance = {
  container: HTMLElement;
  client: ZeroHubClient<PeerMetadata, Record<string, unknown>>;
};

const instances = new Map<string, HarnessInstance>();
const dataChannelStates = new Map<string, Map<string, string>>();

type PeerStatusLogEntry = {
  peerId: string;
  status: string;
  /**
   * Live reference to the Peer object at the time of the status change. Kept
   * so tests can inspect `peer.rtcConn.connectionState` *after* the peer has
   * been removed from the client's `peers` map (verifies the
   * RTCPeerConnection was closed on disconnect).
   */
  peer: Peer<PeerMetadata>;
};

const peerStatusLog = new Map<string, PeerStatusLogEntry[]>();

function logPeerStatus(componentId: string, peer: Peer<PeerMetadata>) {
  let log = peerStatusLog.get(componentId);
  if (!log) {
    log = [];
    peerStatusLog.set(componentId, log);
  }
  log.push({ peerId: peer.id, status: peer.status, peer });
}

function setDataChannelStatus(
  componentId: string,
  label: string,
  status: string
) {
  let componentStates = dataChannelStates.get(componentId);
  if (!componentStates) {
    componentStates = new Map();
    dataChannelStates.set(componentId, componentStates);
  }

  componentStates.set(label, status);
}

function watchDataChannel(
  componentId: string,
  container: HTMLElement,
  dataChannel: RTCDataChannel
) {
  const statusAttr = `data-${dataChannel.label}-status`;

  const updateStatus = () => {
    const state = dataChannel.readyState;
    container.setAttribute(statusAttr, state);
    setDataChannelStatus(componentId, dataChannel.label, state);
  };

  updateStatus();

  dataChannel.addEventListener("open", updateStatus);
  dataChannel.addEventListener("close", updateStatus);
}

function getDataChannelStatus(componentId: string, label: string) {
  return dataChannelStates.get(componentId)?.get(label) ?? null;
}

/**
 * Returns a snapshot of the client's `peers` map: the list of peer IDs and
 * each peer's RTCPeerConnection `connectionState`.
 */
function getPeersInfo(componentId: string) {
  const instance = instances.get(componentId);
  if (!instance) {
    return { peerIds: [] as string[], rtcStates: {} as Record<string, string> };
  }
  const peerIds = Object.keys(instance.client.peers);
  const rtcStates: Record<string, string> = {};
  for (const id of peerIds) {
    rtcStates[id] = instance.client.peers[id].rtcConn.connectionState;
  }
  return { peerIds, rtcStates };
}

/**
 * Returns the recorded `onPeerStatusChange` events for a component as a
 * serializable snapshot. Each entry's `rtcConnConnectionState` is read live
 * from the (possibly already-removed) Peer's RTCPeerConnection at call time,
 * so a test can verify the connection was closed after the peer was torn down.
 */
function getPeerStatusLog(componentId: string) {
  return (peerStatusLog.get(componentId) ?? []).map((entry) => ({
    peerId: entry.peerId,
    status: entry.status,
    rtcConnConnectionState: entry.peer.rtcConn.connectionState,
  }));
}

/**
 * Returns a snapshot of the client's ZeroHub host state: the current host,
 * its index in the `hosts` list, and whether the WebSocket is open. Used to
 * verify failover advanced exactly one host on a single connection failure.
 */
function getClientInfo(componentId: string) {
  const instance = instances.get(componentId);
  if (!instance) {
    return null;
  }
  const { client } = instance;
  return {
    host: client.host,
    hostIndex: client.hostIndex,
    wsOpen: client.ws?.readyState === WebSocket.OPEN,
  };
}

/**
 * Closes the client's WebSocket connection to simulate a peer leaving the hub.
 * The server will broadcast a `PeerDisconnectedMessage` to the remaining peers.
 */
function closeWs(componentId: string) {
  const instance = instances.get(componentId);
  if (!instance) {
    throw new Error(`Unknown component: ${componentId}`);
  }
  instance.client.ws?.close();
}

function ensureRoot(): HTMLElement {
  const existing = document.getElementById("zero-hub-test-root");
  if (existing) {
    return existing;
  }
  const root = document.createElement("div");
  root.id = "zero-hub-test-root";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "1rem";
  document.body.appendChild(root);
  return root;
}

function createLabel(text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

function createDataDiv(testId: string): HTMLDivElement {
  const div = document.createElement("div");
  div.dataset["testid"] = testId;
  return div;
}

function registerInstance(
  componentId: string,
  client: ZeroHubClient<PeerMetadata, Record<string, unknown>>,
  container: HTMLElement
) {
  instances.set(componentId, { client, container });
}

function createHub(options: CreateHubOptions) {
  const { componentId, zeroHubHosts, testName } = options;
  const root = ensureRoot();
  const container = document.createElement("section");
  container.dataset["componentId"] = componentId;

  container.appendChild(createLabel("Create Hub"));
  if (testName) {
    container.appendChild(createLabel(`Test Name: ${testName}`));
  }
  container.appendChild(createLabel(`Component ID: ${componentId}`));

  const hubIdDiv = createDataDiv(`create-hub-id-${componentId}`);
  const peerStatusDiv = createDataDiv(`create-peer-status-${componentId}`);
  container.appendChild(hubIdDiv);
  container.appendChild(peerStatusDiv);

  root.appendChild(container);

  const zeroHub = new ZeroHubClient<PeerMetadata, Record<string, unknown>>(
    zeroHubHosts,
    {
      logLevel: LogLevel.Debug,
      tls: false,
      waitIceCandidatesTimeout: 5000,
      dataChannelConfig: {
        numberOfChannels: 1,
        rtcDataChannelInit: { ordered: true },
        onDataChannel: (_peer, dataChannel) => {
          watchDataChannel(componentId, container, dataChannel);
        },
      },
    }
  );

  zeroHub.onHubInfo = (hubInfo) => {
    hubIdDiv.textContent = hubInfo.id;
  };

  zeroHub.onPeerStatusChange = (peer) => {
    peerStatusDiv.textContent = peer.status;
    logPeerStatus(componentId, peer);
  };

  zeroHub.createRandomHub({ name: "test" });

  registerInstance(componentId, zeroHub, container);
}

function joinHub(options: JoinHubOptions) {
  const { componentId, zeroHubHosts, testName, hubId } = options;
  const root = ensureRoot();
  const container = document.createElement("section");
  container.dataset["componentId"] = componentId;

  container.appendChild(createLabel("Join Hub"));
  if (testName) {
    container.appendChild(createLabel(`Test Name: ${testName}`));
  }
  container.appendChild(createLabel(`Hub ID: ${hubId}`));
  container.appendChild(createLabel(`Component ID: ${componentId}`));

  const hubIdDiv = createDataDiv(`join-hub-id-${componentId}`);
  const peerStatusDiv = createDataDiv(`join-peer-status-${componentId}`);
  container.appendChild(hubIdDiv);
  container.appendChild(peerStatusDiv);

  root.appendChild(container);

  const zeroHub = new ZeroHubClient<PeerMetadata, Record<string, unknown>>(
    zeroHubHosts,
    {
      logLevel: LogLevel.Debug,
      tls: false,
      waitIceCandidatesTimeout: 5000,
      dataChannelConfig: {
        numberOfChannels: 1,
        rtcDataChannelInit: { ordered: true },
        onDataChannel: (_peer, dataChannel) => {
          watchDataChannel(componentId, container, dataChannel);
        },
      },
    }
  );

  zeroHub.onHubInfo = (hubInfo) => {
    hubIdDiv.textContent = hubInfo.id;
  };

  zeroHub.onPeerStatusChange = (peer) => {
    peerStatusDiv.textContent = peer.status;
    logPeerStatus(componentId, peer);
  };

  zeroHub.joinRandomHub(hubId, { name: "test" });

  registerInstance(componentId, zeroHub, container);
}

function disconnect(options: DisconnectOptions) {
  const { componentId } = options;
  const instance = instances.get(componentId);
  if (!instance) {
    throw new Error(`no instance found for componentId: ${componentId}`);
  }

  const { client } = instance;
  // Capture peer objects by reference before disconnect() empties the map.
  // The captured statuses are stable because disconnect() closes the
  // WebSocket and nulls its onmessage handler BEFORE clearing the peers map,
  // so no later server broadcast (e.g. peerDisconnected) can arrive and
  // overwrite the captured status at all.
  const peers = Object.values(client.peers);
  const peerConnections = peers.map((peer) => peer.rtcConn);

  client.disconnect();

  // Read the peer statuses synchronously at the moment of teardown.
  const statuses = peers.map((peer) => peer.status).join("|");

  const wsClosed = client.ws === undefined;
  const peersClosed = peerConnections.every(
    (rtcConn) => rtcConn.connectionState === "closed"
  );

  const statusDiv = createDataDiv(`disconnect-status-${componentId}`);
  statusDiv.textContent = `status:${statuses},ws:${
    wsClosed ? "closed" : "open"
  },peers:${peersClosed ? "closed" : "open"},count:${
    peerConnections.length
  }`;
  instance.container.appendChild(statusDiv);
}

function reuseCreateHub(options: ReuseCreateHubOptions) {
  const { componentId } = options;
  const instance = instances.get(componentId);
  if (!instance) {
    throw new Error(`no instance found for componentId: ${componentId}`);
  }

  const reuseDiv = createDataDiv(`reuse-hub-id-${componentId}`);
  instance.container.appendChild(reuseDiv);

  // Point the hub-info handler at the reuse div so the new hub id proves
  // the re-created connection is live and delivering server messages.
  instance.client.onHubInfo = (hubInfo) => {
    reuseDiv.textContent = hubInfo.id;
  };

  instance.client.createRandomHub({ name: "test" });
}

const ZeroHubHarness = {
  createHub,
  joinHub,
  disconnect,
  reuseCreateHub,
  getDataChannelStatus,
  getPeersInfo,
  getPeerStatusLog,
  getClientInfo,
  closeWs,
};

declare global {
  interface Window {
    ZeroHubHarness: typeof ZeroHubHarness;
  }
}

window.ZeroHubHarness = ZeroHubHarness;

export {};
