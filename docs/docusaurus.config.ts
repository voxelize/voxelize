import type { Config } from "@docusaurus/types";
import { themes } from "prism-react-renderer";

const sharedTypeDocConfig = (name) => ({
  excludePrivate: true,
  excludeProtected: true,
  excludeExternals: true,
  entryDocument: "none",
  disableSources: true,
  sort: [
    // "source-order",
    "alphabetical",
  ],
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

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "voxelize", // Usually your GitHub org/user name.
  projectName: "voxelize", // Usually your repo name.

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: false,
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            "https://github.com/voxelize/voxelize/tree/main/packages/create-docusaurus/templates/shared/",
        },
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
        // id: "api",
        sidebarPath: require.resolve("./sidebars/api.js"),
        path: "docs/api",
        routeBasePath: "api",
        // Please change this to your repo.
        // Remove this to remove the "edit this page" links.
        editUrl:
          "https://github.com/voxelize/voxelize/tree/main/packages/create-docusaurus/templates/shared/",
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
        // ... other options
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
        // ... other options
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
    function webpackPlugin() {
      return {
        name: "docusaurus-webpack-esm",
        configureWebpack() {
          try {
            const corePath = require.resolve("@voxelize/core/dist/index.mjs");
            return {
              resolve: {
                alias: {
                  "@voxelize/core": corePath,
                },
              },
            };
          } catch (e) {
            return {};
          }
        },
      };
    },
  ],
};

export default config;
