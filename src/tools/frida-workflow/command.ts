// frida-workflow — comando /wf.
//
// Fase 4: los workflows vienen de loadWorkflows (capas: built-ins ← user ←
// project, + skillAliases + default). /wf <input> (primer token no-es-workflow)
// corre el default. /wf @<ref> resume. /wf --name <slug> alias. Los built-ins
// programáticos (registerWorkflow) siguen como capa base para tests/extensiones.

import { join } from "node:path";
import { encodeCwd, readHeader, resolveRef } from "./audit";
import { loadWorkflows } from "./load";
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
	/** Path al bundle DSL (dist/frida-workflow.js) para que los configs importen
	 *  el DSL vía alias jiti. Omitir → sólo plain-data. */
	dslBundlePath?: string;
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
	const wfNames = [...wfs.keys()];

	// Errores de carga (config que no compiló, pack con envelope, etc.).
	const loadErrs = loaded.issues.filter((i) => i.severity === "error");
	if (loadErrs.length) {
		host.notify(
			`⚠ Errores de carga: ${loadErrs.map((i) => i.message).join("; ")}`,
			"warning",
		);
	}

	if (!trimmed) {
		host.notify(
			wfNames.length
				? `Workflows: ${wfNames.join(", ")}${loaded.default ? `  (default: ${loaded.default})` : ""}  ·  /wf <nombre> "<input>"  ·  /wf @<ref>`
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

	// Resolución: <name> <input> | <input> (default) | no-encontrado.
	let wf = wfs.get(first);
	let runInput = input;
	if (!wf && loaded.default && body) {
		wf = wfs.get(loaded.default);
		runInput = body; // todo el body es el input del default
	}
	if (!wf) {
		host.notify(
			`Workflow "${first}" no encontrado. Disponibles: ${wfNames.join(", ") || "(ninguno)"}`,
			"warning",
		);
		return;
	}
	if (!runInput) {
		const stageList = Object.keys(wf.stages).join(" → ");
		host.notify(
			`${wf.name}: ${stageList} → stop  ·  usa /wf ${wf.name} "<input>" para correr`,
			"info",
		);
		return;
	}

	// Validación de grafo: rehúsa correr si hay errores.
	const issues = validateWorkflow(wf);
	if (hasErrors(issues)) {
		const errs = issues
			.filter((i) => i.severity === "error")
			.map((i) => i.message);
		host.notify(`✗ ${wf.name} no valida: ${errs.join("; ")}`, "error");
		return;
	}

	host.notify(`▶ ${wf.name} iniciado (detached)…`, "info");
	void runWorkflow({ workflow: wf, input: runInput, runsDir, host, name })
		.then(notifyResult(host, wf.name))
		.catch(notifyCatch(host, wf.name));
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
			host.notify(
				`✗ ${wfName} falló: ${r.error ?? "error desconocido"}`,
				"error",
			);
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
