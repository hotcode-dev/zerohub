<script lang="ts">
  import {
    LogLevel,
    PeerStatus,
    ZeroHubClient,
  } from "../../../client/src/index";

  export let componentId: string;
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
        if (zeroHub.myPeerId && peer.id > zeroHub.myPeerId) {
          zeroHub.sendOffer(peer.id);
        }
        break;
      case PeerStatus.ZeroHubDisconnected:
    }
  };

  zeroHub.createHub({ foo: "bar" }, { name: "test" });
</script>

<div data-testid={`create-hub-id-${componentId}`}>{hubInfoID}</div>
<div data-testid={`create-peer-status-${componentId}`}>{peerStatus}</div>
