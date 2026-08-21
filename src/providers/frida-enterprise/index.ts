// Barrel público del provider Frida Enterprise (ADR-1002).
//
// UNA instancia de runtime compartida por oauth (getApiKey) y hooks
// (before_provider_request): mismo ciclo de vida que el registro en
// ModelRuntime. El wiring del host (pi-session.ts / extension.ts) importa
// SÓLO de aquí y con los MISMOS nombres que usaba el monolito original —
// la migración ADR-1002 no toca ni una línea de wiring.
// Borrar esta carpeta + los 7 puntos de wiring del ADR remueve el provider
// sin dejar rastro en los demás proveedores.

import { createFridaEnterpriseRuntime } from "./runtime";
import { VERIFIED_MODEL_IDS } from "./catalog";
import { patchFridaSideChannels } from "./side-channels";
export {
	patchFridaSideChannels,
	type FridaSideChannelDeps,
} from "./side-channels";
import type { FridaEnterpriseRuntime } from "./runtime";
import { buildFridaEnterpriseProviderConfig as buildProviderConfigInner } from "./provider";
import { createFridaEnterpriseHooks as createHooksInner } from "./hooks";
import {
	buildFridaEnterpriseOAuth as buildOAuthInner,
	FRIDA_ENTERPRISE_PROVIDER,
} from "./oauth";

// Semilla del gate Errata-7: los 32 verificados conocidos desde el arranque.
const runtime = createFridaEnterpriseRuntime(VERIFIED_MODEL_IDS);

/** Errata-9: el compact/branch-summary llama streamSimple SIN onPayload
 *  (agent.streamFunction de sdk.js no lo cablea). El host invoca esto justo
 *  tras registerProvider (wiring #8) para cubrir ese canal lateral. */
export function patchFridaSideChannelsOn(modelRuntime: any): void {
	patchFridaSideChannels(modelRuntime, {
		runtime,
		isFridaModel: (m: any) =>
			m?.provider === FRIDA_ENTERPRISE_PROVIDER || runtime.knowsModel(m?.id),
	});
}
// Prueba de vida del bundle: aparece al cargar la extensión.
import { dbg } from "./runtime";
dbg("bundle del provider cargado (index.ts) — esperando eventos");

export {
	FRIDA_ENTERPRISE_PROVIDER,
	FRIDA_ENTERPRISE_PROVIDER_DISPLAY,
	parseCallbackInput,
	makePkcePair,
	makeState,
	fetchEnvVars,
	type FridaEnvVars,
	type FridaEnterpriseCredential,
	type OAuthLoginCallbacks,
} from "./oauth";

export {
	buildFallbackCatalog,
	fetchFridaEnterpriseModels,
	VERIFIED_MODEL_IDS,
	SELECTED_MODEL_IDS,
	type FridaEnterpriseModelConfig,
} from "./catalog";

export {
	buildFridaPayload,
	translateFridaResponse,
	translateFridaStreamChunk,
	classifyGatewayError,
	endpointForCapabilities,
	identityFromToken,
	modelClass,
	reasoningEffortTag,
	payloadShapeTag,
	toProviderModel,
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_TOKENS,
	type FridaIdentity,
	type FridaEndpoint,
	type FridaGatewayError,
} from "./adapter";

export {
	createFridaEnterpriseRuntime,
	type FridaEnterpriseRuntime,
} from "./runtime";
export {
	summarizeMessageEnd,
	type FridaEnterpriseProviderDeps,
} from "./hooks";

/** Config para modelRuntime.registerProvider(FRIDA_ENTERPRISE_PROVIDER, …). */
export function buildFridaEnterpriseProviderConfig() {
	return buildProviderConfigInner(runtime);
}

/** Hooks para extensionFactories (sesión principal e hijas de workflow).
 * `runtime` opcional permite a las E2E/embedders conectar explícitamente la
 * misma instancia que usa OAuth; el host normal omite el argumento y usa el
 * singleton del barrel. Nunca se crea una segunda instancia accidentalmente. */
export function createFridaEnterpriseHooks(deps: {
	onUnauthorized: () => void;
	runtime?: FridaEnterpriseRuntime;
}) {
	return createHooksInner({ ...deps, runtime: deps.runtime ?? runtime });
}

/** OAuth del provider (comparte runtime con los hooks). */
export function buildFridaEnterpriseOAuth(
	runtimeOverride?: FridaEnterpriseRuntime,
) {
	return buildOAuthInner(runtimeOverride ?? runtime);
}
