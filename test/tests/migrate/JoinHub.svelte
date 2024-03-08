<script lang="ts">
  import { LogLevel, ZeroHubClient } from "../../../client/src/index";

  export let hubId: string;
  export let zeroHubURL: string;

  let hubInfoID = "";
  let peerStatus = "";

  interface PeerMetaData {
    name: string;
  }

  const zeroHub = new ZeroHubClient<PeerMetaData>(zeroHubURL, {
    logLevel: LogLevel.Debug,
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
