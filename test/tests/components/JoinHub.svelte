<script lang="ts">
  import {
    LogLevel,
    PeerStatus,
    ZeroHubClient,
  } from "../../../client/src/index";

  export let testName: string;
  export let componentId: string;
  export let hubId: string;
  export let zeroHubHosts: string[];

  let hubInfoID = "";
  let hubMetadata = {};
  let peerStatus = "";

  interface PeerMetadata {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetadata>(zeroHubHosts, {
    logLevel: LogLevel.Debug,
    tls: false,
  });

  zeroHub.onHubInfo = (hubInfo) => {
    hubInfoID = hubInfo.id;
    hubMetadata = hubInfo.metadata;
  };

  zeroHub.onPeerStatusChange = (peer) => {
    switch (peer.status) {
      case PeerStatus.Connected:
        peerStatus = peer.status;
        break;
      case PeerStatus.Pending:
      case PeerStatus.ZeroHubDisconnected:
    }
  };

  zeroHub.joinRandomHub(hubId, { name: "test" });
</script>

<h2>Join Hub</h2>
<div>Test Name: {testName}</div>
<div>Hub ID: {hubId}</div>
<div>Component ID: {componentId}</div>
<div data-testid={`join-hub-id-${componentId}`}>{hubInfoID}</div>
<div data-testid={`join-peer-status-${componentId}`}>{peerStatus}</div>
