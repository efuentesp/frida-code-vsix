// Shim de tipos para pi-mcp-adapter.
//
// pi-mcp-adapter@2.17.0 shipea fuente .ts (su package.json apunta
// types/main/exports a ./index.ts), lo que esquiva `skipLibCheck` (pensado para
// .d.ts) y hace que tsc audite su fuente con 32 errores (import.meta, peer-deps
// faltantes, violaciones de strict). Issue #10.
//
// Este shim redirige la resolución de TIPOS (tsconfig `paths`) a esta
// declaración limpia, basada en la firma real de createMcpAdapter. Así tsc deja
// de leer la fuente del paquete → 0 errores y el typecheck vuelve a ser un gate
// verde/rojo útil. esbuild (build) sigue resolviendo el paquete real de
// node_modules → runtime intacto.
//
// MANTENIMIENTO: al bumpar pi-mcp-adapter, verificar que createMcpAdapter siga
// teniendo esta firma y actualizar este shim si cambió. El drift se detecta con
// `npm run upstream:drift` (ver upstream-pi.json, issue #11).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface McpAdapterOptions {
	config?: unknown;
	configPath?: string;
	[key: string]: unknown;
}

/** Factory del adapter MCP. Sin options usa config file-based (.mcp.json). */
export declare function createMcpAdapter(
	options?: McpAdapterOptions,
): (pi: ExtensionAPI) => void;

/** Instancia por defecto (adapter ya creado con config por defecto). */
declare const mcpAdapter: (pi: ExtensionAPI) => void;
export default mcpAdapter;
