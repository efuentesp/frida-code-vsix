// Empaqueta la extensión a CJS para el extension host de VS Code.
// El SDK de Pi es ESM; esbuild lo resuelve en el bundle.
const esbuild = require("esbuild");

// Nativos de Pi que NO se bundleean (se shipean como archivos en el .vsix).
// Ver ADR-0002 / D5: tarea de empaquetado del MVP.
const external = [
  "vscode", // provisto por el extension host en runtime
  "@silvia-odwyer/photon-node",
  "@mariozechner/clipboard-*", // comodín: cubre todas las plataformas (.node)
];

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  external,
  // Pi (ESM) usa import.meta.url; en CJS esbuild lo deja como {}. Lo shimamos
  // desde __filename del bundle.
  banner: {
    js: `var __import_meta_url = require("url").pathToFileURL(__filename).href;`,
  },
  define: {
    "import.meta.url": "__import_meta_url",
  },
  logLevel: "info",
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
})();
