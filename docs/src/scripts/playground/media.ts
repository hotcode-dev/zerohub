import { ZeroHubClient } from "@zero-hub/client";

const hubIdElm = document.getElementById("hub-id");
const videoGridElm = document.getElementById("videos-grid") as HTMLDivElement;
const localVideoElm = document.createElement("video");
localVideoElm.playsInline = true;
localVideoElm.autoplay = true;

// The demo must obtain the local media stream BEFORE the client connects:
// the SDK only adds `mediaChannelConfig.localStream` tracks to each peer
// connection at peer-setup time, so a stream that arrives after
// `createRandomHub()` would silently never reach any peer.
void (async () => {
  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });

  localVideoElm.srcObject = localStream;
  videoGridElm.appendChild(localVideoElm);

  // create ZeroHub client to connect to ZeroHub Web Socket server
  const zh = new ZeroHubClient(["sg1.zerohub.dev"], {
    mediaChannelConfig: {
      // Wire the resolved local stream into the client so its tracks are
      // sent to every peer.
      localStream,
      onTrack: (peer, event) => {
        const peerMediaVideoElem = document.createElement("video");
        peerMediaVideoElem.playsInline = true;
        peerMediaVideoElem.autoplay = true;
        peerMediaVideoElem.srcObject = event.streams[0];
        videoGridElm.appendChild(peerMediaVideoElem);
      },
    },
  });

  // handle onHubInfo to see hub information after connected
  zh.onHubInfo = (hubInfo) => {
    console.log("hubinfo", hubInfo);
    if (hubIdElm) hubIdElm.innerHTML = hubInfo.id;
  };

  // create a random hub id
  zh.createRandomHub();

  // join to the enter hub id
  document.getElementById("join-btn")?.addEventListener("click", () => {
    const hubIdInput = (
      document.getElementById("hub-id-input") as HTMLInputElement
    ).value;
    zh.joinRandomHub(hubIdInput);
  });
})();
