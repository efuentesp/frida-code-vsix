// Patch de canales laterales (ADR-1002, Errata-9).
//
// El compact/branch-summary de pi-coding-agent llama agent.streamFunction
// (sdk.js) → modelRuntime.streamSimple/completeSimple SIN onPayload: esos
// requests NUNCA pasan por before_provider_request → salen sin
// user_id/email y con role "developer" (Erratas 2/5/8) → 422 del gateway.
//
// Este módulo envuelve streamSimple/completeSimple del ModelRuntime que el
// host YA registró, inyectando un onPayload equivalente SOLO cuando:
//   • el modelo es de frida-enterprise (aislamiento: otros providers intactos),
//   • y nadie ya pasó onPayload (el camino normal del Agent manda el suyo).
//
// Toda la lógica vive en nuestra carpeta; el wiring es UNA línea en
// pi-session.ts junto al registerProvider existente (ver index.ts).

import { buildFridaPayload } from "./adapter";
import { dbg, type FridaEnterpriseRuntime } from "./runtime";

export interface FridaSideChannelDeps {
	runtime: FridaEnterpriseRuntime;
	/** ¿El modelo pertenece a Frida Enterprise? (whitelist del runtime). */
	isFridaModel: (model: any) => boolean;
}

/** Envuelve el ModelRuntime del host para cubrir canales laterales (compact). */
export function patchFridaSideChannels(
	modelRuntime: any,
	deps: FridaSideChannelDeps,
): void {
	const { runtime, isFridaModel } = deps;

	const wrap = (method: "streamSimple" | "completeSimple") => {
		const original = modelRuntime[method];
		if (typeof original !== "function") return;
		modelRuntime[method] = function patched(this: any, model: any, context: any, options: any) {
			try {
				if (
					model &&
					isFridaModel(model) &&
					options &&
					typeof options.onPayload !== "function"
				) {
					const identity = runtime.getIdentity();
					if (identity.user_id || identity.email) {
						dbg(
							`${method}: canal lateral (compact) → inyectando onPayload (model=${model.id})`,
						);
						options = {
							...options,
							onPayload: (payload: any) =>
								buildFridaPayload(payload, identity),
						};
					} else {
						dbg(`${method}: canal lateral SIN identidad aún (model=${model.id}) — sin parche`);
					}
				}
			} catch (e: any) {
				dbg(`${method}: patch falló (${String(e?.message ?? e).slice(0, 60)}) → camino original`);
			}
			return original.call(this, model, context, options);
		};
	};

	wrap("streamSimple");
	wrap("completeSimple");
	dbg("patch de canales laterales instalado (streamSimple/completeSimple)");
}
