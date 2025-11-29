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
      { in: "js/app.js", out: "app.js" },
      { in: "js/quill/quill.ts", out: "quill" },
      { in: "js/blocknote/blocknote.tsx", out: "blocknote" },
      { in: "js/excalidraw/excalidraw.tsx", out: "excalidraw" },
      { in: "js/js-draw/js-draw.tsx", out: "js-draw" },
      { in: "js/lexical/lexical.tsx", out: "lexical" },
      { in: "js/tiptap/tiptap.tsx", out: "tiptap" },
      { in: "js/prosemirror/prosemirror.tsx", out: "prosemirror" },
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
  entryNames: "[name]",
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
