import path from "node:path";
import { defineConfig } from "vitest/config";

// Configuración de tests para Frida. Los módulos bajo test (src/gates/*.ts de
// detección + logger) son puros o solo usan `node:*` builtins: no importan vscode
// ni el SDK de Pi, así que corren tal cual en el entorno node de vitest.
export default defineConfig({
	resolve: {
		// #97: `@earendil-works/pi-ai` es dependencia TRANSITORIA (vive bajo
		// pi-coding-agent/node_modules) y NO resuelve desde el top-level. Los
		// módulos porteados de frida-antigravity la importan en runtime (stream.ts:
		// createAssistantMessageEventStream). Mismo mecanismo que el nodePaths de
		// esbuild.js y el `paths` de tsconfig.json — aquí va como alias de vite.
		alias: {
			"@earendil-works/pi-ai": path.resolve(
				__dirname,
				"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js",
			),
		},
	},
	test: {
		// Entorno node (los detectores usan node:fs, node:os, node:path).
		environment: "node",
		// Tests en test/ (separados de src/ para no contaminar el bundle del host,
		// cuyo esbuild empaqueta desde src/extension.ts).
		include: ["test/**/*.test.ts"],
		// Sin globals: importamos { describe, it, expect } de "vitest" explícito,
		// para no tocar el tsconfig principal con "vitest/globals".
		globals: false,
	},
});
