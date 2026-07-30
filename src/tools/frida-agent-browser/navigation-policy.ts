/**
 * frida-agent-browser — política de navegación / allowed-domains (Fase 8).
 *
 * Porte fiel de navigation-policy.js del referencia: parsea `--allowed-domains` del
 * argv y, como DEFENSE IN DEPTH, verifica que el host de la URL final de una navegación
 * esté en la lista. El containment fuerte (request/worker/popup/WebRTC) lo hace el
 * binario upstream (0.32+); el wrapper sólo reporta si la página aterrizó fuera del
 * allowlist.
 */

export interface AllowedDomainsPolicy {
	allowedDomains: string[];
	display: string;
}

export interface AllowedDomainsViolation {
	allowedDomains: string[];
	allowedDisplay: string;
	observedHost: string;
	observedUrl: string;
	summary: string;
}

function normalizeDomainEntry(value: string): string | undefined {
	let candidate = value.trim().toLowerCase();
	if (candidate === "") return undefined;
	try {
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
			candidate = new URL(candidate).hostname;
		}
	} catch {
		return undefined;
	}
	candidate = candidate.replace(/^\*\./, "").replace(/\.$/, "");
	if (candidate.includes("/")) candidate = candidate.split("/")[0] ?? "";
	if (candidate.includes(":")) candidate = candidate.split(":")[0] ?? "";
	return candidate.length > 0 ? candidate : undefined;
}

function splitAllowedDomainsValue(value: string): string[] {
	return value
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/** Extrae la política --allowed-domains del argv (o undefined si no hay). */
export function parseAllowedDomainsPolicyFromArgs(
	args: string[],
): AllowedDomainsPolicy | undefined {
	const domains: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--allowed-domains") {
			const value = args[index + 1];
			if (value && !value.startsWith("-")) {
				domains.push(...splitAllowedDomainsValue(value));
				index += 1;
			}
			continue;
		}
		if (arg?.startsWith("--allowed-domains=")) {
			domains.push(
				...splitAllowedDomainsValue(arg.slice("--allowed-domains=".length)),
			);
		}
	}
	const allowedDomains = [
		...new Set(
			domains.flatMap((domain) => {
				const normalized = normalizeDomainEntry(domain);
				return normalized ? [normalized] : [];
			}),
		),
	];
	if (allowedDomains.length === 0) return undefined;
	return { allowedDomains, display: allowedDomains.join(", ") };
}

function normalizeObservedHost(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return undefined;
		return parsed.hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return undefined;
	}
}

/** ¿Host permitido? (coincide exacto o es subdominio .<domain>). */
export function isHostAllowedByDomains(
	host: string,
	allowedDomains: string[],
): boolean {
	const normalizedHost = host.toLowerCase().replace(/\.$/, "");
	return allowedDomains.some(
		(domain) =>
			normalizedHost === domain || normalizedHost.endsWith(`.${domain}`),
	);
}

/** Violación si la URL final cae fuera del allowlist (defense in depth). */
export function getAllowedDomainsViolation(options: {
	policy?: AllowedDomainsPolicy;
	url?: string;
}): AllowedDomainsViolation | undefined {
	if (!options.policy || !options.url) return undefined;
	const observedHost = normalizeObservedHost(options.url);
	if (!observedHost) return undefined;
	if (isHostAllowedByDomains(observedHost, options.policy.allowedDomains))
		return undefined;
	return {
		allowedDomains: options.policy.allowedDomains,
		allowedDisplay: options.policy.display,
		observedHost,
		observedUrl: options.url,
		summary: `Navigation policy blocked: --allowed-domains ${options.policy.display} does not allow ${observedHost} (${options.url}).`,
	};
}
