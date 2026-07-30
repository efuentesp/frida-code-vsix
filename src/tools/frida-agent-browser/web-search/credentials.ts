/**
 * frida-agent-browser — web_search: resolución de credenciales (Fase 5).
 *
 * Porte de config.js + config-policy.js del referencia: resuelve la credencial del
 * proveedor (Exa/Brave) desde config (literal/`$ENV`/`!command`) con fallback a
 * `EXA_API_KEY`/`BRAVE_API_KEY`, eligiendo el proveedor preferido o el solicitado.
 * `!command` se resuelve LAZY (sólo al ejecutar, vía exec) para no ralentizar el
 * arranque ni exponer secrets en el catálogo.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { ConfigState } from "../config/load";
import {
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_PROVIDERS,
	WEB_SEARCH_PROVIDER_CONFIG_KEYS,
	WEB_SEARCH_PROVIDER_ENV_VARS,
	classifyCredentialSource,
	resolveEnvInterpolations,
	type CredentialSource,
} from "../config/policy";
import type { WebSearchProvider } from "./providers";

const exec = promisify(execCb);
const SECRET_COMMAND_TIMEOUT_MS = 15_000;

/** Resolvedor de `!command` (inyectable para tests). */
export type CommandResolver = (
	command: string,
	signal?: AbortSignal,
) => Promise<string | undefined>;

export const defaultCommandResolver: CommandResolver = async (
	command,
	signal,
) => {
	const trimmed = command.trim();
	if (trimmed === "") return undefined;
	try {
		const result = await exec(trimmed, {
			signal,
			timeout: SECRET_COMMAND_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		});
		const value = result.stdout.trim();
		return value.length > 0 ? value : undefined;
	} catch (error) {
		if (signal?.aborted) throw error;
		// No exponemos el output del comando fallido (puede contener secretos).
		throw new Error(
			"Credential command failed without exposing command output. Check the configured secret manager command.",
		);
	}
};

export interface ResolveCredentialOptions {
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
	commandResolver?: CommandResolver;
}

/** Resuelve un CredentialSource a su valor (literal/env/command). */
export async function resolveCredentialSource(
	source: CredentialSource,
	opts: ResolveCredentialOptions = {},
): Promise<string | undefined> {
	const env = opts.env ?? process.env;
	if (source.kind === "command") {
		const cmd = source.rawValue.slice(1).trim();
		return (opts.commandResolver ?? defaultCommandResolver)(cmd, opts.signal);
	}
	if (source.kind === "env") {
		const resolved = resolveEnvInterpolations(source.rawValue, env);
		return resolved?.trim();
	}
	return source.rawValue.trim();
}

/** Orden de proveedores a intentar (preferido/solicitado primero). */
export function getProviderOrder(
	state: ConfigState,
	requested?: string,
): WebSearchProvider[] {
	if (
		requested &&
		requested !== "auto" &&
		(WEB_SEARCH_PROVIDERS as readonly string[]).includes(requested)
	) {
		return [requested as WebSearchProvider];
	}
	const pref =
		state.config.webSearch?.preferredProvider ?? DEFAULT_WEB_SEARCH_PROVIDER;
	return pref === "brave" ? ["brave", "exa"] : ["exa", "brave"];
}

/** Fuente de credencial para un proveedor: config key (clasificada) o env fallback. */
export function getWebSearchCredentialSource(
	state: ConfigState,
	provider: WebSearchProvider,
	env: Record<string, string | undefined>,
): CredentialSource | undefined {
	const configKey = WEB_SEARCH_PROVIDER_CONFIG_KEYS[provider];
	const raw = state.config.webSearch?.[configKey];
	if (typeof raw === "string" && raw.trim() !== "")
		return classifyCredentialSource(raw, "config");
	const envVar = WEB_SEARCH_PROVIDER_ENV_VARS[provider];
	const envRaw = env[envVar];
	if (typeof envRaw === "string" && envRaw.trim() !== "")
		return classifyCredentialSource(envRaw, "env");
	return undefined;
}

/** ¿Hay alguna fuente de credencial disponible (para registrar el tool)? */
export function canRegisterWebSearch(
	state: ConfigState,
	env: Record<string, string | undefined>,
): boolean {
	if (state.errors.length > 0) return false;
	if (!state.webSearchEnabled) return false;
	return WEB_SEARCH_PROVIDERS.some(
		(p) => getWebSearchCredentialSource(state, p, env) !== undefined,
	);
}

export interface ResolvedCredential {
	provider: WebSearchProvider;
	credential: { source: CredentialSource; value: string };
}

/** Resuelve la credencial preferida/disponible (lazy para command). */
export async function resolvePreferredCredential(
	state: ConfigState,
	opts: ResolveCredentialOptions & { provider?: string } = {},
): Promise<ResolvedCredential | undefined> {
	if (!state.webSearchEnabled || state.errors.length > 0) return undefined;
	const env = opts.env ?? process.env;
	for (const provider of getProviderOrder(state, opts.provider)) {
		const source = getWebSearchCredentialSource(state, provider, env);
		if (!source) continue;
		const value = await resolveCredentialSource(source, opts);
		if (value) return { provider, credential: { source, value } };
	}
	return undefined;
}

/** Error agent-friendly cuando no hay credencial disponible. */
export function buildMissingCredentialError(requestedProvider: string): string {
	const hint =
		requestedProvider && requestedProvider !== "auto"
			? ` for provider "${requestedProvider}"`
			: "";
	return (
		`agent_browser_web_search is not configured${hint}. Set webSearch.exaApiKey or webSearch.braveApiKey ` +
		"in ~/.frida/config/frida-agent-browser/config.json (literal, $ENV, ${ENV}, or !command), " +
		"or export EXA_API_KEY / BRAVE_API_KEY, then reload."
	);
}
