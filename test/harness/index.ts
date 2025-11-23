import {
  LogLevel,
  PeerStatus,
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

type HarnessInstance = {
  container: HTMLElement;
  client: ZeroHubClient<PeerMetadata, Record<string, unknown>>;
};

const instances = new Map<string, HarnessInstance>();
const dataChannelStates = new Map<string, Map<string, string>>();

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
  };

  zeroHub.joinRandomHub(hubId, { name: "test" });

  registerInstance(componentId, zeroHub, container);
}

const ZeroHubHarness = {
  createHub,
  joinHub,
  getDataChannelStatus,
};

declare global {
  interface Window {
    ZeroHubHarness: typeof ZeroHubHarness;
  }
}

window.ZeroHubHarness = ZeroHubHarness;

export {};
