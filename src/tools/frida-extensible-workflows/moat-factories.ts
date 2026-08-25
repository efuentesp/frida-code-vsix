// frida-extensible-workflows — factories del moat para sesiones hijas (M1 #134).
//
// Seam del moat (design D1/D3): un patrón builtin declara en meta.moat qué
// herramientas extra ven sus sesiones hijas (pi-lens read-only y/o
// frida-codebase-index). Este módulo es la capa adaptadora entre las flags
// declarativas JSON-safe del patrón y las factories reales. Vive junto al
// motor (D1 confirmado: módulo nuevo — mantiene frida-agent-execution.ts
// enfocado) y expone:
//   - createFridaLensFactory(agentDir): entry con factory DIFERIDA — el
//     import() de pi-lens corre dentro del loader.reload() (`await
//     factory(api)` del loader espera el import completo). undefined si no
//     hay instalación (lens NO tiene modo guía: presencia ≠ registro).
//     Única fuente de verdad — pi-session la consume también para la sesión
//     principal (D2: dedup del bloque inline).
//   - createMoatFactories(opts): flags → entries.
//   - createWorkflowChildFactoriesWithMoat(opts): base 4
//     (createWorkflowChildFactories) + moat — lo que consumen los call sites
//     del spawner.
//
// Invariantes:
//   - Dirección única de dependencia: este módulo importa de
//     frida-agent-execution (composición base) y de frida-codebase-index
//     (wrapper); nada del motor importa hacia los skill packs. Sin ciclos.
//   - Sin moat, sin flags o sin instalación → la lista base queda intacta:
//     los patrones hermanos (frida-tea, frida-aidd, app-walkthrough) no ven
//     cambio alguno en su catálogo (no-leakage).
//   - codebaseIndexEnabled (toggle frida.codebaseIndex.enabled) se respeta
//     con el mismo patrón getter que las factories de pi-session (D5).
//   - PI_LENS_CONFIG_PATH es process-global seteada antes del reload de la
//     main (pi-session.ts) y el spawner es in-process (ADR-0002): las 4
//     tools de lens en las hijas corren con mutaciones OFF (D16) sin plumbing.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createWorkflowChildFactories } from "./frida-agent-execution";
import type { BuiltinPatternMeta } from "./builtin-patterns";
import type { ProviderAuditDeps } from "../../providers/provider-audit";
import {
	createFridaCodebaseIndex,
	CODEBASE_INDEX_FACTORY_NAME,
} from "../frida-codebase-index";

/** Flags del moat declaradas por un patrón (BuiltinPatternMeta.moat, D3):
 *  qué herramientas extra ven las sesiones hijas. */
export type MoatFlags = NonNullable<BuiltinPatternMeta["moat"]>;

/** Una factory de extensión para sesiones hijas — misma shape que el
 *  opts.extensionFactories de createFridaAgentSpawner. */
export interface ChildFactoryEntry {
	name: string;
	factory: (pi: any) => any;
}

/** Ruta absoluta de la entry de pi-lens bajo <agentDir>/npm — única fuente
 *  de la sonda (Plan Review S1): la consumen createFridaLensFactory (motor)
 *  y detectUnderstandAppCapabilities (pack frida-understand-app). */
export function piLensEntryPath(agentDir: string): string {
	return path.join(
		agentDir,
		"npm",
		"node_modules",
		"pi-lens",
		"dist",
		"index.js",
	);
}

/**
 * Entry "frida-lens" con factory DIFERIDA (D2): la sonda existsSync corre
 * sync; el import() nativo del entry corre dentro del loader.reload(). Si no
 * hay instalación en <agentDir>/npm devuelve undefined y la entry se omite
 * por completo. Misma semántica que el bloque inline original de
 * pi-session.ts: error de carga → warn, sin tumbar la sesión.
 */
export function createFridaLensFactory(
	agentDir: string,
): ChildFactoryEntry | undefined {
	const entry = piLensEntryPath(agentDir);
	if (!fs.existsSync(entry)) return undefined;
	return {
		name: "frida-lens",
		factory: async (pi: any) => {
			try {
				// #57: import() dinámico EXIGE URL en ESM — pathToFileURL
				// normaliza ambas plataformas (patrón frida-codebase-index/shim.ts).
				const mod = (await import(pathToFileURL(entry).href)) as any;
				const lens = mod.default ?? mod;
				return typeof lens === "function" ? lens(pi) : undefined;
			} catch (e: any) {
				console.warn("[frida-lens] No se pudo cargar:", e?.message ?? e);
				return undefined;
			}
		},
	};
}

/** Opts de createMoatFactories. */
export interface MoatFactoriesOptions {
	/** agentDir de Frida (~/.frida): dónde sondear las instalaciones. */
	agentDir: string;
	/** Flags declaradas por el patrón (BuiltinPatternMeta.moat). */
	moat: MoatFlags;
	/** Toggle frida.codebaseIndex.enabled (default true) — evaluado aquí,
	 *  en la composición, para que D5 aplique antes de construir la factory. */
	codebaseIndexEnabled?: () => boolean;
}

/**
 * Resuelve flags del moat → entries de factory (D3): lens sólo si está
 * instalada (sin modo guía); codebase-index SIEMPRE que el flag y el toggle
 * lo permitan — su propia factory registra las 6 tools en modo guía
 * accionable cuando falta el pin (degradación honesta del wrapper).
 */
export function createMoatFactories(
	opts: MoatFactoriesOptions,
): ChildFactoryEntry[] {
	const out: ChildFactoryEntry[] = [];
	if (opts.moat.lens) {
		const lens = createFridaLensFactory(opts.agentDir);
		if (lens) out.push(lens);
	}
	if (opts.moat.codebaseIndex && (opts.codebaseIndexEnabled?.() ?? true)) {
		out.push({
			name: CODEBASE_INDEX_FACTORY_NAME,
			factory: createFridaCodebaseIndex({ agentDir: opts.agentDir }),
		});
	}
	return out;
}

/** Opts de createWorkflowChildFactoriesWithMoat. */
export interface WorkflowChildFactoriesWithMoatOptions {
	/** cwd del workflow (tag del provider-audit base, wf-<basename>). */
	cwd: string;
	/** agentDir de Frida (~/.frida). */
	agentDir: string;
	/** Flags del patrón opt-in. Ausente o sin flags → lista base intacta. */
	moat?: MoatFlags;
	/** Toggle frida.codebaseIndex.enabled (default true, D5). */
	codebaseIndexEnabled?: () => boolean;
	/** Deps del provider-audit base (default: appender forense wf-<basename>). */
	providerAudit?: ProviderAuditDeps;
}

/**
 * Composición para los call sites del spawner (D1): la base 4 de
 * createWorkflowChildFactories + las entries del moat del patrón. Sin moat
 * devuelve la base tal cual (no-leakage a patrones hermanos).
 */
export function createWorkflowChildFactoriesWithMoat(
	opts: WorkflowChildFactoriesWithMoatOptions,
): ChildFactoryEntry[] {
	const base = createWorkflowChildFactories(opts.cwd, opts.providerAudit);
	if (!opts.moat?.lens && !opts.moat?.codebaseIndex) return base;
	return [
		...base,
		...createMoatFactories({
			agentDir: opts.agentDir,
			moat: opts.moat,
			codebaseIndexEnabled: opts.codebaseIndexEnabled,
		}),
	];
}
