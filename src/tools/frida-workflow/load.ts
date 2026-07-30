// frida-workflow — carga por capas desde disco (Fase 4).
//
// Capas (low→high, later wins por nombre): built-ins ← user packs ← user config
// ← project packs ← project config. Sólo config.ts puede setear `default` y
// `skillAliases` (los packs son rechazados si traen envelope). Los configs .ts
// importan el DSL desde "frida-workflow" vía alias jiti → dist/frida-workflow.js
// (bundle CJS standalone, typebox dentro). skillAliases se aplica antes de
// devolver (one-hop, no muta los built-ins fuente).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { StageDef, Workflow } from "./types";

export interface LoadIssue {
	severity: "error" | "warning";
	path: string;
	message: string;
}

export interface LoadedWorkflows {
	workflows: Map<string, Workflow>;
	default: string | undefined;
	issues: LoadIssue[];
}

export interface LoadOptions {
	cwd: string;
	agentDir: string; // ~/.frida
	/** Path al bundle DSL (dist/frida-workflow.js) para el alias jiti. Si se omite,
	 *  los configs no pueden `import` el DSL (sólo workflows plain-data). */
	dslBundlePath?: string;
	/** Capa base programática (built-ins). */
	builtIns?: Workflow[];
}

// ---------------------------------------------------------------------------
// Guards de forma
// ---------------------------------------------------------------------------

function isWorkflow(v: unknown): v is Workflow {
	const w = v as Partial<Workflow> | null;
	return (
		!!w &&
		typeof w === "object" &&
		typeof w.name === "string" &&
		typeof w.start === "string" &&
		!!w.stages &&
		typeof w.stages === "object" &&
		!!w.edges &&
		typeof w.edges === "object"
	);
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** jiti puede devolver el namespace {default: X} o X directamente. Desenvuelve
 *  `.default` SÓLO si es un objeto: así el envelope {workflows, default:"p"} no se
 *  desenvuelve a "p" (string), y el namespace {default: envelope} sí. */
function unwrapDefault(mod: unknown): unknown {
	if (mod && typeof mod === "object" && "default" in mod) {
		const d = (mod as { default: unknown }).default;
		if (d && typeof d === "object") return d;
	}
	return mod;
}

// ---------------------------------------------------------------------------
// loadWorkflows
// ---------------------------------------------------------------------------

export function loadWorkflows(opts: LoadOptions): LoadedWorkflows {
	const issues: LoadIssue[] = [];
	const workflows = new Map<string, Workflow>();
	let defaultName: string | undefined;
	const aliases: Record<string, string> = {};

	for (const w of opts.builtIns ?? [])
		if (isWorkflow(w)) workflows.set(w.name, w);

	const loadFile = (file: string): unknown => {
		try {
			const alias: Record<string, string> | undefined = opts.dslBundlePath
				? { "frida-workflow": opts.dslBundlePath }
				: undefined;
			const jiti = createJiti(file, alias ? { alias } : {});
			return unwrapDefault(jiti(file));
		} catch (e) {
			issues.push({
				severity: "error",
				path: file,
				message: `no se pudo cargar: ${errMsg(e)}`,
			});
			return undefined;
		}
	};

	const addLayer = (mod: unknown, path: string, isPack: boolean): void => {
		if (mod == null) return;
		if (isWorkflow(mod)) {
			workflows.set(mod.name, mod);
			return;
		}
		if (Array.isArray(mod)) {
			for (const w of mod) if (isWorkflow(w)) workflows.set(w.name, w);
			return;
		}
		const env = mod as {
			workflows?: unknown;
			default?: unknown;
			skillAliases?: Record<string, string>;
		};
		// envelope?
		const looksEnvelope =
			"workflows" in env || "default" in env || "skillAliases" in env;
		if (looksEnvelope) {
			if (isPack) {
				issues.push({
					severity: "error",
					path,
					message:
						"un pack no puede usar envelope/default/skillAliases (sólo Workflow | Workflow[])",
				});
				return;
			}
			if (Array.isArray(env.workflows)) {
				for (const w of env.workflows)
					if (isWorkflow(w)) workflows.set(w.name, w);
			}
			if (typeof env.default === "string") defaultName = env.default;
			if (env.skillAliases)
				for (const [k, v] of Object.entries(env.skillAliases)) aliases[k] = v;
		} else {
			issues.push({
				severity: "warning",
				path,
				message: "export no reconocido (se ignora)",
			});
		}
	};

	const userDir = join(opts.agentDir, "workflows");
	const projectDir = join(opts.cwd, ".frida", "workflows");

	// Orden: user packs → user config → project packs → project config.
	for (const f of listPacks(userDir)) addLayer(loadFile(f), f, true);
	const userCfg = join(userDir, "config.ts");
	if (existsSync(userCfg)) addLayer(loadFile(userCfg), userCfg, false);
	for (const f of listPacks(projectDir)) addLayer(loadFile(f), f, true);
	const projCfg = join(projectDir, "config.ts");
	if (existsSync(projCfg)) addLayer(loadFile(projCfg), projCfg, false);

	// default cascade: project config (último defaultName asignado) > user config
	// > primer workflow registrado (built-in más bajo).
	const def =
		defaultName ?? (workflows.size ? [...workflows.keys()][0] : undefined);

	// skillAliases: clona para no mutar los built-ins fuente; aplica one-hop.
	let final = workflows;
	if (Object.keys(aliases).length > 0) {
		final = applyAliases(workflows, aliases, issues);
	}

	return { workflows: final, default: def, issues };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listPacks(dir: string): string[] {
	const packsDir = join(dir, "packs");
	if (!existsSync(packsDir)) return [];
	let entries: string[];
	try {
		entries = readdirSync(packsDir);
	} catch {
		return [];
	}
	return entries
		.filter((f) => f.endsWith(".ts"))
		.sort()
		.map((f) => join(packsDir, f));
}

/** Aplica skillAliases sobre clones (no muta fuentes). Devuelve un Map nuevo. */
function applyAliases(
	workflows: Map<string, Workflow>,
	aliases: Record<string, string>,
	issues: LoadIssue[],
): Map<string, Workflow> {
	const out = new Map<string, Workflow>();
	const allSkills = new Set<string>();
	for (const [name, wf] of workflows) {
		const stages: Record<string, StageDef> = {};
		for (const [key, stage] of Object.entries(wf.stages)) {
			const skill = stage.skill ?? key;
			allSkills.add(skill);
			const target = aliases[skill];
			stages[key] = target ? { ...stage, skill: target } : { ...stage };
		}
		out.set(name, { ...wf, stages, edges: { ...wf.edges } });
	}
	for (const key of Object.keys(aliases)) {
		if (!allSkills.has(key)) {
			issues.push({
				severity: "warning",
				path: "<skillAliases>",
				message: `alias "${key}" → "${aliases[key]}" no coincide con ningún skill despachado`,
			});
		}
	}
	return out;
}
