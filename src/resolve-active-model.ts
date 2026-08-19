// #89: resolución del modelo activo al crear sesión — PURA y testeable.
//
// Regla: NUNCA cambiar de proveedor sin que el usuario lo pida. Antes, si el
// catálogo del proveedor guardado aún no cargaba (frida-enterprise es async:
// OAuth + GET /v1/models), getModel devolvía undefined y el fallback SILENCIOSO
// a DevEngine cambiaba de proveedor sin avisar (la sesión corría en
// devengine mientras el selector mostraba el elegido — ver provider-audit.log
// 2026-08-19, líneas BASELINE divergentes desde el arranque).
//
// Estrategia:
//   1. getModel(saved) directo.
//   2. Si falla: alt del MISMO proveedor (modelId guardado descontinuado).
//   3. Si no hay: refresh({providers:[saved.provider]}) bounded y REINTENTO
//      (el catálogo async puede terminar de cargar).
//   4. Sólo si tras todo eso no hay nada: fallback + notice HONESTO (no
//      silencioso) — el usuario se entera de en qué quedó y por qué.
//   5. Sin saved: fallback directo (estado inicial legítimo, sin notice).

export interface ResolveModelDeps {
	getModel: (provider: string, modelId: string) => any;
	getModels: (provider: string) => readonly any[];
	refresh: (options?: { providers?: readonly string[] }) => Promise<unknown>;
	fallbackModel: () => any;
	/** Techo de espera del refresh (tests: inyectable). */
	waitMs?: number;
}

export interface ResolveActiveModelResult {
	model: any;
	/** true si se terminó usando el fallback de otro proveedor. */
	usedFallback: boolean;
	/** Proveedores cuyo catálogo se refrescó (vacío si no hizo falta). */
	refreshedProviders: string[];
	/** Aviso honesto cuando el fallback cambió de proveedor. */
	notice?: string;
}

/** Espera por defecto del refresh del catálogo: suficiente para un
 *  GET /v1/models normal, acotado para no retrasar el arranque. */
export const DEFAULT_CATALOG_WAIT_MS = 4_000;

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				resolve({ ok: false });
			}
		}, ms);
		promise.then(
			(v) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve({ ok: true, value: v });
				}
			},
			() => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve({ ok: false });
				}
			},
		);
	});
}

export async function resolveActiveModel(
	saved: { provider: string; modelId: string } | undefined,
	deps: ResolveModelDeps,
): Promise<ResolveActiveModelResult> {
	// 5. Sin modelo guardado: fallback directo (estado inicial legítimo).
	if (!saved) {
		const fb = deps.fallbackModel();
		if (!fb) throw new Error("No se resolvió un modelo utilizable (sin modelo guardado).");
		return { model: fb, usedFallback: true, refreshedProviders: [] };
	}

	// 1. Directo.
	let model = deps.getModel(saved.provider, saved.modelId);

	// 2. Alt del mismo proveedor (modelId descontinuado).
	if (!model) {
		const alts = deps.getModels(saved.provider) ?? [];
		model = alts[0];
	}

	// 3. Catálogo async: refresh del proveedor guardado + reintento.
	const refreshedProviders: string[] = [];
	if (!model) {
		try {
			await withTimeout(
				deps.refresh({ providers: [saved.provider] }),
				deps.waitMs ?? DEFAULT_CATALOG_WAIT_MS,
			);
			refreshedProviders.push(saved.provider);
			model = deps.getModel(saved.provider, saved.modelId);
			if (!model) {
				const alts = deps.getModels(saved.provider) ?? [];
				model = alts[0];
			}
		} catch {
			/* el refresh nunca puede tumbar el arranque */
		}
	}

	if (model) {
		return { model, usedFallback: false, refreshedProviders };
	}

	// 4. Fallback de otro proveedor: SÓLO con notice honesto (#89: nunca en
	//    silencio — la divergencia activo≠real era la causa raíz).
	const fb = deps.fallbackModel();
	if (!fb) {
		throw new Error(
			`No se resolvió un modelo utilizable (activo=${saved.provider}/${saved.modelId}): ni el catálogo del proveedor ni el fallback DevEngine respondieron.`,
		);
	}
	const notice =
		`No se pudo restaurar ${saved.provider}/${saved.modelId} (el catálogo del proveedor no respondió). ` +
		`La sesión quedó en ${fb.provider}/${fb.id} (DevEngine) — elige de nuevo tu modelo en el selector cuando el proveedor vuelva a estar disponible.`;
	return { model: fb, usedFallback: true, refreshedProviders, notice };
}
