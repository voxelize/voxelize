import type { Config } from "@docusaurus/types";
import { themes } from "prism-react-renderer";

const sharedTypeDocConfig = (name: string) => ({
  excludePrivate: true,
  excludeProtected: true,
  excludeExternals: true,
  entryDocument: "none",
  disableSources: true,
  sort: ["alphabetical"],
  categorizeByGroup: true,
  sidebar: {
    fullNames: false,
    categoryLabel: name,
    indexLabel: undefined,
    readmeLabel: "Readme",
    position: null,
    autoConfiguration: true,
  },
  plugin: ["typedoc-plugin-no-inherit"],
  watch: process.env.TYPEDOC_WATCH,
  preserveWatchOutput: true,
});

const config: Config = {
  title: "Voxelize",
  tagline: "A voxel browser experience",
  url: "https://docs.voxelize.io",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/logo/circle-min.png",
  deploymentBranch: "gh-pages",
  trailingSlash: undefined,
  markdown: {
    mermaid: true,
  },
  themes: ["@docusaurus/theme-mermaid"],

  organizationName: "voxelize",
  projectName: "voxelize",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: false,
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: "VOXELIZE",
      hideOnScroll: true,
      logo: {
        alt: "Voxelize Logo",
        src: "img/logo/circle-min.png",
      },
      items: [
        {
          to: "/tutorials/intro/what-is-voxelize",
          position: "left",
          label: "Tutorial",
        },
        { to: "/wiki/blocks/block-registry", label: "Wiki", position: "left" },
        {
          to: "/api/client/modules",
          position: "left",
          label: "API",
        },
        {
          href: "https://github.com/voxelize/voxelize",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Tutorial",
              to: "/tutorials/intro/what-is-voxelize",
            },
            {
              label: "Client API",
              to: "/api/client/modules",
            },
            {
              label: "Server API",
              to: "https://docs.rs/voxelize/0.4.2/voxelize/",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "Stack Overflow",
              href: "https://stackoverflow.com/questions/tagged/voxelize",
            },
            {
              label: "Discord",
              href: "https://discord.gg/wQyZAuxpJT",
            },
            {
              label: "Twitter",
              href: "https://twitter.com/voxelizee",
            },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/voxelize/voxelize",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Voxelize. All rights reserved.`,
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ["toml", "rust"],
    },
  },
  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      {
        sidebarPath: require.resolve("./sidebars/api.js"),
        path: "docs/api",
        routeBasePath: "api",
      },
    ],
    [
      "@docusaurus/plugin-content-docs",
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      {
        id: "tutorials",
        path: "docs/tutorials",
        routeBasePath: "tutorials",
        sidebarPath: require.resolve("./sidebars/tutorials.js"),
      },
    ],
    [
      "@docusaurus/plugin-content-docs",
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      {
        id: "wiki",
        path: "docs/wiki",
        routeBasePath: "wiki",
        sidebarPath: require.resolve("./sidebars/wiki.js"),
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        entryPoints: ["../packages/protocol/src/index.ts"],
        id: "@voxelize/protocol",
        out: "api/protocol",
        tsconfig: "../packages/protocol/tsconfig.json",
        ...sharedTypeDocConfig("Protocol API"),
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        entryPoints: ["../packages/core/src/index.ts"],
        id: "@voxelize/core",
        out: "api/client",
        tsconfig: "../packages/core/tsconfig.json",
        ...sharedTypeDocConfig("Client API"),
      },
    ],
    async function myPlugin() {
      return {
        name: "docusaurus-tailwindcss",
        configurePostCss(postcssOptions) {
          postcssOptions.plugins.push(require("tailwindcss"));
          postcssOptions.plugins.push(require("autoprefixer"));
          return postcssOptions;
        },
      };
    },
  ],
};

export default config;
