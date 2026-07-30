// frida-workflow — validación de grafo (load-time, antes de correr).
//
// validateWorkflow(wf) devuelve issues (error/warning). El /wf rehúsa correr si
// hay errores. Cubre: start declarado, produces con outcome, edges→targets
// válidos, EdgeFn con .targets declarados y existentes, route que lee data ⇒
// source con outputSchema, y alcanzabilidad (warning).

import { routeReadsData } from "./routing";
import type { EdgeFn, Judge, PanelDef, Workflow } from "./types";

export interface ValidationIssue {
	severity: "error" | "warning";
	message: string;
	stage?: string;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
	return issues.some((i) => i.severity === "error");
}

export function validateWorkflow(wf: Workflow): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const stageNames = new Set(Object.keys(wf.stages));

	// 1. start declarado.
	if (!wf.start) {
		issues.push({ severity: "error", message: "workflow sin start" });
	} else if (!stageNames.has(wf.start)) {
		issues.push({
			severity: "error",
			message: `start "${wf.start}" no es una etapa declarada`,
		});
	}

	// 2. produces requiere outcome (salvo script/prompt — Fase 8 — que lo proveen de otra forma).
	for (const [name, st] of Object.entries(wf.stages)) {
		if (
			st.kind === "produces" &&
			!st.outcome &&
			!st.run &&
			st.prompt === undefined
		) {
			issues.push({
				severity: "error",
				stage: name,
				message: `produces "${name}" requiere outcome (o run/prompt)`,
			});
		}
	}

	// 3. edges: keys declaradas, targets válidos, route-needs-outputSchema.
	for (const [from, edge] of Object.entries(wf.edges)) {
		if (!stageNames.has(from)) {
			issues.push({
				severity: "error",
				message: `edge desde "${from}" (no es etapa declarada)`,
			});
		}
		if (typeof edge === "string") {
			if (edge !== "stop" && !stageNames.has(edge)) {
				issues.push({
					severity: "error",
					stage: from,
					message: `edge "${from} → ${edge}": target no declarado`,
				});
			}
		} else {
			const fn = edge as EdgeFn;
			if (!Array.isArray(fn.targets) || fn.targets.length === 0) {
				issues.push({
					severity: "error",
					stage: from,
					message: `route de "${from}" sin .targets`,
				});
			}
			for (const t of fn.targets) {
				if (t !== "stop" && !stageNames.has(t)) {
					issues.push({
						severity: "error",
						stage: from,
						message: `route "${from}": target "${t}" no declarado`,
					});
				}
			}
			// route que lee output.data ⇒ el source necesita outputSchema.
			if (routeReadsData(fn) && !wf.stages[from]?.outputSchema) {
				issues.push({
					severity: "error",
					stage: from,
					message: `route de "${from}" lee output.data pero la etapa no declara outputSchema`,
				});
			}
		}
	}

	// 3b. loops + reads (Fase 6): collecting loop requiere outcome.name; iterate
	//     requiere produces; cada reads debe ser publicado por algún produces.
	const published = new Set<string>();
	for (const [name, st] of Object.entries(wf.stages)) {
		if (st.outcome) published.add(st.outcome.name ?? name);
	}
	for (const [name, st] of Object.entries(wf.stages)) {
		if (st.loop) {
			if (
				(st.loop.kind === "iterate" || st.loop.kind === "assess") &&
				st.kind !== "produces"
			) {
				issues.push({
					severity: "error",
					stage: name,
					message: `${st.loop.kind} en "${name}" requiere kind:"produces"`,
				});
			}
			const collecting =
				st.kind === "produces" ||
				st.loop.kind === "iterate" ||
				st.loop.kind === "assess";
			if (collecting && !st.outcome?.name) {
				issues.push({
					severity: "error",
					stage: name,
					message: `loop en "${name}" (collecting) requiere outcome.name`,
				});
			}
		}
		// verify (Fase 7): requiere produces; el judge.outcome.name debe diferir.
		if (st.verify) {
			if (st.kind !== "produces") {
				issues.push({
					severity: "error",
					stage: name,
					message: `verify en "${name}" requiere kind:"produces"`,
				});
			}
			const jn = judgeVerdictName(st.verify.judge);
			if (st.outcome?.name && jn && jn === st.outcome.name) {
				issues.push({
					severity: "error",
					stage: name,
					message: `verify en "${name}": el outcome.name del judge ("${jn}") debe diferir del productor`,
				});
			}
		}
		if (st.reads) {
			for (const r of st.reads) {
				const rn = typeof r === "string" ? r : r.name;
				if (!published.has(rn)) {
					issues.push({
						severity: "error",
						stage: name,
						message: `reads "${rn}" de "${name}" no es publicado por ninguna etapa produces`,
					});
				}
			}
		}
		// script (Fase 8): excluyente con skill/outcome/loop/prompt/verify.
		if (
			st.run &&
			(st.skill ||
				st.outcome ||
				st.loop ||
				st.prompt !== undefined ||
				st.verify)
		) {
			issues.push({
				severity: "error",
				stage: name,
				message: `script en "${name}" es excluyente con skill/outcome/loop/prompt/verify`,
			});
		}
		// prompt (Fase 8): excluyente con skill/run/loop/reads/verify.
		if (
			st.prompt !== undefined &&
			(st.skill || st.run || st.loop || st.reads || st.verify)
		) {
			issues.push({
				severity: "error",
				stage: name,
				message: `prompt en "${name}" es excluyente con skill/run/loop/reads/verify`,
			});
		}
	}

	// 4. alcanzabilidad (warning: etapas nunca visitables desde start).
	const reachable = reachableFromStart(wf);
	for (const name of stageNames) {
		if (!reachable.has(name)) {
			issues.push({
				severity: "warning",
				stage: name,
				message: `etapa "${name}" no es alcanzable desde start`,
			});
		}
	}

	return issues;
}

function judgeVerdictName(judge: Judge | PanelDef): string | undefined {
	if (Array.isArray((judge as PanelDef).members)) return undefined;
	return (judge as Judge).outcome.name;
}

/** BFS sobre los edges (string o EdgeFn.targets) desde `start`. */
function reachableFromStart(wf: Workflow): Set<string> {
	const reach = new Set<string>();
	if (!wf.stages[wf.start]) return reach;
	const queue: string[] = [wf.start];
	while (queue.length) {
		const s = queue.shift() as string;
		if (reach.has(s)) continue;
		reach.add(s);
		const edge = wf.edges[s];
		if (edge === undefined) continue;
		const targets =
			typeof edge === "string"
				? edge === "stop"
					? []
					: [edge]
				: (edge as EdgeFn).targets;
		for (const t of targets) {
			if (t !== "stop" && wf.stages[t] && !reach.has(t)) queue.push(t);
		}
	}
	return reach;
}
