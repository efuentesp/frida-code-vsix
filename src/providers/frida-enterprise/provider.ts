// ProviderConfig para ModelRuntime.registerProvider (ADR-1001/0022).
//
// El baseUrl real llega tras el login (COMPATIBLE_API_URL), por eso el registro
// arranca con `models: []`: el catálogo lo llena refreshModels() con la
// credential. `authHeader: true` hace que el Bearer venga del getApiKey del
// OAuth (el idToken). Cada modelo del catálogo lleva baseUrl = raíz + /v1
// (Errata-4: el SDK de OpenAI no antepone /v1).

import { dbg } from "./runtime";
import type { FridaEnterpriseRuntime } from "./runtime";
import type { FridaEnterpriseCredential } from "./oauth";
import { buildFridaEnterpriseOAuth } from "./oauth";
import {
	buildFallbackCatalog,
	fetchFridaEnterpriseModels,
} from "./catalog";

export function buildFridaEnterpriseProviderConfig(
	runtime: FridaEnterpriseRuntime,
) {
	return {
		name: "Frida Enterprise",
		// Placeholder válido para que el provider sea seleccionable pre-login;
		// cada modelo del refreshModels trae su baseUrl real.
		baseUrl: "https://frida-extension-enterprise-backend.azurewebsites.net",
		api: "openai-completions" as const,
		authHeader: true,
		models: [],
		oauth: buildFridaEnterpriseOAuth(runtime),
		async refreshModels(context: any) {
			dbg(
				`refreshModels: allowNetwork=${String(context?.allowNetwork)} credential=${context?.credential ? "sí" : "NO"} url=${String((context?.credential?.compatibleApiUrl ?? context?.credential?.envVars?.COMPATIBLE_API_URL ?? "")) || "—"}`,
			);
			const credential = context?.credential as
				| FridaEnterpriseCredential
				| undefined;
			const idToken = credential?.access;
			const rootUrl = (
				credential?.compatibleApiUrl ??
				credential?.envVars?.COMPATIBLE_API_URL ??
				""
			).replace(/\/$/, "");
			// Errata-4: pi-ai ("openai-completions") usa el SDK oficial de
			// OpenAI, que NO antepone /v1 — el baseURL debe incluirlo.
			const baseUrl = rootUrl ? `${rootUrl}/v1` : "";
			if (!context?.allowNetwork || !idToken || !baseUrl) {
				// Offline/PI_OFFLINE (patrón createProvider de pi-ai): restaurar
				// el catálogo persistido antes de caer al fallback MODEL1..4.
				try {
					const stored = await context?.store?.read();
					if (stored?.models?.length) {
						runtime.rememberCatalogModels(
							stored.models.map((m: any) => m.id),
						);
						dbg(`refreshModels: ${stored.models.length} modelos RESTAURADOS del store (offline)`);
						return stored.models;
					}
				} catch (e: any) {
					dbg(`refreshModels: store.read falló (${String(e?.message ?? e).slice(0, 60)})`);
				}
				const fallback = buildFallbackCatalog(credential?.envVars ?? {});
				runtime.rememberCatalogModels(fallback.map((m) => m.id));
				dbg(`refreshModels: FALLBACK ${fallback.length} modelos (sin red/store)`);
				return fallback.map((m) => ({ ...m, baseUrl }));
			}
			const models = await fetchFridaEnterpriseModels(rootUrl, idToken);
			const out = models.map((m) => ({ ...m, baseUrl }));
			runtime.rememberCatalogModels(models.map((m) => m.id));
			try {
				await context?.store?.write({
					models: out,
					checkedAt: Date.now(),
				});
			} catch {
				/* best-effort: sin store, el catálogo vive hasta el reinicio */
			}
			dbg(`refreshModels: ${out.length} modelos del catálogo (persistidos en store)`);
			return out;
		},
	};
}
