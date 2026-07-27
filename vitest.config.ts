import { defineConfig } from "vitest/config";

// Configuración de tests para Frida. Los módulos bajo test (src/gates/*.ts de
// detección + logger) son puros o solo usan `node:*` builtins: no importan vscode
// ni el SDK de Pi, así que corren tal cual en el entorno node de vitest.
export default defineConfig({
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
