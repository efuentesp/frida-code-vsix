// Barrel público del provider frida-antigravity (#97).
//
// Port de pi-antigravity v0.3.1 (Rahul Arya, MIT) a la arquitectura de
// providers de Frida (mismo patrón de registro que frida-enterprise, ADR-1002).
// Los módulos internos (auth/client/stream/models/usage/diagnostics/types/
// utils) son un port fiel del upstream — se mantienen los comentarios en
// inglés originales para facilitar diffs contra futuras versiones de
// pi-antigravity.
//
// Conexión con Google Antigravity / Cloud Code Assist:
//  - OAuth 2.0 Auth-Code + PKCE contra accounts.google.com con servidor de
//    callback local en localhost:51121 (solo loopback).
//  - Streaming nativo SSE (Gemini) + puente custom-tools para Claude/GPT-OSS.
//  - Discovery de projectId (loadCodeAssist) y de modelos dinámicos.
//
// El registro vive en pi-session.ts: modelRuntime.registerProvider(..., config)
// con oauth + streamSimple propios. El wiring del host importa SOLO de aquí.

import { getApiKey, loginAntigravity, refreshAntigravityToken } from "./auth/oauth";
import { DEFAULT_ENDPOINT } from "./client/client";
import { ANTIGRAVITY_MODELS, PROVIDER_ID, PROVIDER_NAME } from "./models/models";
import { streamAntigravity } from "./stream/stream";

/** ProviderConfigInput para modelRuntime.registerProvider(ANTIGRAVITY_PROVIDER, …).
 *  api/custom "antigravity-api": el transporte completo lo hace streamSimple
 *  propio (headers Google incluidos), el SDK nunca arma la petición. */
export function buildAntigravityProviderConfig() {
	return {
		name: PROVIDER_NAME,
		baseUrl: DEFAULT_ENDPOINT,
		// Api id custom no incluido en el union Api del SDK — el streamSimple
		// propio consume el request completo, el id sólo etiqueta.
		api: "antigravity-api" as any,
		// Los headers (Bearer + X-Goog-Api-Client + Client-Metadata) los
		// construye streamAntigravity; el SDK no debe inyectar Authorization.
		authHeader: false,
		models: ANTIGRAVITY_MODELS as any,
		oauth: {
			name: PROVIDER_NAME,
			// Antigravity/Cloud Code Assist factura por suscripción de Google,
			// no por token — paridad con el flag de Copilot.
			isSubscription: true,
			login: loginAntigravity,
			refreshToken: refreshAntigravityToken,
			getApiKey,
		},
		streamSimple: streamAntigravity as any,
	};
}

export {
	getApiKey,
	loginAntigravity,
	refreshAntigravityToken,
	REDIRECT_URI,
	AUTH_URL,
	TOKEN_URL,
	SCOPES,
} from "./auth/oauth";

export {
	DEFAULT_ENDPOINT,
	ENDPOINT_FALLBACKS,
	parseApiKey,
	loadCodeAssist,
	resolveProjectId,
	stableProjectId,
	defaultProjectId,
	fetchAvailableRuntimeModel,
	clearModelCache,
	clearProjectCache,
} from "./client/client";

export {
	ANTIGRAVITY_MODELS,
	ANTIGRAVITY_ROUTING,
	RUNTIME_MAX_OUTPUT_TOKENS,
	getAntigravityRequestModelId,
	getFallbackRuntimeModel,
	getMaxOutputTokens,
} from "./models/models";

export {
	streamAntigravity,
	convertMessages,
	convertTools,
	buildRequest,
	mapStopReason,
	friendlyAntigravityError,
} from "./stream/stream";

export {
	fetchAccountUsage,
	formatModelsList,
	formatUsageSummary,
} from "./usage/usage";

export {
	getLastDiagnostics,
	resetDiagnosticsForTests,
	type DiagnosticsSnapshot,
} from "./diagnostics/diagnostics";

export {
	redactSecrets,
	maskEmail,
	safeError,
	assertSafeApiBaseUrl,
	resolveCallbackHost,
} from "./utils/security";

export { antigravityEnv, isRecord, sanitizeText } from "./utils/util";

export { PROVIDER_ID as ANTIGRAVITY_PROVIDER, PROVIDER_NAME as ANTIGRAVITY_PROVIDER_DISPLAY };
