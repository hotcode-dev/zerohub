<script lang="ts">
  import { LogLevel, ZeroHubClient } from "../../../src/index";

  export let hubId: string;
  export let zeroHubHost: string;

  let hubInfoID = "";
  let peerStatus = "";

  interface PeerMetaData {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetaData>(zeroHubHost, {
    logLevel: LogLevel.Debug,
    tls: false,
  });

  zeroHub.onHubInfo = (hubInfo) => {
    hubInfoID = hubInfo.id;
  };

  zeroHub.onPeerStatusChange = (peer) => {
    peerStatus = peer.status;
  };

  zeroHub.joinHub(hubId, { name: "test" });
</script>

HubID:{hubInfoID}
PeerStatus:{peerStatus}
