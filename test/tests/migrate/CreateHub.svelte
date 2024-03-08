<script lang="ts">
  import {
    LogLevel,
    PeerStatus,
    ZeroHubClient,
  } from "../../../client/src/index";

  export let hubId: string;
  export let zeroHubURL: string;

  let hubInfoId = "";
  let peerStatus = "";

  interface PeerMetaData {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetaData>(zeroHubURL, {
    logLevel: LogLevel.Debug,
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

HubID:{hubInfoId}
PeerStatus:{peerStatus}
