// frida-workflow — comando /wf.
//
// Fase 4: los workflows vienen de loadWorkflows (capas: built-ins ← user ←
// project, + skillAliases + default). /wf <input> (primer token no-es-workflow)
// corre el default. /wf @<ref> resume. /wf --name <slug> alias. Los built-ins
// programáticos (registerWorkflow) siguen como capa base para tests/extensiones.

import { join } from "node:path";
import { encodeCwd, readHeader, resolveRef } from "./audit";
import {
	loadWorkflows,
	type LoadedWorkflows,
	type LoadIssue,
	type WorkflowOrigin,
} from "./load";
import { resumeWorkflow, runWorkflow } from "./runner";
import { validateWorkflow, hasErrors } from "./validate";
import type { WorkflowHost, Workflow } from "./types";

// ---------------------------------------------------------------------------
// Registry programático (capa base "built-ins")
// ---------------------------------------------------------------------------

const registry = new Map<string, Workflow>();

export function registerWorkflow(wf: Workflow): void {
	registry.set(wf.name, wf);
}

export function registerWorkflows(wfs: Workflow[]): void {
	for (const w of wfs) registry.set(w.name, w);
}

export function getWorkflow(name: string): Workflow | undefined {
	return registry.get(name);
}

export function listWorkflows(): Workflow[] {
	return [...registry.values()];
}

/** Sólo para tests: limpia el registry. */
export function _resetRegistry(): void {
	registry.clear();
}

// ---------------------------------------------------------------------------
// /wf handler
// ---------------------------------------------------------------------------

export interface WfSlashDeps {
	host: WorkflowHost;
	/** Base donde viven los runs: `<globalStorage>/workflows`. */
	runsDirBase: string;
	cwd: string;
	/** agentDir (~/.frida) — capa de usuario. */
	agentDir: string;
	/** Nombres de patrones agénticos o workflows adicionales para sugerir si no se encuentra. */
	availablePatterns?: string[];
	/** Path al bundle DSL (dist/frida-workflow.js) para que los configs importen
	 *  el DSL vía alias jiti. Omitir → sólo plain-data. */
	dslBundlePath?: string;
	/** `/wf` sola → picker; devuelve {name, input} o undefined si se cancela. */
	pickWorkflow?: (
		loaded: LoadedWorkflows,
	) => Promise<{ name: string; input: string } | undefined>;
	/** `/wf check` → presenta todos los issues (carga + validación) y deja abrir
	 *  el archivo:línea. */
	checkWorkflows?: (loaded: LoadedWorkflows) => Promise<void>;
}

export async function handleWfSlash(
	arg: string,
	deps: WfSlashDeps,
): Promise<void> {
	const { host } = deps;
	const runsDir = join(deps.runsDirBase, encodeCwd(deps.cwd), "runs");
	const trimmed = arg.trim();

	// Carga por capas (Fase 4): built-ins + user + project.
	const loaded = loadWorkflows({
		cwd: deps.cwd,
		agentDir: deps.agentDir,
		dslBundlePath: deps.dslBundlePath,
		builtIns: listWorkflows(),
	});
	const wfs = loaded.workflows;
	const wfNames = [...wfs.keys(), ...(deps.availablePatterns ?? [])];

	// /wf check — valida TODO y presenta los issues (abrir archivo:línea). Se sirve
	// ANTES del abort por errores de carga: justamente los muestra.
	if (trimmed === "check") {
		if (deps.checkWorkflows) return await deps.checkWorkflows(loaded);
		host.notify("/wf check no disponible en este host.", "warning");
		return;
	}

	// Abortar si hay errores de carga: no enmascaramos la intención del usuario
	// corriendo otro workflow (mirror del MSG_LOAD_ABORTED del rpiv-workflow).
	const loadErrs = loaded.issues.filter((i) => i.severity === "error");
	if (loadErrs.length) {
		for (const issue of loadErrs) host.notify(formatLoadIssue(issue), "error");
		host.notify(
			`Carga abortada: ${loadErrs.length} error(es). Corrige y reintenta (¿/wf check?).`,
			"error",
		);
		return;
	}

	if (!trimmed) {
		// /wf sola → picker (si el host lo provee); si no, lista plana.
		if (deps.pickWorkflow) {
			const choice = await deps.pickWorkflow(loaded);
			if (!choice) return; // cancelado
			const wf = wfs.get(choice.name);
			if (!wf) {
				host.notify(`Workflow '${choice.name}' no disponible.`, "error");
				return;
			}
			return runResolved(wf, choice.input, deps, loaded, runsDir);
		}
		host.notify(
			wfNames.length
				? `Workflows: ${wfNames.join(", ")}  ·  /wf <nombre> "<input>"  ·  /wf @<ref>  ·  /wf check`
				: "No hay workflows. Crea <cwd>/.frida/workflows/config.ts o registra con registerWorkflow().",
			"info",
		);
		return;
	}

	// /wf @<ref> — resume.
	if (trimmed.startsWith("@")) {
		const ref = trimmed;
		const runId = resolveRef(runsDir, ref);
		if (!runId) {
			host.notify(`Run "${ref}" no encontrado en ${runsDir}.`, "warning");
			return;
		}
		const header = readHeader(runsDir, runId);
		if (!header) {
			host.notify(`Run "${runId}" sin header válido.`, "warning");
			return;
		}
		const wf = wfs.get(header.workflow);
		if (!wf) {
			host.notify(
				`El run era del workflow "${header.workflow}", que ya no está registrado.`,
				"warning",
			);
			return;
		}
		host.notify(`▶ ${wf.name} reanudando (@${runId})…`, "info");
		void resumeWorkflow({ workflow: wf, runsDir, ref, host })
			.then(notifyResult(host, wf.name))
			.catch(notifyCatch(host, wf.name));
		return;
	}

	// Parse --name (sólo token inicial o final; en medio se ignora con aviso).
	let name: string | undefined;
	let body = trimmed;
	const leading = body.match(/^--name\s+([\w-]+)\s+([\s\S]*)$/);
	if (leading) {
		name = leading[1];
		body = leading[2].trim();
	} else {
		const trailing = body.match(/^([\s\S]*?)\s+--name\s+([\w-]+)$/);
		if (trailing) {
			name = trailing[2];
			body = trailing[1].trim();
		} else if (/\s--name\s/.test(body)) {
			host.notify(
				`--name sólo se honra al inicio/final; el del medio se ignoró.`,
				"warning",
			);
		}
	}

	const [first, ...rest] = body.split(/\s+/);
	const input = rest.join(" ").trim();

	// Resolución: <name> <input> | no-encontrado. SIN default fallback: si el
	// nombre no existe, error explícito (no quema tokens corriendo otro workflow).
	const wf = wfs.get(first);
	if (!wf) {
		host.notify(
			`Workflow '${first}' no encontrado. Disponibles: ${wfNames.join(", ") || "(ninguno)"}  ·  /wf para listar`,
			"error",
		);
		return;
	}
	return runResolved(wf, input, deps, loaded, runsDir, name);
}

// ---------------------------------------------------------------------------
// Helpers de resolución + formato de issues
// ---------------------------------------------------------------------------

/** Valida + lanza un workflow resuelto. Reusa validateWorkflow (rehúsa correr
 *  si hay errores del grafo, un toast por issue con atribución). */
function runResolved(
	wf: Workflow,
	input: string,
	deps: WfSlashDeps,
	loaded: LoadedWorkflows,
	runsDir: string,
	name?: string,
): void {
	const { host } = deps;
	if (!input) {
		const stageList = Object.keys(wf.stages).join(" → ");
		host.notify(
			`${wf.name}: ${stageList} → stop  ·  usa /wf ${wf.name} "<input>" para correr`,
			"info",
		);
		return;
	}
	const errs = validateWorkflow(wf).filter((i) => i.severity === "error");
	if (errs.length) {
		for (const i of errs)
			host.notify(formatValidationIssue(wf, i, loaded), "error");
		host.notify(
			`✗ ${wf.name} no valida: ${errs.length} error(es). ¿/wf check?`,
			"error",
		);
		return;
	}
	host.notify(`▶ ${wf.name} iniciado (detached)…`, "info");
	void runWorkflow({ workflow: wf, input, runsDir, host, name })
		.then(notifyResult(host, wf.name))
		.catch(notifyCatch(host, wf.name));
}

function renderOrigin(o: WorkflowOrigin | undefined): string {
	return o === "builtin"
		? "internos"
		: o === "user"
			? "globales"
			: o === "project"
				? "proyecto"
				: "config";
}

/** Issue de carga → "[config (<archivo>)] <mensaje>". El path ya delata la capa. */
function formatLoadIssue(issue: LoadIssue): string {
	const where = issue.path ? ` (${issue.path})` : "";
	return `[config${where}] ${issue.message}`;
}

/** Issue de validación → "[<capa> (<archivo>)] workflow "x" — stage "y": <msg>". */
function formatValidationIssue(
	wf: Workflow,
	issue: { message: string; stage?: string },
	loaded: LoadedWorkflows,
): string {
	const origin = loaded.origins.get(wf.name);
	const source = loaded.sources.get(wf.name);
	const where = source && source !== "(built-in)" ? ` (${source})` : "";
	const stageTag = issue.stage ? ` — stage "${issue.stage}"` : "";
	return `[${renderOrigin(origin)}${where}] workflow "${wf.name}"${stageTag}: ${issue.message}`;
}

function notifyResult(host: WorkflowHost, wfName: string) {
	return (r: {
		success: boolean;
		stagesCompleted: number;
		lastArtifact?: string;
		error?: string;
	}) => {
		if (r.success) {
			host.notify(
				`✓ ${wfName} completado (${r.stagesCompleted} etapas)${r.lastArtifact ? ` → ${r.lastArtifact}` : ""}`,
				"info",
			);
		} else {
			host.notify(`✗ ${wfName} falló: ${r.error ?? "error desconocido"}`, "error");
		}
	};
}

function notifyCatch(host: WorkflowHost, wfName: string) {
	return (e: unknown) => {
		host.notify(
			`✗ ${wfName} error: ${e instanceof Error ? e.message : String(e)}`,
			"error",
		);
	};
}
