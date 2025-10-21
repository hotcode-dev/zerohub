import { ZeroHubClient } from "@zero-hub/client";

const hubIdElm = document.getElementById("hub-id");
const chatElm = document.getElementById("chat");
let dataChannels: RTCDataChannel[] = [];

// create ZeroHub client to connect to ZeroHub Web Socket server
const zh = new ZeroHubClient(["sg1.zerohub.dev"], {
  dataChannelConfig: {
    onDataChannel: (peer, dataChannel, isOwner) => {
      // handle all data channel to receive the message from peers
      dataChannel.onmessage = (ev: MessageEvent) => {
        addChat(`Peer ${peer.id}: ${ev.data}`);
      };
      dataChannels.push(dataChannel);
    },
  },
});

// handle onHubInfo to see hub information after connected
zh.onHubInfo = (hubInfo) => {
  console.log("hubinfo", hubInfo);
  if (hubIdElm) hubIdElm.innerHTML = hubInfo.id;
};

// add chat to the textbox
function addChat(msg: string) {
  const msgBox = document.createElement("div");
  msgBox.innerText = msg;
  chatElm?.append(msgBox);
}

// handle send button
document.getElementById("send-btn")?.addEventListener("click", () => {
  const msgElem = document.getElementById("chat-input") as HTMLInputElement;
  addChat(`You: ${msgElem.value}`);
  dataChannels.forEach((dc) => {
    dc.send(msgElem.value);
  });
});

// create a random hub id
zh.createRandomHub();

// join to the enter hub id
document.getElementById("join-btn")?.addEventListener("click", () => {
  const hubIdInput = (
    document.getElementById("hub-id-input") as HTMLInputElement
  ).value;
  zh.joinRandomHub(hubIdInput);
});
