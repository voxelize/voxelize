// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const darkCodeTheme = require("prism-react-renderer/themes/dracula");
const lightCodeTheme = require("prism-react-renderer/themes/github");

const sharedTypeDocConfig = (name) => ({
  excludePrivate: true,
  excludeProtected: true,
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

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Voxelize",
  tagline: "A voxel browser experience",
  url: "https://docs.voxelize.io",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/logo/circle-min.png",
  deploymentBranch: "gh-pages",
  organizationName: "voxelize",
  projectName: "voxelize",
  trailingSlash: false,
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
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
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
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
          { to: "/wiki/handling-events", label: "Wiki", position: "left" },
          {
            to: "/api/client/modules",
            position: "left",
            label: "API",
          },
          { to: "/blog", label: "Blog", position: "left" },
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
                href: "https://discord.gg/6AfEkpjsTS",
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
                label: "Blog",
                to: "/blog",
              },
              {
                label: "GitHub",
                href: "https://github.com/facebook/docusaurus",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Voxelize. All rights reserved.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ["toml", "rust"],
      },
    }),
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
        entryPoints: ["../packages/transport/src/index.ts"],
        id: "@voxelize/transport",
        out: "api/transport",
        tsconfig: "../packages/transport/tsconfig.json",
        ...sharedTypeDocConfig("Transport API"),
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        entryPoints: ["../packages/client/src/index.ts"],
        id: "@voxelize/client",
        out: "api/client",
        tsconfig: "../packages/client/tsconfig.json",
        ...sharedTypeDocConfig("Client API"),
      },
    ],

    async function myPlugin(context, options) {
      return {
        name: "docusaurus-tailwindcss",
        configurePostCss(postcssOptions) {
          // Appends TailwindCSS and AutoPrefixer.
          postcssOptions.plugins.push(require("tailwindcss"));
          postcssOptions.plugins.push(require("autoprefixer"));
          return postcssOptions;
        },
      };
    },
  ],
};

module.exports = config;
