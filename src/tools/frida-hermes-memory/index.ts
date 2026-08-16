/**
 * frida-hermes-memory — factory del wrapper (issue #21, ADR-0032).
 *
 * Corre la factory del upstream pi-hermes-memory (MIT) contra el ExtensionAPI
 * REAL de la sesión — passthrough completo: tools (memory_write/read/search,
 * scratchpad, session_search), hooks del lifecycle (before_agent_start =
 * inyección de contexto, turn_end = contadores del background learning,
 * session_shutdown = flush + index) y comandos /memory-*. A diferencia de
 * frida-codebase-index NO capturamos ni re-registramos: el learning loop
 * necesita los eventos del lifecycle de la sesión principal (ADR-0032 D1).
 *
 * Flujo de la factory (async — el loader del SDK awaita su retorno):
 *  1. PI_CODING_AGENT_DIR=~/.frida si no está seteado — ANTES del import,
 *     porque el módulo del upstream calcula AGENT_ROOT al cargarse (paths.ts)
 *     y de ahí cuelgan MEMORY.md, USER.md, skills y SQLite (patrón
 *     frida-mcp-adapter).
 *  2. Si el paquete no está instalado al pin: registra una tool guía
 *     (frida.memory / memory_search responden con los pasos) y dispara la
 *     instalación en BACKGROUND (fire-and-forget, sin bloquear el arranque de
 *     la sesión; el estado se reporta vía onStateChange para notificar y
 *     sugerir /reload).
 *  3. Si está instalado: carga el entry TS vía jiti con aliases a los
 *     peer-deps (pi-ai, pi-ai/compat, pi-coding-agent → copia nested del SDK
 *     que frida shipea) y await factory(pi).
 *
 * El gate (frida.hermesMemory.enabled, default true) lo aplica el caller en
 * pi-session.ts (mismo patrón que codebaseIndexEnabled): la factory nunca se
 * registra si está deshabilitado — el background learning consume tokens del
 * modelo y debe poder apagarse.
 */
import * as path from "node:path";
import { createJiti } from "jiti";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	HERMES_MEMORY_FACTORY_NAME,
	HERMES_MEMORY_PIN,
	HERMES_MEMORY_SPEC,
	upstreamEntryPath,
	upstreamPeerAliases,
} from "./constants";
import { ensureInstalled, isInstalledAtPin } from "./installer";

export interface CreateHermesMemoryOpts {
	/** Agent dir de Frida (~/.frida). */
	agentDir: string;
	/** Dir del bundle de frida (dist/) — base para resolver los peer-deps. */
	distDir: string;
	/** Log de diagnóstico (PoC/Debug). */
	onLog?: (line: string) => void;
	/** Inyectable para tests (instalación on-demand). */
	deps?: {
		ensureInstalled?: typeof ensureInstalled;
	};
}

/** Estado del wrapper para el host (notificaciones/notificación /reload). */
export interface HermesMemoryState {
	installed: boolean;
	version?: string;
	/** Instalación background en curso (paquete ausente al arrancar). */
	installing?: boolean;
	/** Error de instalación o carga, si ocurrió. */
	error?: string;
}

function unwrapDefault(mod: unknown): unknown {
	if (mod && typeof mod === "object" && "default" in mod) {
		const d = (mod as { default: unknown }).default;
		if (typeof d === "function") return d;
	}
	return mod;
}

/** Shape del resultado de guía (AgentToolResult: content + details + isError). */
type GuideToolResult = {
	content: { type: "text"; text: string }[];
	details: { failureCategory: string };
	isError: boolean;
};

/** Tool guía cuando el paquete upstream no está disponible. */
function guideMemoryTool(guideText: string) {
	return {
		name: "memory",
		label: "memory",
		description:
			"Memoria persistente cross-session del agente (frida-hermes-memory). Si el paquete upstream no está instalado, responde con la guía de instalación.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true,
		},
		async execute(): Promise<GuideToolResult> {
			return {
				content: [{ type: "text", text: guideText }],
				details: { failureCategory: "hermes-memory-guide" },
				isError: true,
			};
		},
	};
}

/**
 * Factory embebida para extensionFactories (src/pi-session.ts). DEVUELVE la
 * promesa de carga: el loader hace await factory(api) y así espera el jiti
 * import completo antes de dar la sesión por lista (patrón
 * frida-codebase-index, loader.js:389) — sin race de registro.
 */
export function createFridaHermesMemory(
	opts: CreateHermesMemoryOpts & {
		onStateChange?: (s: HermesMemoryState) => void;
	},
) {
	const { agentDir, distDir, onLog, onStateChange } = opts;
	const doEnsureInstalled = opts.deps?.ensureInstalled ?? ensureInstalled;
	return async (pi: ExtensionAPI): Promise<void> => {
		// D4 (ADR-0032): storage del upstream bajo ~/.frida, no ~/.pi/agent.
		// Debe setearse ANTES del jiti import (AGENT_ROOT es const de módulo).
		if (!process.env.PI_CODING_AGENT_DIR) {
			process.env.PI_CODING_AGENT_DIR = path.resolve(agentDir);
			onLog?.(
				`[hermes-memory] PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR}`,
			);
		}

		if (!isInstalledAtPin(agentDir)) {
			// Modo guía + auto-instalación background (D6: guía accionable,
			// cero bloqueo del arranque).
			const guide = [
				`frida-hermes-memory: el paquete upstream (${HERMES_MEMORY_SPEC}) no está instalado.`,
				"",
				"La instalación se disparó en background; cuando termine, ejecuta /reload o reinicia la sesión.",
				"Si prefieres instalarlo manualmente:",
				`  ${`npm install ${HERMES_MEMORY_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`}`,
			].join("\n");
			try {
				pi.registerTool(guideMemoryTool(guide));
			} catch (e: any) {
				onLog?.(`[hermes-memory] registerTool guía falló: ${e?.message ?? e}`);
			}
			onStateChange?.({ installed: false, installing: true });
			// Fire-and-forget: nunca bloquea ni tumba la sesión.
			void doEnsureInstalled(agentDir, {
				onProgress: (line) => onLog?.(`[hermes-memory] ${line}`),
			})
				.then(() => {
					onStateChange?.({ installed: true, version: HERMES_MEMORY_PIN });
					onLog?.(
						`[hermes-memory] ${HERMES_MEMORY_SPEC} instalado — /reload para activar el learning loop.`,
					);
				})
				.catch((e: any) => {
					const msg = e?.message ?? String(e);
					onStateChange?.({ installed: false, error: msg });
					onLog?.(`[hermes-memory] instalación falló: ${msg}`);
					onLog?.(e?.guide ? `[hermes-memory] guía: ${e.guide}` : "");
				});
			return;
		}

		// Paquete presente al pin: cargar y correr la factory upstream.
		const entry = upstreamEntryPath(agentDir);
		try {
			const jiti = createJiti(entry, {
				alias: upstreamPeerAliases(distDir),
			});
			const factory = unwrapDefault(jiti(entry));
			if (typeof factory !== "function") {
				throw new Error(
					`el entry no exporta una factory (default): ${typeof factory}`,
				);
			}
			await (factory as (api: ExtensionAPI) => unknown)(pi);
			onStateChange?.({ installed: true, version: HERMES_MEMORY_PIN });
		} catch (e: any) {
			// Degradación con guía (D6): la sesión vive sin memoria, la tool
			// explica qué pasó y cómo repararlo.
			const msg = e?.message ?? String(e);
			onStateChange?.({ installed: false, error: msg });
			onLog?.(`[hermes-memory] carga del upstream falló: ${msg}`);
			try {
				pi.registerTool(
					guideMemoryTool(
						[
							`frida-hermes-memory: no se pudo cargar ${HERMES_MEMORY_SPEC}: ${msg}`,
							"",
							"Repara reinstalando:",
							`  rm -rf "${path.join(agentDir, "npm", "node_modules", "pi-hermes-memory")}"`,
							`  ${`npm install ${HERMES_MEMORY_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`}`,
							"y ejecuta /reload o reinicia la sesión.",
						].join("\n"),
					),
				);
			} catch {
				/* registerTool best-effort */
			}
		}
	};
}

export { HERMES_MEMORY_FACTORY_NAME };
