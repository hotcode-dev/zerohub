<script lang="ts">
  import { LogLevel, ZeroHubClient } from "../../../src/index";
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
  };

  zeroHub.joinHub(HUB_ID, { name: "test" });
</script>

HubID:{hubId}
PeerStatus:{peerStatus}
