// Compiled by `npm run build:css` into assets/css/site.css. Previously this
// config ran in the browser via cdn.tailwindcss.com, which is unreachable from
// some networks (e.g. mainland China) and left pages completely unstyled.
module.exports = {
  content: [
    "./templates/**/*.html",
    "./content/**/*.html",
    "./scripts/build.js",
  ],
  theme: {
    extend: {
      colors: {
        "surface": "#ffffff",
        "on-surface": "#000000",
        "surface-variant": "#f9fafb",
        "outline-variant": "#e5e7eb",
      },
      fontFamily: {
        "headline": ["Fraunces", "serif"],
        "body": ["Inter", "sans-serif"],
      },
      borderRadius: {"DEFAULT": "0px", "sm": "0px", "md": "0px", "lg": "0px", "xl": "0px", "2xl": "0px", "3xl": "0px", "full": "0px"},
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries"),
  ],
};
