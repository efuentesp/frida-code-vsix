// Runtime compartido del provider Frida Enterprise (ADR-1002).
//
// Pi-ai llama `oauth.getApiKey()` ANTES de armar el payload
// (`before_provider_request`), y ese evento no expone headers (Errata-5 del
// ADR-1001). Este runtime guarda los claims del idToken vigente para que los
// hooks puedan inyectar user_id/email (obligatorios: 422 si faltan).
//
// Es estado POR INSTANCIA (inyectado en oauth/hooks/provider), no una variable
// global del módulo: index.ts crea UNA instancia compartida para todo el
// proceso — mismo ciclo de vida que el registro del provider en ModelRuntime.

import { identityFromToken, type FridaIdentity } from "./adapter";

/** Debug trace (Errata-6): el camino identidad→payload era lo que fallaba en
 *  silencio (el runner traga errores de hooks). Escribe a archivo PROPIO con
 *  timestamp — console.log del exthost no llega a ningún log visible. */
const DEBUG_LOG = `${process.env.HOME ?? ""}/.frida/logs/frida-enterprise-debug.log`;
export function dbg(msg: string): void {
	try {
		const { appendFileSync } = require("node:fs") as typeof import("node:fs");
		appendFileSync(
			DEBUG_LOG,
			`${new Date().toISOString()} ${msg}\n`,
			"utf8",
		);
	} catch {
		/* noop */
	}
}

export interface FridaEnterpriseRuntime {
	/** Registra el idToken actual (desde getApiKey o before_provider_headers). */
	rememberToken(idToken: string): void;
	/** Identidad decodificada del último token recordado. */
	getIdentity(): FridaIdentity;
	/** IDs de modelos Frida conocidos (catálogo vivo, store o fallback). */
	rememberCatalogModels(ids: Iterable<string>): void;
	/** ¿El modelo pertenece a Frida Enterprise? (gate por payload.model) */
	knowsModel(id: string): boolean;
}

/** Runtime con semilla opcional de IDs (p.ej. VERIFIED_MODEL_IDS del barrel):
 *  garantiza el gate por payload.model ANTES del primer refresh exitoso. */
export function createFridaEnterpriseRuntime(
	seedIds?: Iterable<string>,
): FridaEnterpriseRuntime {
	let identity: FridaIdentity = {};
	const modelIds = new Set<string>(seedIds ?? []);
	return {
		rememberToken(idToken: string): void {
			// Patrón del bundle original: TODA llamada LLM lleva identidad
			// explícita. Aquí la identidad se establece al decodificar un
			// idToken Frida VÁLIDO y NUNCA se borra con un token ajeno (un
			// Bearer de zai que pase por before_provider_headers no debe
			// wipearla — E2E S5). Los tokens no-JWT simplemente no decodifican.
			const next = identityFromToken(idToken);
			if (next) {
				identity = next;
				dbg(`identidad capturada (${identity.email ?? "?"})`);
			} else {
				dbg(
					`token NO decodifica como JWT frida (${String(idToken).slice(0, 12)}…) — identidad previa conservada`,
				);
			}
		},
		getIdentity(): FridaIdentity {
			return identity;
		},
		rememberCatalogModels(ids: Iterable<string>): void {
			for (const id of ids) modelIds.add(id);
		},
		knowsModel(id: string): boolean {
			return modelIds.has(id);
		},
	};
}
