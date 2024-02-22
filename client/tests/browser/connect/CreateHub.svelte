<script lang="ts">
  import { LogLevel, PeerStatus, ZeroHubClient } from "../../../src/index";
  import { HUB_ID } from "./const";

  let hubId = "";
  let peerStatus = "";

  interface PeerMetaData {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetaData>("ws://localhost:8080", {
    logLevel: LogLevel.Debug,
  });

  zeroHub.onHubInfo = (hubInfo) => {
    hubId = hubInfo.id;
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

  zeroHub.createHub(HUB_ID, { name: "test" });
</script>

HubID:{hubId}
PeerStatus:{peerStatus}
