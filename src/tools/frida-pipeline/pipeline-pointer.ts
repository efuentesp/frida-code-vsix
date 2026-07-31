// frida-pipeline — pipeline pointer (índice de skills para el modelo).
//
// Porte de `rpiv-core/pipeline-pointer.ts` (ADR-0021 Fase 4). Las skills de
// pipeline llevan `disable-model-invocation: true` (issue #77), así que Pi las
// oculta del system prompt (~3k tokens ahorrados por sesión, multiplicado por
// las sesiones hijas de workflow). Eso también elimifica el único mapa que
// tiene el modelo para ir de la intención del usuario ("ayúdame a diseñar
// esto") a los comandos de stage. Este módulo recupera esa descubribilidad por
// ~120 tokens: un mensaje oculto que lista los comandos para que el agente
// enrute al desarrollador hacia `/skill:<name>` en vez de improvisar el
// workflow él mismo.
//
// Inyectado en `session_start` y reinyectado tras `session_compact`
// (session-hooks.ts es dueño del wire). Stateless — ambos hooks disparan una
// vez por (re)inicio.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FLAG_DEBUG, MSG_TYPE_PIPELINE_INDEX } from "./constants";

/**
 * Índice de skills del pipeline. Mantener sincronizado con el set de skills
 * `disable-model-invocation: true` bajo src/tools/frida-pipeline/skills/.
 * La agrupación refleja los tiers: stages de pipeline en orden, otros comandos
 * explícitos, y unidades fanout internas de workflow que el agente jamás debe
 * sugerir.
 *
 * En español de México (convención AGENTS.md).
 */
export const PIPELINE_POINTER = [
	"[frida pipeline index — material de referencia, NO una tarea. Las skills",
	"de stage están ocultas de la lista de skills y sólo corren cuando el",
	"desarrollador invoca /skill:<name> explícitamente. Nunca inicies un stage",
	"tú mismo; cuando la petición del usuario coincida con uno, apúntalo al",
	"comando.]",
	"",
	"Stages del pipeline (en orden): /skill:discover → /skill:research →",
	"/skill:design (o /skill:explore para sopesar enfoques primero) →",
	"/skill:plan o /skill:blueprint → /skill:implement → /skill:validate",
	"Otros comandos explícitos: /skill:slice, /skill:revise, /skill:elaborate,",
	"/skill:architecture-review, /skill:frontend-design",
	"Internos de workflow (despachados por lanes — nunca sugerir): amend,",
	"design-slice, design-review, synthesize, grade",
].join("\n");

/**
 * Inyecta el índice del pipeline como mensaje oculto en el transcript.
 * Visible sólo cuando `--frida-debug` está activo (display: true).
 */
export function injectPipelinePointer(pi: ExtensionAPI): void {
	pi.sendMessage({
		customType: MSG_TYPE_PIPELINE_INDEX,
		content: PIPELINE_POINTER,
		display: !!pi.getFlag(FLAG_DEBUG),
	});
}
