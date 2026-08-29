// M2 (#143) — Mapa del proyecto: cruce técnico↔funcional vía matriz M9.
//
// Fuente: docs/api/artifacts/inventory.json (M9 — traffic2api). El agente
// correlacionador produce inv.matrix (writer src/tools/frida-traffic2api/
// workflow.ts:1266-1276, schema MATRIX_SCHEMA :605): {id:"M01".. por orden,
// functionality, screenIds[], endpoints[{id,method,path}],
// modules[{path,evidence}], evidence}. Los screenIds son los Pnn de M8
// (mismo generador cuando inv.siblings.funcional); los modules[].path son
// rutas cwd-relativas free-form del LLM → normalización defensiva (strip
// ./, backslashes→/, absolutos accidentales bajo el cwd relativizados).
//
// Joins (research, fijado en checkpoint de discover):
// - funcional: matrix[].screenIds ∩ Set(screens M8) — citados sin pantalla
//   registrada (matriz stale vs corrida M8 nueva) → danglingScreens.
// - técnico: dirname(modules[].path) ↔ subsystems.directories por PREFIJO
//   EXACTO DE SEGMENTOS COMPLETOS ("src/server.js" → "src"; "srca/x" NO
//   matchea "src" — fuzzy por basename produce falsos cruces). Un módulo
//   cuenta en TODOS los dirs ancestro presentes (consistente con el overlay
//   de riesgo de TechnicalView); archivo en raíz → "(root)"; path SIN
//   extensión (directorio citado tal cual) → el propio path. Sin Técnica
//   cargada (dirs=[]) el join técnico queda vacío y unmatchedModules []
//   (no hay "fuera de" sin referencia) — el cruce por pantalla funciona igual.
//
// Degradación digna (FR-7 / R7 de M9): sin docs/api → omitted/missing con
// workaround textual; JSON ilegible o sin matrix[] → omitted/corrupt.
// SIEMPRE resuelve (nunca throw) — molde loadFunctionalMap.

import fs from "node:fs";
import path from "node:path";

/** Entrada normalizada de la matriz M9 para la UI. */
export interface PmCrossEntry {
	id: string;
	functionality: string;
	/** screenIds citados por la fila (sin filtrar — el join vive en byScreen). */
	screenIds: string[];
	/** módulos cwd-relativos normalizados y deduplicados. */
	modules: string[];
	endpointCount: number;
}

export interface PmCrossData {
	entries: PmCrossEntry[];
	/** screenId M8 → módulos que lo implementan (dedup por módulo). */
	byScreen: Record<string, { entryId: string; module: string }[]>;
	/** directorio subsystem → screenIds cubiertos por módulos bajo él. */
	byDirectory: Record<string, string[]>;
	/** screenIds citados por la matriz sin pantalla registrada en M8. */
	danglingScreens: string[];
	/** módulos fuera de todo subsystem conocido ([] si Técnica no cargó). */
	unmatchedModules: string[];
}

export type PmCrossState =
	| { status: "omitted"; reason: "missing" | "corrupt"; hint: string }
	| { status: "ready"; data: PmCrossData; loadedAt: number };

/** Texto del workaround (molde MISSING_WORKAROUND de functional-inventory). */
export const CROSS_MISSING_HINT =
	"Sin matriz M9 — corre el patrón traffic2api (M9) para generar docs/api/ y enlazar pantallas↔módulos";

const INVENTORY_REL = path.join("docs", "api", "artifacts", "inventory.json");

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string")
		: [];
}

/** Normaliza un modules[].path free-form del LLM a cwd-relativa POSIX.
 *  "" = irrecuperable (vacío, o absoluto fuera del cwd). */
export function normalizeModulePath(cwd: string, raw: string): string {
	let p = String(raw ?? "")
		.trim()
		.replace(/\\/g, "/");
	if (!p) return "";
	while (p.startsWith("./")) p = p.slice(2);
	if (path.isAbsolute(p)) {
		const rel = path.relative(path.resolve(cwd), p);
		return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
			? rel.split(path.sep).join("/")
			: "";
	}
	return p.replace(/^\/+/, "");
}

/** Directorio del módulo para el join técnico: dirname; archivo en raíz →
 *  "" (cluster "(root)"); path SIN extensión (directorio citado tal cual,
 *  p.ej. "src") → el propio path. */
function moduleDirOf(p: string): string {
	const d = path.posix.dirname(p);
	if (d !== ".") return d;
	return path.posix.extname(p) ? "" : p;
}

/** Prefijo exacto de segmentos completos: "src/a.ts" ∈ "src"; "srca/b" ∉. */
function dirCovers(dir: string, moduleDir: string): boolean {
	if (dir === "(root)") return moduleDir === "";
	return moduleDir === dir || moduleDir.startsWith(dir + "/");
}

/** Carga la matriz M9 y calcula ambos joins. SIEMPRE resuelve (nunca throw):
 *  sin docs/api → omitted/missing; ilegible/sin matrix → omitted/corrupt. */
export function loadCrossMap(
	cwd: string,
	knownScreenIds: string[],
	subsystemDirs: string[],
): PmCrossState {
	const invPath = path.join(cwd, INVENTORY_REL);
	if (!fs.existsSync(invPath)) {
		return { status: "omitted", reason: "missing", hint: CROSS_MISSING_HINT };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(invPath, "utf8"));
	} catch {
		return {
			status: "omitted",
			reason: "corrupt",
			hint:
				"inventory.json de M9 ilegible — regenera docs/api/ con el patrón traffic2api (M9)",
		};
	}
	const matrix = (raw as { matrix?: unknown }).matrix;
	if (!Array.isArray(matrix)) {
		return {
			status: "omitted",
			reason: "corrupt",
			hint:
				"inventory.json de M9 sin matriz (matrix[]) — regenera docs/api/ con el patrón traffic2api (M9)",
		};
	}

	const known = new Set(knownScreenIds);
	const dirs = [...new Set(subsystemDirs)];

	const entries: PmCrossEntry[] = matrix.map((r, i) => {
		const rec = (r ?? {}) as Record<string, unknown>;
		const mods = (Array.isArray(rec.modules) ? rec.modules : [])
			.map((m) =>
				normalizeModulePath(cwd, asString((m as Record<string, unknown>)?.path)),
			)
			.filter((p) => p !== "");
		const modules: string[] = [];
		for (const p of mods) if (!modules.includes(p)) modules.push(p);
		const screenIds = asStringArray(rec.screenIds).filter(
			(s, ix, arr) => arr.indexOf(s) === ix,
		);
		return {
			id: asString(rec.id) || `M${String(i + 1).padStart(2, "0")}`,
			functionality: asString(rec.functionality),
			screenIds,
			modules,
			endpointCount: Array.isArray(rec.endpoints) ? rec.endpoints.length : 0,
		};
	});

	const byScreen: PmCrossData["byScreen"] = {};
	const byDir = new Map<string, Set<string>>();
	const dangling = new Set<string>();
	const unmatched = new Set<string>();

	for (const e of entries) {
		// Join funcional: solo pantallas registradas en M8; el resto → dangling.
		for (const sid of e.screenIds) {
			if (!known.has(sid)) {
				dangling.add(sid);
				continue;
			}
			let list = byScreen[sid];
			if (!list) {
				list = [];
				byScreen[sid] = list;
			}
			for (const m of e.modules) {
				if (!list.some((l) => l.module === m)) {
					list.push({ entryId: e.id, module: m });
				}
			}
		}
		// Join técnico: prefijo de segmentos completos contra subsystems.
		for (const m of e.modules) {
			const md = moduleDirOf(m);
			let matched = false;
			for (const d of dirs) {
				if (!dirCovers(d, md)) continue;
				matched = true;
				for (const sid of e.screenIds) {
					if (!known.has(sid)) continue;
					let set = byDir.get(d);
					if (!set) {
						set = new Set();
						byDir.set(d, set);
					}
					set.add(sid);
				}
			}
			if (!matched && dirs.length > 0) unmatched.add(m);
		}
	}

	const byDirectory: Record<string, string[]> = {};
	for (const d of [...byDir.keys()].sort()) {
		byDirectory[d] = [...(byDir.get(d) ?? [])].sort();
	}

	return {
		status: "ready",
		data: {
			entries,
			byScreen,
			byDirectory,
			danglingScreens: [...dangling].sort(),
			unmatchedModules: [...unmatched].sort(),
		},
		loadedAt: Date.now(),
	};
}
