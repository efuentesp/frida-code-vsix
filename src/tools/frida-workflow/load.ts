// frida-workflow — carga por capas desde disco (Fase 4).
//
// Capas (low→high, later wins por nombre): built-ins ← user packs ← user config
// ← project packs ← project config. Sólo config.ts puede setear `default` y
// `skillAliases` (los packs son rechazados si traen envelope). Los configs .ts
// importan el DSL desde "frida-workflow" vía alias jiti → dist/frida-workflow.js
// (bundle CJS standalone, typebox dentro). skillAliases se aplica antes de
// devolver (one-hop, no muta los built-ins fuente).

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { StageDef, Workflow } from "./types";

export interface LoadIssue {
	severity: "error" | "warning";
	path: string;
	message: string;
}

/** Lo que un config/pack exporta tras desenvolver `.default`: un workflow, un
 *  array, un envelope {workflows, default, skillAliases} o nada. La validación
 *  fina la hacen los guards de addLayer (isWorkflow/envelope). */
type WorkflowModule =
	| Workflow
	| Workflow[]
	| Partial<{
			workflows: unknown;
			default: unknown;
			skillAliases: Record<string, string>;
	  }>
	| null
	| undefined;

export interface LoadedWorkflows {
	workflows: Map<string, Workflow>;
	default: string | undefined;
	issues: LoadIssue[];
	/** Capa ganadora por nombre — para agrupar (Internos/Globales/Proyecto). */
	origins: Map<string, WorkflowOrigin>;
	/** Archivo que define cada workflow — para /wf check ("abrir archivo"). */
	sources: Map<string, string>;
}

/** De dónde vino un workflow (capa que ganó por nombre). */
export type WorkflowOrigin = "builtin" | "user" | "project";

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
// Alias DSL → wrapper CJS (#189)
// ---------------------------------------------------------------------------

/** #189 — Evaluar el bundle bajo jiti dispara un bug en la jiti embebida del
 *  propio bundle al resolver `node:` imports ("filename undefined"); además
 *  re-evalúa ~megabytes de DSL por config. Un wrapper CJS mínimo delega el
 *  require a Node (cache de módulos): la jiti sólo transforma el wrapper.
 *  Idempotente por hash del bundle (versiones distintas no colisionan).
 *  Si tmpdir() no es escribible, cae al bundle directo (comportamiento previo). */
export function dslAliasTarget(bundlePath: string): string {
	const hash = createHash("sha1")
		.update(bundlePath)
		.digest("hex")
		.slice(0, 12);
	const wrapper = join(tmpdir(), `frida-dsl-${hash}.cjs`);
	const content = `// Auto-generado por frida-workflow (#189) — no editar.\nmodule.exports = require(${JSON.stringify(bundlePath)});\n`;
	try {
		const prev = existsSync(wrapper) ? readFileSync(wrapper, "utf8") : null;
		if (prev !== content) {
			mkdirSync(tmpdir(), { recursive: true });
			writeFileSync(wrapper, content, "utf8");
		}
		return wrapper;
	} catch {
		return bundlePath;
	}
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
function unwrapDefault(mod: unknown): WorkflowModule {
	if (mod && typeof mod === "object" && "default" in mod) {
		const d = (mod as { default: unknown }).default;
		if (d && typeof d === "object") return d as WorkflowModule;
	}
	return mod as WorkflowModule;
}

// ---------------------------------------------------------------------------
// loadWorkflows
// ---------------------------------------------------------------------------

export function loadWorkflows(opts: LoadOptions): LoadedWorkflows {
	const issues: LoadIssue[] = [];
	const workflows = new Map<string, Workflow>();
	const origins = new Map<string, WorkflowOrigin>();
	const sources = new Map<string, string>();
	let defaultName: string | undefined;
	const aliases: Record<string, string> = {};

	for (const w of opts.builtIns ?? [])
		if (isWorkflow(w)) {
			workflows.set(w.name, w);
			origins.set(w.name, "builtin");
			sources.set(w.name, "(built-in)");
		}

	const loadFile = (file: string): WorkflowModule => {
		try {
			const alias: Record<string, string> | undefined = opts.dslBundlePath
				? { "frida-workflow": dslAliasTarget(opts.dslBundlePath) }
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

	const addLayer = (
		mod: unknown,
		path: string,
		isPack: boolean,
		origin: WorkflowOrigin,
	): void => {
		const put = (w: Workflow): void => {
			workflows.set(w.name, w);
			origins.set(w.name, origin);
			sources.set(w.name, path);
		};
		if (mod == null) return;
		if (isWorkflow(mod)) {
			put(mod);
			return;
		}
		if (Array.isArray(mod)) {
			for (const w of mod) if (isWorkflow(w)) put(w);
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
				for (const w of env.workflows) if (isWorkflow(w)) put(w);
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
	for (const f of listPacks(userDir)) addLayer(loadFile(f), f, true, "user");
	const userCfg = join(userDir, "config.ts");
	if (existsSync(userCfg)) addLayer(loadFile(userCfg), userCfg, false, "user");
	for (const f of listPacks(projectDir))
		addLayer(loadFile(f), f, true, "project");
	const projCfg = join(projectDir, "config.ts");
	if (existsSync(projCfg))
		addLayer(loadFile(projCfg), projCfg, false, "project");

	// default cascade: project config (último defaultName asignado) > user config
	// > primer workflow registrado (built-in más bajo).
	const def =
		defaultName ?? (workflows.size ? [...workflows.keys()][0] : undefined);

	// skillAliases: clona para no mutar los built-ins fuente; aplica one-hop.
	let final = workflows;
	if (Object.keys(aliases).length > 0) {
		final = applyAliases(workflows, aliases, issues);
	}

	return { workflows: final, default: def, issues, origins, sources };
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
