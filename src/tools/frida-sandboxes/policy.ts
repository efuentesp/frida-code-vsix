/**
 * frida-sandboxes — policy in-container (issue #35, ADR-0047 D4).
 *
 * Porte de la capa de policy de pi-sandbox (carderne, MIT): las funciones
 * puras de policy.ts (shouldPromptForWrite, extractDomainsFromCommand,
 * domainMatchesPattern, domainIsAllowed, expandPath) + resolveAllowances de
 * sandbox-runtime.ts, aplicadas DENTRO del container (el container es el
 * boundary; la policy refina qué puede tocar el agente ahí).
 *
 * No portamos el sandbox-runtime OS (D4): para Docker, el container provee
 * el aislamiento nativo.
 */

/** Config de policy por sandbox (settings frida.sandboxes.*). */
export interface SandboxPolicy {
	/** Dominios de red permitidos (patrones glob: *.npmjs.org). Vacío = todo. */
	allowDomains?: string[];
	/** Rutas dentro del container que el agente puede escribir. Default: /workspace. */
	writePaths?: string[];
	/** Bloquear comandos destructivos fuera de writePaths (rm -rf, etc.). */
	blockDestructiveOutsideWorkspace?: boolean;
}

export const DEFAULT_POLICY: SandboxPolicy = {
	allowDomains: [],
	writePaths: ["/workspace", "/tmp"],
	blockDestructiveOutsideWorkspace: true,
};

export interface PolicyViolation {
	/** Regla violada (para mensaje honesto al agente). */
	rule: "domain" | "write-path";
	message: string;
}

/**
 * Extrae dominios de un comando shell (patrón pi-sandbox policy.ts):
 * busca hosts en curl/wget/ping/nc/ssh/git-remote y hosts crudos.
 */
export function extractDomainsFromCommand(command: string): string[] {
	const domains = new Set<string>();
	// URL-like: https://host/... o user@host:... (scp-style)
	const urlRe = /(?:https?:\/\/|git@|ssh:\/\/)[^\s/"']+([:/][^\s]*)?/g;
	for (const m of command.matchAll(urlRe)) {
		const host = m[0]
			.replace(/^https?:\/\//, "")
			.replace(/^git@/, "")
			.replace(/^ssh:\/\//, "")
			.split(/[:/]/)[0];
		if (host) domains.add(host);
	}
	// ping/nc/curl con host crudo como primer arg
	const cmdRe = /(?:^|\s)(?:ping|nc|netcat|host|dig)\s+([^\s]+)/g;
	for (const m of command.matchAll(cmdRe)) {
		if (!m[1].startsWith("-")) domains.add(m[1]);
	}
	return [...domains];
}

/** Match de dominio contra patrón glob (*.npmjs.org matchea registry.npmjs.org). */
export function domainMatchesPattern(domain: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.startsWith("*.")) {
		const suffix = pattern.slice(1); // ".npmjs.org"
		return domain.endsWith(suffix) || domain === pattern.slice(2);
	}
	return domain === pattern;
}

/** ¿Dominio permitido por la allowlist? Vacía = todo permitido. */
export function domainIsAllowed(
	domain: string,
	allowDomains: string[],
): boolean {
	if (!allowDomains.length) return true;
	return allowDomains.some((p) => domainMatchesPattern(domain, p));
}

/** Expande ~ y normaliza rutas del container (patrón pi-sandbox expandPath). */
export function expandPath(p: string): string {
	if (p === "~") return "/root";
	if (p.startsWith("~/")) return "/root" + p.slice(1);
	return p;
}

/** Rutas que un comando toca con escritura (heurística: rm/mv/tee/redirect). */
export function detectWriteTargets(command: string): string[] {
	const targets = new Set<string>();
	// rm/mkdir/mv/chmod destino + redirect > file
	const rmRe = /(?:^|\s)(?:rm|mkdir|mv|cp|tee|truncate|chmod|chown)\s+(?:-[a-zA-Z]+\s+)*([^\s;|&>]+)/g;
	for (const m of command.matchAll(rmRe)) {
		if (!m[1].startsWith("-")) targets.add(expandPath(m[1]));
	}
	const redirRe = />>?\s*([^\s;|&]+)/g;
	for (const m of command.matchAll(redirRe)) {
		targets.add(expandPath(m[1]));
	}
	return [...targets];
}

/**
 * ¿Escribir en `target` requiere prompt/bloqueo? (shouldPromptForWrite de
 * pi-sandbox, adaptado): fuera de writePaths = violación.
 */
export function shouldBlockWrite(
	target: string,
	policy: SandboxPolicy,
): boolean {
	if (!policy.blockDestructiveOutsideWorkspace) return false;
	const writePaths = policy.writePaths ?? DEFAULT_POLICY.writePaths!;
	const t = expandPath(target);
	return !writePaths.some((w) => t === w || t.startsWith(w.replace(/\/$/, "") + "/"));
}

/** Valida un comando contra la policy — devuelve violaciones (vacío = ok). */
export function checkCommand(
	command: string,
	policy: SandboxPolicy,
): PolicyViolation[] {
	const violations: PolicyViolation[] = [];
	for (const d of extractDomainsFromCommand(command)) {
		if (!domainIsAllowed(d, policy.allowDomains ?? [])) {
			violations.push({
				rule: "domain",
				message: `Dominio no permitido: ${d} (allowlist: ${
					(policy.allowDomains ?? []).join(", ") || "configúrala"
				})`,
			});
		}
	}
	for (const t of detectWriteTargets(command)) {
		if (shouldBlockWrite(t, policy)) {
			violations.push({
				rule: "write-path",
				message: `Escritura fuera de las rutas permitidas: ${t} (permitidas: ${(policy.writePaths ?? []).join(", ")})`,
			});
		}
	}
	return violations;
}

/**
 * resolveAllowances (patrón sandbox-runtime.ts): resume la config efectiva
 * para mostrarla en el panel/agent.
 */
export function resolveAllowances(policy: SandboxPolicy): {
	domains: string;
	writePaths: string;
} {
	return {
		domains: (policy.allowDomains ?? []).length
			? (policy.allowDomains ?? []).join(", ")
			: "* (sin restricción)",
		writePaths: (policy.writePaths ?? []).join(", ") || "/workspace",
	};
}
