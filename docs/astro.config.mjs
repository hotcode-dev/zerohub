// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "ZeroHub Docs",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/hotcode-dev/zerohub",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Get Started", slug: "guides/get-started" },
            {
              label: "TypeScript SDK",
              slug: "guides/typescript-sdk",
            },
            { label: "Example Used", slug: "guides/example" },
            {
              label: "Playground",
              badge: {
                text: "Live",
                variant: "success",
              },
              link: "/playground",
            },
          ],
        },
        {
          label: "API Reference",
          autogenerate: { directory: "api-reference" },
        },
      ],
      customCss: ["./src/styles/tailwind.css"],
      components: {
        Header: "./src/components/overrides/Header.astro",
      },
      plugins: [],
    }),
  ],
});
