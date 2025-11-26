/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
    fontFamily: {
      sans: ["ui-sans-serif", "system-ui"],
      serif: ["ui-serif", "Georgia"],
      mono: ["ui-monospace", "SFMono-Regular"],
      display: ["Montserrat", "sans-serif"],
      body: ['"Open Sans"'],
    },
  },
  darkMode: ["class", '[data-theme="dark"]'],
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
