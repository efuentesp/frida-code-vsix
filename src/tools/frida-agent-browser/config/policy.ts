/**
 * frida-agent-browser — política de config (Fase 3).
 *
 * Porte de config-policy.js del referencia: tipos de config v1, clasificación de
 * fuente de credencial (literal/env/command), resolución de interpolaciones de env
 * (`$VAR`/`${VAR}` con escapes `$$`→`$`, `$!`→`!`), validación, merge por capas y
 * builders de guidance advisory para browser.defaultProfile / browser.executablePath
 * (porte de playbook.js — sin auto-inyectar flags; sólo orientan al agente).
 *
 * Las claves de webSearch son credential-like (se resuelven lazy en Fase 5); los
 * defaults de browser son advisory (se muestran crudos en la guidance).
 */

export const CONFIG_ENV = "PI_AGENT_BROWSER_CONFIG";
export const EXA_API_KEY_ENV = "EXA_API_KEY";
export const BRAVE_API_KEY_ENV = "BRAVE_API_KEY";
export const WEB_SEARCH_PROVIDERS = ["exa", "brave"] as const;
export const DEFAULT_WEB_SEARCH_PROVIDER = "exa";
export const WEB_SEARCH_PROVIDER_CONFIG_KEYS = {
	exa: "exaApiKey",
	brave: "braveApiKey",
} as const;
export const WEB_SEARCH_PROVIDER_ENV_VARS = {
	exa: EXA_API_KEY_ENV,
	brave: BRAVE_API_KEY_ENV,
} as const;

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];
export type BrowserProfilePolicy =
	| "explicit-only"
	| "authenticated-only"
	| "always";

export interface BrowserDefaultProfile {
	name: string;
	policy: BrowserProfilePolicy;
}
export interface WebSearchConfig {
	enabled?: boolean;
	preferredProvider?: WebSearchProvider;
	exaApiKey?: string;
	braveApiKey?: string;
}
export interface AgentBrowserConfig {
	version?: number;
	browser?: {
		defaultProfile?: BrowserDefaultProfile;
		executablePath?: string;
	};
	webSearch?: WebSearchConfig;
}

export type CredentialSourceKind = "literal" | "env" | "command";
export interface CredentialSource {
	kind: CredentialSourceKind;
	rawValue: string;
	scope?: string;
}

/** Clasifica un valor credential-like: `!cmd`→command, contiene `$`→env, resto→literal. */
export function classifyCredentialSource(
	rawValue: string,
	scope?: string,
): CredentialSource | undefined {
	const trimmed = rawValue.trim();
	if (trimmed === "") return undefined;
	if (trimmed.startsWith("!"))
		return { kind: "command", rawValue: trimmed, scope };
	if (trimmed.includes("$")) return { kind: "env", rawValue: trimmed, scope };
	return { kind: "literal", rawValue: trimmed, scope };
}

/**
 * Resuelve interpolaciones de env: `$VAR`, `${VAR}`. Escapes: `$$`→`$`, `$!`→`!`.
 * Devuelve undefined si una variable referenciada no existe (toda la resolución falla),
 * o si hay `${` sin cerrar. Porte fiel de resolveEnvInterpolations.
 */
export function resolveEnvInterpolations(
	rawValue: string,
	env: Record<string, string | undefined>,
): string | undefined {
	let output = "";
	for (let index = 0; index < rawValue.length; index += 1) {
		const char = rawValue[index];
		if (char !== "$") {
			output += char;
			continue;
		}
		const next = rawValue[index + 1];
		if (next === "$") {
			output += "$";
			index += 1;
			continue;
		}
		if (next === "!") {
			output += "!";
			index += 1;
			continue;
		}
		let name = "";
		if (next === "{") {
			const end = rawValue.indexOf("}", index + 2);
			if (end === -1) return undefined;
			name = rawValue.slice(index + 2, end);
			index = end;
		} else {
			const match = rawValue
				.slice(index + 1)
				.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
			if (!match) {
				output += "$";
				continue;
			}
			name = match[1] ?? "";
			index += name.length;
		}
		if (name === "") return undefined;
		const value = env[name];
		if (value === undefined) return undefined;
		output += value;
	}
	return output;
}

export interface ValidateResult {
	config: AgentBrowserConfig;
	errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valida la forma v1 de la config; acumula errores legibles. */
export function validateConfig(raw: unknown, path = "config"): ValidateResult {
	const errors: string[] = [];
	if (!isRecord(raw)) {
		errors.push(`${path} must contain a JSON object.`);
		return { config: {}, errors };
	}
	if (raw.version !== undefined && raw.version !== 1) {
		errors.push(`${path}.version must be 1 when present.`);
	}
	const config: AgentBrowserConfig = {};
	if (raw.browser !== undefined) {
		if (!isRecord(raw.browser)) {
			errors.push(`${path}.browser must be an object.`);
		} else {
			const browser: AgentBrowserConfig["browser"] = {};
			if (raw.browser.defaultProfile !== undefined) {
				const dp = raw.browser.defaultProfile;
				if (!isRecord(dp)) {
					errors.push(`${path}.browser.defaultProfile must be an object.`);
				} else {
					const name = typeof dp.name === "string" ? dp.name.trim() : "";
					if (name === "")
						errors.push(
							`${path}.browser.defaultProfile.name must not be blank.`,
						);
					const policy = typeof dp.policy === "string" ? dp.policy : undefined;
					const policies: BrowserProfilePolicy[] = [
						"explicit-only",
						"authenticated-only",
						"always",
					];
					if (policy && !policies.includes(policy as BrowserProfilePolicy)) {
						errors.push(
							`${path}.browser.defaultProfile.policy must be one of ${policies.join(", ")}.`,
						);
					}
					if (
						name &&
						(!policy || policies.includes(policy as BrowserProfilePolicy))
					) {
						browser.defaultProfile = {
							name,
							policy: (policy as BrowserProfilePolicy) ?? "explicit-only",
						};
					}
				}
			}
			if (raw.browser.executablePath !== undefined) {
				if (typeof raw.browser.executablePath !== "string") {
					errors.push(`${path}.browser.executablePath must be a string.`);
				} else {
					browser.executablePath = raw.browser.executablePath.trim();
				}
			}
			config.browser = browser;
		}
	}
	if (raw.webSearch !== undefined) {
		if (!isRecord(raw.webSearch)) {
			errors.push(`${path}.webSearch must be an object.`);
		} else {
			const ws: WebSearchConfig = {};
			if (raw.webSearch.enabled !== undefined) {
				if (typeof raw.webSearch.enabled !== "boolean")
					errors.push(`${path}.webSearch.enabled must be a boolean.`);
				else ws.enabled = raw.webSearch.enabled;
			}
			if (raw.webSearch.preferredProvider !== undefined) {
				const pp = raw.webSearch.preferredProvider;
				if (
					typeof pp !== "string" ||
					!WEB_SEARCH_PROVIDERS.includes(pp as never)
				) {
					errors.push(
						`${path}.webSearch.preferredProvider must be one of ${WEB_SEARCH_PROVIDERS.join(", ")}.`,
					);
				} else ws.preferredProvider = pp as WebSearchProvider;
			}
			for (const provider of WEB_SEARCH_PROVIDERS) {
				const key = WEB_SEARCH_PROVIDER_CONFIG_KEYS[provider];
				if (raw.webSearch[key] !== undefined) {
					if (typeof raw.webSearch[key] !== "string") {
						errors.push(`${path}.webSearch.${key} must be a string.`);
					} else {
						ws[key] = raw.webSearch[key];
					}
				}
			}
			config.webSearch = ws;
		}
	}
	return { config, errors };
}

/** Merge profundo: la capa override gana para escalares; sub-objetos se fusionan. */
export function mergeConfig(
	base: AgentBrowserConfig,
	override: AgentBrowserConfig,
): AgentBrowserConfig {
	const out: AgentBrowserConfig = { ...base };
	if (override.version !== undefined) out.version = override.version;
	if (override.browser) {
		out.browser = {
			...(base.browser ?? {}),
			...override.browser,
			defaultProfile:
				override.browser.defaultProfile ?? base.browser?.defaultProfile,
		};
	}
	if (override.webSearch) {
		out.webSearch = { ...(base.webSearch ?? {}), ...override.webSearch };
	}
	return out;
}

// ── Guidance advisory (porte de playbook.js — NO auto-inyecta flags) ──

export function buildExecutablePathGuideline(
	executablePath: string | undefined,
): string | undefined {
	if (!executablePath) return undefined;
	return `agent_browser config sets browser.executablePath to ${JSON.stringify(executablePath)}; for fresh browser launches that should use that Chromium-compatible executable, add --executable-path ${JSON.stringify(executablePath)} with sessionMode:fresh.`;
}

export function buildDefaultProfileGuideline(
	profile: BrowserDefaultProfile | undefined,
): string | undefined {
	if (!profile || profile.policy === "explicit-only") return undefined;
	if (profile.policy === "always") {
		return `agent_browser config sets browser.defaultProfile.name to ${JSON.stringify(profile.name)} with policy always; use --profile ${JSON.stringify(profile.name)} with sessionMode:fresh when a fresh browser launch should use the configured profile, and treat profile content as model-visible user data.`;
	}
	return `agent_browser config sets browser.defaultProfile.name to ${JSON.stringify(profile.name)}; for signed-in/account-specific browser tasks, start with --profile ${JSON.stringify(profile.name)} plus sessionMode:fresh unless the user asks for a different profile.`;
}
