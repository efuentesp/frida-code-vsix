// Factory del pipeline SDD — #188.
//
// Encapsula la maquinaria genérica que el config de SELE-DEV arrastraba
// (~160 líneas): collector del informe .md más reciente, verdict del
// frontmatter leído EN EL INSTANTE de la decisión (#174 — neutraliza la raza
// de flush del skill validate), parser del artifact y el circuit breaker del
// zigzag implement↔validate (#152). El config de un proyecto queda reducido
// a decisiones:
//
//   export const workflows = [
//     defineSddWorkflow({ name: "sdd-ship", start: "elaborate" }),
//   ];
//
// Flujo generado: [elaborate →] implement → validate → (pass: commit |
// fail: implement … | N fails: stop) → [commit → stop | siguiente fase].
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	Artifact,
	CollectCtx,
	CollectResult,
	EdgeTable,
	StageDef,
	Workflow,
} from "./types";
import { acts, fs, produces, terminal } from "./dsl";
import { defineRoute } from "./routing";
import { typeboxSchema } from "./schema";
import { Type } from "typebox";

export interface SddWorkflowOptions {
	/** Nombre único del workflow (p. ej. "sdd-ship"). */
	name: string;
	/** Etapa inicial: "elaborate" documenta antes de codificar (sdd-ship);
	 *  "implement" salta directo (sdd-full / multi-fase). Default "implement". */
	start?: "elaborate" | "implement";
	/** Skills despachados por etapa. Defaults = skills SDD estándar
	 *  (~/.frida/skills/{elaborate,implement,validate,commit}). */
	skills?: Partial<{
		elaborate: string;
		implement: string;
		validate: string;
		commit: string;
	}>;
	/** Directorio (relativo al cwd del proyecto) donde el skill validate
	 *  escribe sus informes .md con frontmatter de verdict.
	 *  Default ".frida/artifacts/validation". */
	validationDir?: string;
	/** Clave del frontmatter con pass|fail. Default "verdict". */
	verdictKey?: string;
	/** Ciclos implement↔validate antes del circuit breaker (stop). Default 3. */
	breakerCycles?: number;
	/** Modo multi-fase: tras commit sigue con la siguiente fase (commit →
	 *  implement). Default false (commit → stop). */
	nextPhaseAfterCommit?: boolean;
}

/** Informe .md más reciente de `dir` (por mtime) — collector. */
function newestMdCollector(dir: string) {
	return (ctx: CollectCtx): CollectResult => {
		try {
			const files = readdirSync(join(ctx.cwd, dir)).filter((f) =>
				f.endsWith(".md"),
			);
			if (files.length === 0)
				return { kind: "fatal", message: `sin reportes en ${dir}` };
			const newest = files
				.map((f) => ({ f, m: statSync(join(dir2(ctx.cwd, dir), f)).mtimeMs }))
				.sort((a, b) => b.m - a.m)[0]!.f;
			return {
				kind: "ok" as const,
				artifacts: [{ handle: fs(join(dir, newest)), role: "primary" }],
			};
		} catch (e) {
			return { kind: "fatal", message: String(e) };
		}
	};
}

const dir2 = (cwd: string, dir: string) => join(cwd, dir);

/** Verdict del frontmatter del .md más reciente, leído AHORA (el route corre
 *  tras collect+audit, con el flush ya landed — #174). */
function readFreshVerdict(dir: string, verdictKey: string) {
	return (cwd: string): boolean | undefined => {
		try {
			const files = readdirSync(join(cwd, dir)).filter((f) => f.endsWith(".md"));
			const newest = files
				.map((f) => ({ f, m: statSync(join(cwd, dir, f)).mtimeMs }))
				.sort((a, b) => b.m - a.m)[0];
			if (!newest) return undefined;
			const head =
				readFileSync(join(cwd, dir, newest.f), "utf8").split("---")[1] ?? "";
			const m = head.match(new RegExp(`${verdictKey}:\\s*(pass|fail)`, "i"));
			return m ? m[1]!.toLowerCase() === "pass" : undefined;
		} catch {
			return undefined;
		}
	};
}

/** Parser: {passed} del frontmatter del artifact primario. */
function verdictParser(verdictKey: string) {
	return (artifacts: Artifact[]) => {
		const a = artifacts[0];
		if (!a || a.handle.kind !== "fs" || !a.handle.path) return undefined;
		try {
			const head = readFileSync(a.handle.path, "utf8").slice(0, 800);
			const m = head.match(new RegExp(`${verdictKey}:\\s*(pass|fail)`, "i"));
			return m ? { passed: m[1]!.toLowerCase() === "pass" } : undefined;
		} catch {
			return undefined;
		}
	};
}

export function defineSddWorkflow(opts: SddWorkflowOptions): Workflow {
	const {
		name,
		start = "implement",
		skills = {},
		validationDir = join(".frida", "artifacts", "validation"),
		verdictKey = "verdict",
		breakerCycles = 3,
		nextPhaseAfterCommit = false,
	} = opts;
	const skillNames = {
		elaborate: skills.elaborate ?? "elaborate",
		implement: skills.implement ?? "implement",
		validate: skills.validate ?? "validate",
		commit: skills.commit ?? "commit",
	};
	const conElaborate = start === "elaborate";
	// #152 — al 3er FAIL, stagesCompleted = (elaborate?1:0) + ciclos*2
	// (con >= umbral+1 se permitía un ciclo extra).
	const breakerAt = (conElaborate ? 1 : 0) + breakerCycles * 2;

	const stages: Record<string, StageDef> = {};
	if (conElaborate)
		stages.elaborate = acts({
			skill: skillNames.elaborate,
			inheritsArtifacts: false,
		});
	stages.implement = terminal({ skill: skillNames.implement });
	stages.validate = produces({
		skill: skillNames.validate,
		inheritsArtifacts: false,
		outcome: {
			collector: newestMdCollector(validationDir),
			parser: verdictParser(verdictKey),
		},
		outputSchema: typeboxSchema(Type.Object({ passed: Type.Boolean() })),
	});
	stages.commit = acts({ skill: skillNames.commit });

	const edges: EdgeTable = {};
	if (conElaborate) edges.elaborate = "implement";
	edges.implement = "validate";
	edges.validate = defineRoute(["commit", "implement", "stop"], (ctx) => {
		// #174 — decidir con el informe FRESCO; el collect pudo entregar el
		// del ciclo anterior (raza de flush al cerrar la sesión del skill).
		const fresh = readFreshVerdict(validationDir, verdictKey)(ctx.cwd);
		const passed =
			(fresh ?? (ctx.output.data as { passed?: boolean })?.passed) === true;
		if (passed) return "commit";
		if (ctx.state.stagesCompleted >= breakerAt) return "stop";
		return "implement";
	});
	edges.commit = nextPhaseAfterCommit ? "implement" : "stop";

	return { name, start, stages, edges };
}
