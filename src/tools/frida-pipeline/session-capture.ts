// frida-pipeline — captura de sesión + helpers apply/restore de modelo.
//
// Porte simplificado de `rpiv-core/session-capture.ts` (ADR-0021 Fase 3).
// Captura el modelo actual al `session_start` (desde ExtensionContext.model)
// y lo guarda en scope de módulo. El skill-bracket lo usa como baseline para
// restaurar tras un override.
//
// SIN lane-relay (eso es específico del ejecutor desprendido de rpiv-pi, que
// Frida no necesita — frida-workflow tiene su propio host de ejecución).
// SIN capture de modelRegistry (el skill-bracket resuelve el modelo via
// `pi.modelRegistry.find` que expone la ExtensionAPI directamente).

import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevelValue } from "./models-config";

/** Tipo del primer parámetro de pi.setModel() — evita importar Model<Api>
 *  desde pi-ai (no re-exportado por el index principal de pi-coding-agent). */
export type CapturedModel = Parameters<ExtensionAPI["setModel"]>[0];

// ---------------------------------------------------------------------------
// Tipos compartidos
// ---------------------------------------------------------------------------

/**
 * Snapshot del baseline capturado al inicio de un scope de override (skill
 * bracket). Se restaura al final del scope. `hasModelChange` rastrea si se
 * llamó `pi.setModel` con un modelo no-baseline — cuando es false,
 * `restoreBaseline` omite el `setModel` (evita una escritura innecesaria al
 * disco). `setModel` persiste al archivo de settings, así que restaurar es
 * OBLIGATORIO cuando se aplicó un cambio de modelo.
 */
export interface BaselineSnapshot {
	thinking: ModelThinkingLevelValue;
	model: CapturedModel | undefined;
	hasModelChange: boolean;
}

// ---------------------------------------------------------------------------
// Estado de módulo — capturado en session_start
// ---------------------------------------------------------------------------

/**
 * Modelo actual capturado desde session_start. El skill-bracket lo lee como
 * baseline de restauración. Se refresca en cada session_start.
 */
let capturedModel: CapturedModel | undefined;

/**
 * modelRegistry capturado en session_start desde ExtensionContext.
 * El skill-bracket lo pide prestado para resolver strings de modelo de
 * override a objetos Model (sin pasar por pi.setModel global).
 */
let capturedModelRegistry: ModelRegistry | undefined;

/** Test reset. */
export function __resetSessionCaptureState(): void {
	capturedModel = undefined;
	capturedModelRegistry = undefined;
}

// ---------------------------------------------------------------------------
// Hook de session_start — capturar modelo
// ---------------------------------------------------------------------------

/**
 * Registra el hook que captura el modelo actual y el modelRegistry al iniciar
 * sesión. Se llama desde registerSessionHooks.
 */
export function registerSessionCapture(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		if (ctx.model !== undefined) {
			capturedModel = ctx.model as CapturedModel;
		}
		if (ctx.modelRegistry) {
			capturedModelRegistry = ctx.modelRegistry;
		}
	});
}

/** Devuelve el modelo baseline capturado en session_start. */
export function getCapturedModel(): CapturedModel | undefined {
	return capturedModel;
}

/** Devuelve el modelRegistry capturado en session_start. */
export function getCapturedModelRegistry(): ModelRegistry | undefined {
	return capturedModelRegistry;
}

// ---------------------------------------------------------------------------
// Guard de stale-ctx — compartido por el skill-bracket
// ---------------------------------------------------------------------------

/**
 * Ejecuta mutaciones de modelo/thinking, tragando SÓLO el error stale-ctx que
 * pi-core lanza cuando la sesión capturada fue reemplazada/disposed
 * (ej. auto-compaction disponiendo el runner mientras un turno está en vuelo).
 * Una vez que la sesión se fue, el override es moot — la sesión de reemplazo
 * reconstruye el estado. Cualquier OTRO error es genuino y debe propagarse.
 */
export async function applyOrSkipIfStale(
	fn: () => void | Promise<void>,
): Promise<void> {
	try {
		await fn();
	} catch (e) {
		if (!isStaleCtxError(e)) throw e;
	}
}

/** ¿El error es un "stale context" (sesión disposed/replaced)? */
function isStaleCtxError(e: unknown): boolean {
	if (e instanceof Error) {
		return /stale|disposed|invalidated|session.*replac/i.test(e.message);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Helpers de apply/restore — consumidos por el skill-bracket
// ---------------------------------------------------------------------------

interface ApplyEffectiveModelOpts {
	/** String canónico "provider/modelId" del override. */
	overrideModel: string | undefined;
	/** Modelo baseline ya resuelto desde session_start. */
	baselineModel: CapturedModel | undefined;
	/** Nivel de thinking del override. undefined = no override. */
	overrideThinking: ModelThinkingLevelValue | undefined;
	/** Nivel de thinking baseline capturado al inicio del scope. */
	baselineThinking: ModelThinkingLevelValue;
	/** Label legible para warnings (ej. `/skill:commit`). */
	label: string;
	/**
	 * true (workflow): en miss de override, re-aplicar baseline (anti-bleed).
	 * false (bracket): en miss, saltar setModel (arm one-shot).
	 */
	setBaselineModel: boolean;
}

/**
 * Aplica un override de modelo + thinking. Resuelve el string de override
 * via el registry, lo compone contra el baseline, y aplica via `pi.setModel`
 * + `pi.setThinkingLevel`.
 *
 * Devuelve `{ hasModelChange }` — true cuando se resolvió un modelo de
 * override no-baseline y se llamó setModel. Soft-fails (warn, continúa)
 * cuando el modelo de override no se resuelve o setModel devuelve false.
 */
export async function applyEffectiveModel(
	pi: ExtensionAPI,
	opts: ApplyEffectiveModelOpts,
): Promise<{ hasModelChange: boolean }> {
	let hasModelChange = false;

	if (opts.overrideModel !== undefined) {
		const resolved = resolveModel(opts.overrideModel);
		if (resolved) {
			const ok = await pi.setModel(resolved);
			if (!ok) {
				console.warn(
					`[frida-pipeline] setModel falló para ${opts.label} (¿sin API key?) — continuando con el modelo actual`,
				);
			}
			hasModelChange = true;
		} else {
			console.warn(
				`[frida-pipeline] modelo no encontrado: ${opts.overrideModel} (${opts.label}) — usando baseline`,
			);
		}
	}

	if (
		!hasModelChange &&
		opts.setBaselineModel &&
		opts.baselineModel !== undefined
	) {
		await pi.setModel(opts.baselineModel);
	}

	pi.setThinkingLevel(opts.overrideThinking ?? opts.baselineThinking);

	return { hasModelChange };
}

/**
 * Restaura el baseline al final de un scope de override. Omite `setModel`
 * cuando `hasModelChange === false` (override de thinking únicamente).
 * Siempre restaura el nivel de thinking.
 */
export async function restoreBaseline(
	pi: ExtensionAPI,
	base: BaselineSnapshot,
): Promise<void> {
	if (base.hasModelChange && base.model !== undefined) {
		const ok = await pi.setModel(base.model);
		if (!ok) {
			console.warn(
				"[frida-pipeline] no se pudo restaurar el modelo baseline — continuando con el actual",
			);
		}
	}
	pi.setThinkingLevel(base.thinking);
}

/**
 * Resolve un string "provider/modelId" a un objeto Model via el registry
 * capturado en session_start. Si no hay registry, devuelve undefined
 * (el override se ignora con warning en el caller).
 */
function resolveModel(modelStr: string | undefined): CapturedModel | undefined {
	if (!modelStr || !capturedModelRegistry) return undefined;
	const parsed = parseModelKey(modelStr);
	if (!parsed) return undefined;
	return capturedModelRegistry.find(parsed.provider, parsed.modelId) as
		| CapturedModel
		| undefined;
}

/** Parse "provider/modelId" o "provider:modelId" → { provider, modelId }. */
function parseModelKey(
	key: string,
): { provider: string; modelId: string } | undefined {
	// Forma canónica con barra.
	const slashIdx = key.indexOf("/");
	if (slashIdx > 0) {
		return {
			provider: key.slice(0, slashIdx),
			modelId: key.slice(slashIdx + 1),
		};
	}
	// Forma legacy con dos puntos.
	const colonIdx = key.indexOf(":");
	if (colonIdx > 0) {
		return {
			provider: key.slice(0, colonIdx),
			modelId: key.slice(colonIdx + 1),
		};
	}
	return undefined;
}
