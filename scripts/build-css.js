// Compiles assets/css/tailwind.input.css into assets/css/site.css with
// Tailwind CSS v4. Uses the PostCSS plugin directly rather than
// @tailwindcss/cli, whose file watcher pulls in micromatch/braces (which have
// open advisories with no fixed release). Run with `npm run build:css`.
const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const tailwindcss = require("@tailwindcss/postcss");

const ROOT = path.join(__dirname, "..");
const input = path.join(ROOT, "assets/css/tailwind.input.css");
const output = path.join(ROOT, "assets/css/site.css");

postcss([tailwindcss({ base: ROOT, optimize: { minify: true } })])
  .process(fs.readFileSync(input, "utf8"), { from: input, to: output })
  .then((result) => {
    fs.writeFileSync(output, result.css);
    console.log(`Wrote ${path.relative(ROOT, output)} (${result.css.length} bytes)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
