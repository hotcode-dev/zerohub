import { createPlayground } from "livecodes";
import chatMarkup from "./chat.html?raw";
import chatScript from "./chat.ts?raw";
import mediaMarkup from "./media.html?raw";
import mediaScript from "./media.ts?raw";
import { playgroundStyle } from "./styles";

export async function initializePlayground() {
  const playground = await createPlayground("#playground", {
    headless: false,
    config: {
      title: "Playground",
      description: "Try ZeroHub online via code playground.",
      activeEditor: "script",
      scripts: [
        "https://cdn.jsdelivr.net/npm/@zero-hub/client@0.0.20/dist/bundle/bundle.js",
      ],
      processors: ["tailwindcss"],
      style: {
        language: "css",
        content: playgroundStyle,
      },
    },
    view: "split",
  });

  createChatPlayground();

  const templateSelect = document.getElementById(
    "template-select"
  ) as HTMLSelectElement;

  templateSelect.addEventListener("change", (event: Event) => {
    const selectedTemplate = (event.target as HTMLSelectElement)?.value;
    if (selectedTemplate === "chat") {
      // Recreate the playground with the chat template
      createChatPlayground();
    } else if (selectedTemplate === "media") {
      // Recreate the playground with the media template
      createMediaPlayground();
    }
  });

  function createChatPlayground() {
    playground.setConfig({
      markup: {
        language: "html",
        content: chatMarkup,
      },
      script: {
        language: "typescript",
        content: chatScript,
      },
    });
  }

  function createMediaPlayground() {
    playground.setConfig({
      markup: {
        language: "html",
        content: mediaMarkup,
      },
      script: {
        language: "typescript",
        content: mediaScript,
      },
    });
  }
}
