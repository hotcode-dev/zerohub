<script lang="ts">
  import {
    LogLevel,
    PeerStatus,
    ZeroHubClient,
  } from "../../../client/src/index";

  export let hubId: string;
  export let zeroHubHosts: string[];

  let hubInfoId = "";
  let peerStatus = "";

  interface PeerMetadata {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetadata>(zeroHubHosts, {
    logLevel: LogLevel.Debug,
    tls: false,
  });

  zeroHub.onHubInfo = (hubInfo) => {
    hubInfoId = hubInfo.id;
  };

  zeroHub.onPeerStatusChange = (peer) => {
    peerStatus = peer.status;
    switch (peer.status) {
      case PeerStatus.Connected:
        break;
      case PeerStatus.Pending:
        if (zeroHub.myPeerId && peer.id > zeroHub.myPeerId) {
          zeroHub.sendOffer(peer.id);
        }
        break;
      case PeerStatus.ZeroHubDisconnected:
    }
  };

  zeroHub.createHub(hubId, { name: "test" });
</script>

HubId:{hubInfoId}
PeerStatus:{peerStatus}
