// Registry de proveedores de tipo API-key (ADR-0017 + ADR-0018). Cada proveedor
// tiene su propia llave en el SecretStorage y su propio cache en memoria. Esta es
// la lista EXPLÍCITA que lista el selector de Frida (ADR-0018: NO se hace discovery
// de los 39 built-ins de pi-ai; para añadir un proveedor se edita este archivo y se
// recompila el vsix).
//
// CÓMO AÑADIR UN PROVEEDOR:
//  • BUILT-IN de pi-ai (openai, anthropic, groq, deepseek, xai…): 1 entrada aquí
//    { id, displayName, secretKey, authMode:"bearer" }. NO necesita providers/<id>.ts
//    ni registerProvider (el SDK ya lo carga). Sólo setRuntimeApiKey(id, key) con la
//    key del SecretStorage al arrancar. (zai es así; su z-ai-provider.ts sólo aporta
//    discoverZaiModels para exploración opcional.)
//  • CUSTOM con lógica especial (X-Api-Key, dump requests, compat): 1 entrada aquí
//    + archivo providers/<id>-provider.ts (registerProvider + hooks). softtek-devengine
//    es el único caso hoy (ADR-0009).
//
// Este módulo da el mapeo id → {secretKey, displayName, authMode} para que el host
// itere al cargar/guardar keys y poblar el onboarding/selector.

import {
	MOONSHOT_PROVIDER,
	MOONSHOT_PROVIDER_DISPLAY,
} from "./moonshot-provider";
import { SOFTTEK_PROVIDER, SOFTTEK_PROVIDER_DISPLAY } from "./softtek-provider";
import { ZAI_PROVIDER, ZAI_PROVIDER_DISPLAY } from "./z-ai-provider";

export interface ApiKeyProviderDef {
	id: string;
	displayName: string;
	/** Llave del SecretStorage (context.secrets) donde vive la API key. */
	secretKey: string;
	/** Método de auth: 'bearer' (OpenAI estándar) o 'x-api-key' (custom gateway). */
	authMode: "bearer" | "x-api-key";
}

/** Lista ordenada (orden del onboarding / selector). */
export const API_KEY_PROVIDERS: readonly ApiKeyProviderDef[] = [
	{
		id: SOFTTEK_PROVIDER,
		displayName: SOFTTEK_PROVIDER_DISPLAY,
		secretKey: "frida.devengineKey",
		authMode: "x-api-key",
	},
	{
		id: ZAI_PROVIDER,
		displayName: ZAI_PROVIDER_DISPLAY,
		secretKey: "frida.zaiKey",
		authMode: "bearer",
	},
	{
		id: MOONSHOT_PROVIDER,
		displayName: MOONSHOT_PROVIDER_DISPLAY,
		secretKey: "frida.moonshotKey",
		authMode: "bearer",
	},
];

/** Sólo los ids (para iterar carga de keys, auth-check, etc.). */
export const API_KEY_PROVIDER_IDS: readonly string[] = API_KEY_PROVIDERS.map(
	(p) => p.id,
);

export function getApiKeyProvider(id: string): ApiKeyProviderDef | undefined {
	return API_KEY_PROVIDERS.find((p) => p.id === id);
}
