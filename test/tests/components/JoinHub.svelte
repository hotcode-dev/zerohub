<script lang="ts">
  import { LogLevel, ZeroHubClient } from "../../../client/src/index";

  export let hubId: string;
  export let zeroHubHosts: string[];

  let hubInfoID = "";
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
  };

  zeroHub.onPeerStatusChange = (peer) => {
    peerStatus = peer.status;
  };

  zeroHub.joinHub(hubId, { name: "test" });
</script>

HubId:{hubInfoID}
PeerStatus:{peerStatus}
