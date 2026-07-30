// Empaqueta la extensión a CJS para el extension host de VS Code.
// El SDK de Pi es ESM; esbuild lo resuelve en el bundle.
const esbuild = require("esbuild");
const nodePath = require("path");

// Nativos de Pi que NO se bundleean (se shipean como archivos en el .vsix).
// Ver ADR-0002 / D5: tarea de empaquetado del MVP.
const external = [
	"vscode", // provisto por el extension host en runtime
	"@silvia-odwyer/photon-node",
	"@mariozechner/clipboard-*", // comodín: cubre todas las plataformas (.node)
];

// pi-ai es dependencia TRANSITORIA (vive bajo pi-coding-agent) y NO resuelve
// desde el top-level. Sin esto, el import estático de `@earendil-works/pi-ai/bun-oauth`
// (registro de flujos OAuth bundled — fix al ERR_MODULE_NOT_FOUND de Copilot login)
// no se bundlea. Añadimos el node_modules anidado de pi-coding-agent a `nodePaths`
// para que esbuild resuelva @earendil-works/pi-ai/* (con su exports map) sin tocar
// package.json/lockfile. Sólo si pi-ai no resuelve sola (ej. hoisteada al top-level).
const fsSync = require("fs");
const piNestedNodeModules = nodePath.resolve(
	"node_modules/@earendil-works/pi-coding-agent/node_modules",
);
const piNodePaths =
	!fsSync.existsSync(nodePath.resolve("node_modules/@earendil-works/pi-ai")) &&
	fsSync.existsSync(piNestedNodeModules)
		? [piNestedNodeModules]
		: undefined;

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
	...(piNodePaths ? { nodePaths: piNodePaths } : {}),
	// Pi (ESM) usa import.meta.url e import.meta.resolve; en CJS esbuild los deja
	// como {}. Los shimamos desde __filename del bundle.
	banner: {
		js: `
var __import_meta_url = require("url").pathToFileURL(__filename).href;
var __import_meta_resolve = function(specifier, parent) {
  try { return require("url").pathToFileURL(require.resolve(specifier)).href; }
  catch { return specifier; }
};
`,
	},
	define: {
		"import.meta.url": "__import_meta_url",
		"import.meta.resolve": "__import_meta_resolve",
	},
	logLevel: "info",
};

// ADR-0020 Fase 4 — bundle DSL standalone para que los configs .ts importen el
// DSL desde "frida-workflow" (jiti alias). CJS: jiti carga un bundle CJS vía alias
// sin transformar (el ESM bundleado truena con "Cannot find module '.'"). typebox
// se bundlea DENTRO (self-contained). En runtime: createJiti(configFile, {
// alias: { "frida-workflow": <ext>/dist/frida-workflow.js }, interopDefault: true }).
/** @type {import('esbuild').BuildOptions} */
const dslOptions = {
	entryPoints: ["src/tools/frida-workflow/index.ts"],
	bundle: true,
	outfile: "dist/frida-workflow.js",
	platform: "node",
	format: "cjs",
	target: "node18",
	sourcemap: true,
	external: [], // typebox DENTRO (self-contained para el alias en runtime)
	logLevel: "info",
};

(async () => {
	if (watch) {
		const ctx = await esbuild.context(options);
		const dslCtx = await esbuild.context(dslOptions);
		await Promise.all([ctx.watch(), dslCtx.watch()]);
	} else {
		await Promise.all([esbuild.build(options), esbuild.build(dslOptions)]);
	}
})();
