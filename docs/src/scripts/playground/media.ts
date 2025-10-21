import { ZeroHubClient } from "@zero-hub/client";

const hubIdElm = document.getElementById("hub-id");
let videoGridElm = document.getElementById("videos-grid") as HTMLDivElement;
let localVideoElm = document.createElement("video");
localVideoElm.playsInline = true;
localVideoElm.autoplay = true;
let localStream: MediaStream;

navigator.mediaDevices
  .getUserMedia({ audio: true, video: true })
  .then((stream) => {
    localStream = stream;
    if (localVideoElm.srcObject != localStream) {
      localVideoElm.srcObject = localStream;
    }
  });

videoGridElm.appendChild(localVideoElm);

// create ZeroHub client to connect to ZeroHub Web Socket server
const zh = new ZeroHubClient(["sg1.zerohub.dev"], {
  mediaChannelConfig: {
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
