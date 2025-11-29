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
     "js/quill/quill.ts",
     "js/blocknote/blocknote.tsx",
     "js/excalidraw/excalidraw.tsx",
     "js/js-draw/js-draw.tsx",
     "js/lexical/lexical.tsx",
     "js/tiptap/tiptap.tsx",
     "js/prosemirror/prosemirror.tsx",
  ],
  bundle: true,
  logLevel: "info",
  target: "es2017",
  outdir: "../priv/static/assets",
  external: ["fonts/*", "images/*"],
  conditions: ["production", "style"],
  nodePaths: ["../deps"],
  loader: loader,
  plugins: plugins,
  format: "esm",
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
