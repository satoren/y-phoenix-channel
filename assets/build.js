import esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const deploy = args.includes("--deploy");

const loader = {
  ".woff": "file",
  ".woff2": "file",
};

const plugins = [sassPlugin()];

// Define esbuild options
let opts = {
  entryPoints: [
    "js/app.js",
    "js/quill.ts",
    "js/blocknote.tsx",
    "js/excalidraw.tsx",
    "js/js-draw.tsx",
    "js/lexical.tsx",
  ],
  bundle: true,
  logLevel: "info",
  target: "es2017",
  outdir: "../priv/static/assets",
  external: ["fonts/*", "images/*"],
  nodePaths: ["../deps"],
  loader: loader,
  plugins: plugins,
};

if (deploy) {
  opts = {
    ...opts,
    minify: true,
  };
}

if (watch) {
  opts = {
    ...opts,
    sourcemap: "inline",
  };
  esbuild
    .context(opts)
    .then((ctx) => {
      ctx.watch();
    })
    .catch((_error) => {
      process.exit(1);
    });
} else {
  esbuild.build(opts);
}
