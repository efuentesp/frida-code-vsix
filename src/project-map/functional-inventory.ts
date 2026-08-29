// M2 (#143) — Mapa del proyecto: lectura/validación host-side del inventario
// funcional de M8 (docs/funcional/artifacts/inventory.json).
//
// Fuente de verdad determinista: el writer de app-walkthrough (src/tools/
// frida-app-walkthrough/workflow.ts:313-330) serializa {run, screens,
// actionLog, stoppedBy, stoppedByTime} con invSerialize()/invWrite(). Este
// módulo NO parsea markdown ni journeys.md (los IDs J01.. se derivan en
// ./journeys.ts). Degradación digna (FR-7 / R7 de M9): sin docs/funcional →
// empty accionable con workaround textual; JSON corrupto → empty/corrupt.
// Nunca un spinner eterno (#142).

import fs from "node:fs";
import path from "node:path";

import { deriveJourneys, type PmJourney, type PmAction } from "./journeys";

/** Pantalla M8 normalizada para la UI (paths relativos al cwd de la corrida). */
export interface PmScreen {
	id: string;
	title: string;
	canon: string;
	origin: string;
	firstSeenStep: number;
	/** Snapshot del primer paso en esta pantalla (relativo; "" si no aplica). */
	snapshot: string;
	/** PNG (relativo; "" si el screenshot falló al capturar). */
	screenshot: string;
	purpose: string;
	userRoles: string[];
}

export interface PmFunctionalData {
	screens: PmScreen[];
	journeys: PmJourney[];
	/** "" | "budget" | "time" | "stepLimit" | "done" — badge de cobertura parcial. */
	stoppedBy: string;
	/** screenIds del actionLog que no existen en screens (edición manual). */
	orphans: string[];
	runUrl: string;
}

export type PmFunctionalState =
	| { status: "loading" }
	| {
			status: "empty";
			/** missing | corrupt — para el copy accionable. */
			reason: "missing" | "corrupt";
			hint: string;
	  }
	| { status: "error"; hint: string }
	| { status: "ready"; data: PmFunctionalData; loadedAt: number };

/** Estado completo del tab (espejo UI en webview/types.ts — builds separados). */
export interface ProjectMapHostState {
	functional?: PmFunctionalState;
	busy?: "functional" | null;
	/** Epoch ms del inicio de la acción (#111): sobrevive re-montes del tab. */
	busySince?: number | null;
}

export type FunctionalLoadResult = PmFunctionalState;

const INVENTORY_REL = path.join(
	"docs",
	"funcional",
	"artifacts",
	"inventory.json",
);

/** Texto del workaround (molde traffic2api/workflow.ts:795). */
export const MISSING_WORKAROUND =
	"corre el patrón app-walkthrough (M8) para generar docs/funcional/";

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string")
		: [];
}

/** Carga, valida y deriva el mapa funcional. SIEMPRE resuelve (nunca throw). */
export function loadFunctionalMap(cwd: string): FunctionalLoadResult {
	const invPath = path.join(cwd, INVENTORY_REL);
	if (!fs.existsSync(invPath)) {
		return {
			status: "empty",
			reason: "missing",
			hint: `Sin mapa funcional — ${MISSING_WORKAROUND}`,
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(invPath, "utf8"));
	} catch {
		return {
			status: "empty",
			reason: "corrupt",
			hint:
				"inventory.json de M8 ilegible — regenera docs/funcional/ con el patrón app-walkthrough (M8)",
		};
	}
	// Canon de validación (traffic2api/workflow.ts:996-1002): forma mínima.
	const inv = raw as {
		run?: unknown;
		screens?: unknown;
		actionLog?: unknown;
		stoppedBy?: unknown;
	};
	if (!Array.isArray(inv.screens) || !Array.isArray(inv.actionLog)) {
		return {
			status: "empty",
			reason: "corrupt",
			hint:
				"inventory.json de M8 sin forma esperada (screens/actionLog) — regenera docs/funcional/",
		};
	}

	const screens: PmScreen[] = [];
	const knownIds = new Set<string>();
	for (const s of inv.screens) {
		const rec = s as Record<string, unknown>;
		const id = asString(rec.id);
		if (!id) continue; // sin id no hay nodo estable — se excluye
		knownIds.add(id);
		screens.push({
			id,
			title: asString(rec.title) || id,
			canon: asString(rec.canon),
			origin: asString(rec.origin),
			firstSeenStep: Number(rec.firstSeenStep) || 0,
			snapshot: asString(rec.snapshot),
			screenshot: asString(rec.screenshot),
			purpose: asString(rec.purpose),
			userRoles: asStringArray(rec.userRoles),
		});
	}

	// Huérfanos: screenIds del actionLog sin pantalla registrada (imposible del
	// writer, posible por edición manual) — se marcan y excluyen, nunca
	// undefined en el layout.
	const orphans = new Set<string>();
	const actions: PmAction[] = [];
	for (const a of inv.actionLog) {
		const rec = a as Record<string, unknown>;
		const screenId = asString(rec.screenId);
		if (!screenId || !knownIds.has(screenId)) {
			if (screenId) orphans.add(screenId);
			continue;
		}
		actions.push({
			step: Number(rec.step) || 0,
			screenId,
			kind: asString(rec.kind),
			description: asString(rec.description),
			outcome: asString(rec.outcome),
		});
	}

	return {
		status: "ready",
		data: {
			screens,
			journeys: deriveJourneys(actions),
			stoppedBy: asString(inv.stoppedBy),
			orphans: [...orphans],
			runUrl: asString((inv.run as Record<string, unknown> | undefined)?.url),
		},
		loadedAt: Date.now(),
	};
}
