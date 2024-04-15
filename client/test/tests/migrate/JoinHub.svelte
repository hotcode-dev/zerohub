<script lang="ts">
  import { LogLevel, ZeroHubClient } from "../../../src/index";

  export let hubId: string;
  export let zeroHubHost: string;

  let hubInfoID = "";
  let peerStatus = "";

  interface PeerMetadata {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetadata>(zeroHubHost, {
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

HubId:{hubInfoID}
PeerStatus:{peerStatus}
