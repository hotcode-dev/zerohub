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
        "https://cdn.jsdelivr.net/npm/@zero-hub/client@0.0.17/dist/bundle/bundle.js",
      ],
      processors: ["tailwindcss"],
      style: {
        language: "css",
        content: playgroundStyle,
      },
    },
    view: "split",
  });

  playground.watch("code", (code) => {
    console.log("Code changed:", code);
  });

  createChatPlayground();

  const templateSelect = document.getElementById(
    "template-select"
  ) as HTMLSelectElement;

  templateSelect.addEventListener("change", (event: Event) => {
    console.log("Template changed:", (event.target as HTMLSelectElement).value);
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
    console.log("Creating chat playground");
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
    console.log("Creating media playground");
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
