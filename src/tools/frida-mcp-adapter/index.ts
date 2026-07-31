// frida-mcp-adapter — wrapper de Frida sobre pi-mcp-adapter.
//
// ADR-0023 / D1-D7. Pi-mcp-adapter (v2.17.0) es la extensión nativa de Pi que
// conecta servidores MCP al agente sin quemar contexto: un único tool proxy
// mcp({}) (~200 tokens) en lugar de cientos de definiciones.
//
// Este wrapper NO reimplementa los 17K líneas del upstream. Importa
// createMcpAdapter del paquete instalado como devDependency y lo adapta al
// entorno de Frida:
//
//   1. Setea PI_CODING_AGENT_DIR = ~/.frida/ antes de inicializar el adapter.
//      Esto redirige metadata cache, OAuth legacy y override global a Frida.
//   2. Registra el adapter como una extensión más en pi-session.ts.
//
// Los paths MCP estándar (.mcp.json, ~/.config/mcp/mcp.json) no cambian —
// son formato compartido entre herramientas (Claude, Cursor, Windsurf, etc.).

import { createMcpAdapter } from "pi-mcp-adapter";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Directorio agent de Frida (~/.frida).
 *
 * Seteado como PI_CODING_AGENT_DIR para que pi-mcp-adapter guarde:
 *   - Metadata cache: ~/.frida/mcp-cache.json
 *   - OAuth legacy:    ~/.frida/mcp-oauth/
 *   - Override global: ~/.frida/mcp.json
 */
const FRIDA_AGENT_DIR = path.join(os.homedir(), ".frida");

/**
 * Factory de la extensión frida-mcp-adapter para el loader de Pi.
 *
 * Sigue el mismo patrón que createFridaPipeline() y createFridaSubagents():
 * devuelve una función que Pi invoca con la instancia de ExtensionAPI.
 *
 * El adapter registra automáticamente:
 *   - Tool proxy `mcp({})` con 10 modos (search/describe/call/connect/...)
 *   - Slash commands `/mcp` y `/mcp-auth`
 *   - Direct tools (si se configuran en .mcp.json)
 *   - MCP prompts como slash commands
 *   - Hooks de session_start/session_shutdown
 */
export function createFridaMcpAdapter() {
	return (pi: ExtensionAPI): void => {
		// D4: redirigir paths internos del adapter a ~/.frida/.
		// Si PI_CODING_AGENT_DIR ya está seteado (ej. por el usuario o tests),
		// respetarlo.
		if (!process.env.PI_CODING_AGENT_DIR) {
			process.env.PI_CODING_AGENT_DIR = FRIDA_AGENT_DIR;
		}

		// Crear y aplicar el adapter del upstream.
		// Sin options: usa file-based config (.mcp.json + estándar MCP).
		const adapter = createMcpAdapter();
		adapter(pi);
	};
}
