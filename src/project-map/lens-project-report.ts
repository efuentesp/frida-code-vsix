// M2 (#143) — Mapa del proyecto: mapa técnico vía pi-lens.
//
// Seam declarado para host adapters: dist/clients/lens-engine.js (header del
// propio módulo — "host adapters talk ONLY to this module"), que re-exporta
// projectReport. La entry dist/index.js que usa el moat (piLensEntryPath de
// moat-factories.ts) es la entry de EXTENSIÓN (factory que recibe pi): NO
// sirve para invocar projectReport sin sesión pi — de ahí el path propio.
//
// Import dinámico host-side (lección #57, probado desde M1): import() ESM
// exige URL — pathToFileURL().href SIEMPRE. Sonda existsSync → estado "no
// instalado" sin throw; catch ruidoso (console.warn + estado visible), nunca
// silencio (f3112ec). El caller DEBE atrapar rechazos de la llamada completa:
// el await import("./review-graph/builder.js") interno de projectReport no
// está envuelto upstream.
//
// Contrato verificado contra ~/.frida/npm/node_modules/pi-lens@3.8.72
// (dist/clients/project-report.js:501-567):
// - available:false ×2 con semántica OPUESTA — size-skip permanente (hint
//   "review graph disabled: …", NO re-polear) vs cache fría transitoria (hint
//   "retry this call shortly" → re-poll). El hint es el único discriminador
//   accesible desde el seam: parse lenient /^review graph disabled/i, sin
//   hardcodear strings completos (en 4.1.2 cambiaron de texto).
// - available:true = {trust, hubs, entryPoints, subsystems, riskHotspots,
//   deadWeight}; options.limit clampea TODAS las secciones rankeadas
//   (DEFAULT_LIMIT=10); subsystems.directories viene UNCAPPED.
// - El size-skip puede tardar DOS polls en revelarse (1ª llamada → build
//   kicked off; el build graba el verdict in-memory TTL 15 min → 2ª →
//   disabled): el re-poll del host lo cubre naturalmente.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** trust del payload projectReport (subconjunto que la UI lee). */
export interface PmTrust {
	graphBuiltAt: string;
	filesCovered: number;
	filesTotal: number;
	coverage: number;
	stale: boolean;
	lowCoverage: boolean;
	notes: string[];
}

export interface PmHub {
	file: string;
	fanIn: number;
	blastRadius: number;
	role?: string;
}

export interface PmEntryPoint {
	file: string;
	fanIn: number;
	fanOut: number;
}

export interface PmSubsystems {
	directories: string[];
	edges: { from: string; to: string; count: number }[];
	cycles: { dirs: string[]; edgeCount: number }[];
	violations: {
		from: string;
		to: string;
		count: number;
		dominantCount: number;
	}[];
}

export interface PmRiskHotspot {
	file: string;
	fanIn: number;
	maxComplexity: number;
	score: number;
}

export interface PmTechnicalData {
	trust: PmTrust;
	hubs: PmHub[];
	entryPoints: PmEntryPoint[];
	subsystems: PmSubsystems;
	riskHotspots: PmRiskHotspot[];
	deadWeight: { files: { file: string }[]; disclaimer: string };
}

export type PmTechnicalState =
	| { status: "loading" }
	| { status: "building"; hint: string; attempts: number }
	| {
			status: "empty";
			reason: "not-installed" | "disabled" | "exhausted" | "error";
			hint: string;
	  }
	| { status: "ready"; data: PmTechnicalData; loadedAt: number; limit: number };

/** Payload crudo del seam (mirror del contrato 3.8.72; sin .d.ts upstream). */
interface PmLensRawReport {
	available?: boolean;
	hint?: string;
	trust?: PmTrust;
	hubs?: PmHub[];
	entryPoints?: PmEntryPoint[];
	subsystems?: PmSubsystems;
	riskHotspots?: PmRiskHotspot[];
	deadWeight?: PmTechnicalData["deadWeight"];
}

/** Schedule del re-poll de cache fría (decisión de design: backoff
 *  2s→5s→10s, cap ~10 intentos ≈ 69 s de sleeps worst-case). Constante
 *  CONGELADA por test (length/monotonía) — la UI espeja su largo
 *  (PM_TECH_MAX_ATTEMPTS en TechnicalView). */
export const TECH_POLL_DELAYS_MS: readonly number[] = [
	2000, 2000, 5000, 5000, 5000, 10000, 10000, 10000, 10000, 10000,
];

/** Entry del seam de host adapters bajo <agentDir>/npm (layout espejo del
 *  piLensEntryPath de moat-factories.ts:59-66 — única fuente del layout dist/). */
export function lensEnginePath(agentDir: string): string {
	return path.join(
		agentDir,
		"npm",
		"node_modules",
		"pi-lens",
		"dist",
		"clients",
		"lens-engine.js",
	);
}

/** size-skip permanente — paro de re-poll inmediato. Parse lenient: los hints
 *  cambiaron de texto entre 3.8.72 y 4.1.2; solo el prefijo es estable. */
export function isSizeSkipHint(hint: string): boolean {
	return /^review graph disabled/i.test(hint);
}

function num(v: unknown, fallback = 0): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

/** Carga el mapa técnico. SIEMPRE resuelve (nunca throw): sin instalación →
 *  empty/not-installed; cache fría → building (el host re-polea); size-skip →
 *  empty/disabled; disponible → ready con payload normalizado. */
export async function loadTechnicalMap(
	cwd: string,
	agentDir: string,
	limit: number,
): Promise<PmTechnicalState> {
	const entry = lensEnginePath(agentDir);
	if (!fs.existsSync(entry)) {
		return {
			status: "empty",
			reason: "not-installed",
			hint:
				"pi-lens no está instalado en ~/.frida/npm — el mapa técnico necesita el moat de lens (instálalo y recarga Frida)",
		};
	}
	try {
		// #57: import() ESM exige URL. Export nombrado (re-export del seam).
		const { projectReport } = (await import(pathToFileURL(entry).href)) as {
			projectReport: (
				cwd: string,
				options?: { limit?: number },
			) => Promise<PmLensRawReport>;
		};
		// La llamada completa puede rechazar (imports internos sin envolver).
		const rep = await projectReport(cwd, { limit });
		if (!rep || rep.available !== true) {
			const hint =
				typeof rep?.hint === "string" && rep.hint
					? rep.hint
					: "pi-lens no devolvió reporte";
			return isSizeSkipHint(hint)
				? { status: "empty", reason: "disabled", hint }
				: { status: "building", hint, attempts: 0 };
		}
		return {
			status: "ready",
			data: {
				trust: {
					graphBuiltAt: str(rep.trust?.graphBuiltAt),
					filesCovered: num(rep.trust?.filesCovered),
					filesTotal: num(rep.trust?.filesTotal),
					coverage: num(rep.trust?.coverage),
					stale: !!rep.trust?.stale,
					lowCoverage: !!rep.trust?.lowCoverage,
					notes: Array.isArray(rep.trust?.notes)
						? rep.trust!.notes!.filter((n: unknown) => typeof n === "string")
						: [],
				},
				hubs: Array.isArray(rep.hubs) ? rep.hubs : [],
				entryPoints: Array.isArray(rep.entryPoints) ? rep.entryPoints : [],
				subsystems: rep.subsystems ?? {
					directories: [],
					edges: [],
					cycles: [],
					violations: [],
				},
				riskHotspots: Array.isArray(rep.riskHotspots) ? rep.riskHotspots : [],
				deadWeight: rep.deadWeight ?? { files: [], disclaimer: "" },
			},
			loadedAt: Date.now(),
			limit,
		};
	} catch (e: any) {
		// f3112ec: catch ruidoso — el defecto de la feature no puede ser invisible.
		console.warn("[frida-project-map] pi-lens no pudo cargar:", e?.message ?? e);
		return {
			status: "empty",
			reason: "error",
			hint: "pi-lens no pudo generar el mapa técnico: " + String(e?.message ?? e),
		};
	}
}
