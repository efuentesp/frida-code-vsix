/**
 * frida-agent-browser — Electron CDP helpers (Fase 7).
 *
 * Porte de electron/cdp.js del referencia: parsear/fetchear metadata del Chrome
 * DevTools Protocol de los lanzamientos Electron wrapper-owned (localhost
 * /json/version y /json/list). Endpoints malformados/inaccesibles → undefined
 * (no lanzar), igual que el referencia.
 */

export interface CdpVersion {
	browser?: string;
	protocolVersion?: string;
	userAgent?: string;
	v8Version?: string;
	webKitVersion?: string;
	webSocketDebuggerUrl?: string;
}

export interface CdpTarget {
	id?: string;
	title?: string;
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}

const ELECTRON_CDP_FETCH_TIMEOUT_MS = 1_000;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parsea /json/version (camelCase o Pascal-Case del CDP). */
export function parseCdpVersion(value: unknown): CdpVersion | undefined {
	if (!isRecord(value)) return undefined;
	return {
		browser: asString(value.Browser) ?? asString(value.browser),
		protocolVersion:
			asString(value["Protocol-Version"]) ?? asString(value.protocolVersion),
		userAgent: asString(value["User-Agent"]) ?? asString(value.userAgent),
		v8Version: asString(value["V8-Version"]) ?? asString(value.v8Version),
		webKitVersion:
			asString(value["WebKit-Version"]) ?? asString(value.webKitVersion),
		webSocketDebuggerUrl: asString(value.webSocketDebuggerUrl),
	};
}

/** Parsea /json/list (targets CDP). */
export function parseCdpTargets(value: unknown): CdpTarget[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((target) => ({
		id: asString(target.id),
		title: asString(target.title),
		type: asString(target.type),
		url: asString(target.url),
		webSocketDebuggerUrl: asString(target.webSocketDebuggerUrl),
	}));
}

export type CdpFetchFn = (url: string) => Promise<unknown>;

/** Fetch JSON del endpoint CDP (timeout corto; undefined si falla). */
export async function fetchCdpJson(
	url: string,
	fetchFn?: CdpFetchFn,
): Promise<unknown> {
	const fetch = fetchFn ?? (globalThis.fetch as unknown as CdpFetchFn);
	if (!fetch) return undefined;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		ELECTRON_CDP_FETCH_TIMEOUT_MS,
	);
	try {
		const response = await fetch(url);
		return response;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}

/** Lee /json/version + /json/list de un puerto CDP dado. */
export async function readCdpEndpoints(
	port: number,
	fetchFn?: CdpFetchFn,
): Promise<{ version?: CdpVersion; targets: CdpTarget[] }> {
	const version = parseCdpVersion(
		await fetchCdpJson(`http://127.0.0.1:${port}/json/version`, fetchFn),
	);
	const targets = parseCdpTargets(
		await fetchCdpJson(`http://127.0.0.1:${port}/json/list`, fetchFn),
	);
	return { version, targets };
}
