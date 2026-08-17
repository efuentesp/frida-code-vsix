// frida-goal — tools goal_complete / goal_blocked registrados en la sesión
// principal (MVP; goal_wait es fase 2). Semántica del upstream: el modelo
// NO termina la conversación — son tools de señalización que el runtime
// valida (stale goal_id, ≥3 turnos para blocked, evidencia obligatoria).

import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalRuntime } from "./runtime.js";

export function registerGoalTools(pi: ExtensionAPI, runtime: GoalRuntime): void {
	pi.registerTool(
		defineTool({
			name: "goal_complete",
			label: "Goal complete",
			description:
				"Señala que el objetivo activo de /goal está completamente cumplido. Sólo llámalo tras verificar cada requisito con evidencia autoritativa (tests, comandos, artefactos inspeccionados). Pasa el goal_id exacto que aparece en el prompt del goal.",
			promptSnippet:
				"Signal that the active /goal objective is fully complete",
			promptGuidelines: [
				"Sólo llama goal_complete cuando evidencia verificada demuestre que TODOS los requisitos del objetivo están satisfechos; nunca para objetivos parciales o probables.",
				"Pasa el goal_id exacto del prompt del goal (guard anti turno obsoleto).",
			],
			parameters: Type.Object({
				goal_id: Type.String({
					description: "El goal_id exacto del goal activo.",
				}),
				summary: Type.String({
					description:
						"Resumen de qué se completó y la evidencia que lo demuestra.",
				}),
			}),
			execute: async (
				_toolCallId: string,
				args: { goal_id: string; summary: string },
			) => {
				const error = runtime.onGoalComplete(args.goal_id, args.summary);
				if (error) {
					return {
						content: [{ type: "text" as const, text: error }],
						details: undefined,
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: "Goal completado. Fin del loop automático.",
						},
					],
					details: undefined,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "goal_blocked",
			label: "Goal blocked",
			description:
				"Señala un impasse REAL del objetivo activo: el mismo blocker debe repetirse al menos 3 turnos consecutivos y requerir acción del usuario o externa. No lo uses porque el trabajo sea difícil, lento o haya fallado algo recuperable.",
			promptSnippet: "Signal a true impasse on the active /goal objective",
			promptGuidelines: [
				"Sólo tras ≥3 turnos consecutivos con el MISMO blocker y evidencia de que se requiere acción del usuario/externa.",
				"Requiere evidence concreta (errores, comandos, archivos). Sin ella el tool es rechazado.",
			],
			parameters: Type.Object({
				goal_id: Type.String({
					description: "El goal_id exacto del goal activo.",
				}),
				reason: Type.String({
					description:
						"Qué bloquea el objetivo (el mismo texto en turnos consecutivos).",
				}),
				evidence: Type.String({
					description:
						"Evidencia concreta del impasse: errores exactos, comandos corridos, archivos revisados.",
				}),
			}),
			execute: async (
				_toolCallId: string,
				args: { goal_id: string; reason: string; evidence: string },
			) => {
				const error = runtime.onGoalBlocked(
					args.goal_id,
					args.reason,
					args.evidence,
				);
				if (error) {
					return {
						content: [{ type: "text" as const, text: error }],
						details: undefined,
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: "Goal marcado como bloqueado. /goal resume para reintentar.",
						},
					],
					details: undefined,
				};
			},
		}),
	);
}
