// OAuth corporativo Frida Enterprise (ADR-1001 §Flujo de login, ADR-1002).
//
// PKCE S256 contra el portal SSO → custom_token → sesión Firebase (~1h) →
// get-env-vars (COMPATIBLE_API_URL + MODEL1..4). Los tokens rotan solos vía
// securetoken; pi-ai persiste la credential en ~/.frida/auth.json.
//
// ⚠ redirect_uri de la URL de login viaja BASE64URL (el portal SPA lo decodifica
// con atob y descarta los params si falla — Errata-1); el exchange POST lo
// espera CRUDO. Verificado en vivo (2026-08-15).

import { createHash, randomBytes } from "node:crypto";
import type { FridaEnterpriseRuntime } from "./runtime";

export const FRIDA_ENTERPRISE_PROVIDER = "frida-enterprise";
export const FRIDA_ENTERPRISE_PROVIDER_DISPLAY = "Frida Enterprise";

const OAUTH = {
	loginUrl: "https://extension.enterprise.fridaplatform.online/login",
	tokenUrl:
		"https://azf-fridagpt-extension-auth.azurewebsites.net/auth/enterprise/token",
	redirectUri: "vscode://fridaplatform.frida-extension",
} as const;

const FIREBASE = {
	apiKey: "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w",
	signInWithCustomToken:
		"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
	secureToken: "https://securetoken.googleapis.com/v1/token",
} as const;

const BACKEND = {
	exchangeToken:
		"https://azf-frida-genai-suite-auth.azurewebsites.net/auth/token",
	getEnvVars:
		"https://frida-extension-enterprise-backend.azurewebsites.net/vscode/get-env-vars",
} as const;

/** Margen de seguridad: refrescar 2 min antes de la expiración real. */
const EXPIRY_SAFETY_MS = 2 * 60 * 1000;

// ─── PKCE (idéntico a Dfe/RYt/PYt/NYt del bundle original) ────────────────────

function b64url(input: Buffer | string): string {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function makePkcePair(): {
	codeVerifier: string;
	codeChallenge: string;
} {
	const codeVerifier = b64url(randomBytes(32));
	const codeChallenge = b64url(
		createHash("sha256").update(codeVerifier).digest(),
	);
	return { codeVerifier, codeChallenge };
}

export function makeState(): string {
	return b64url(randomBytes(32));
}

/** Extrae el `code` de lo pegado por el usuario: URL de callback completa
 *  (vscode://…?code=…&state=… o …/redirect?…code=…), otra URL con query, o el
 *  code pelado. */
export function parseCallbackInput(raw: string): string {
	const input = String(raw ?? "").trim();
	if (!input) throw new Error("No se recibió código de autorización.");
	const qIndex = input.indexOf("?");
	if (qIndex >= 0) {
		const code = new URLSearchParams(input.slice(qIndex + 1)).get("code");
		if (code) return code;
	}
	if (!/\s/.test(input) && input.length > 8) return input;
	throw new Error(
		"No pude extraer el 'code'. Pega la URL completa que abrió el navegador (vscode://fridaplatform.frida-extension?code=…).",
	);
}

// ─── HTTP (mismos contratos que el bundle original) ───────────────────────────

async function postJSON<T = any>(
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body ?? {}),
	});
	const text = await res.text();
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	if (!res.ok) {
		const detail =
			json?.error?.message ??
			json?.error_description ??
			json?.message ??
			text.slice(0, 300);
		throw new Error(`${url} → HTTP ${res.status}: ${String(detail)}`);
	}
	return json as T;
}

interface FirebaseSession {
	idToken: string;
	refreshToken: string;
	expiresInSec: number;
}

async function signInWithCustomToken(customToken: string): Promise<FirebaseSession> {
	const r = await postJSON<{
		idToken?: string;
		refreshToken?: string;
		expiresIn?: string;
	}>(
		`${FIREBASE.signInWithCustomToken}?key=${FIREBASE.apiKey}`,
		{ token: customToken, returnSecureToken: true },
	);
	if (!r.idToken || !r.refreshToken) {
		throw new Error(
			"signInWithCustomToken: respuesta sin idToken/refreshToken (¿custom_token inválido?).",
		);
	}
	return {
		idToken: r.idToken,
		refreshToken: r.refreshToken,
		expiresInSec: Number(r.expiresIn ?? 3600) || 3600,
	};
}

async function refreshFirebaseToken(refreshToken: string): Promise<FirebaseSession> {
	// securetoken espera form-urlencoded (no JSON).
	const res = await fetch(`${FIREBASE.secureToken}?key=${FIREBASE.apiKey}`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});
	const json: any = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(
			`securetoken refresh → HTTP ${res.status}: ${json?.error?.message ?? ""}`,
		);
	}
	return {
		idToken: json.id_token,
		refreshToken: json.refresh_token,
		expiresInSec: Number(json.expires_in ?? 3600) || 3600,
	};
}

export interface FridaEnvVars {
	COMPATIBLE_API_URL?: string;
	MODEL1?: string;
	MODEL2?: string;
	MODEL3?: string;
	MODEL4?: string;
	[key: string]: string | undefined;
}

/** idToken → access_token de backend → get-env-vars. Best-effort en el login
 *  (el selector vive sin él); se reintenta en cada refreshToken si falta. */
export async function fetchEnvVars(idToken: string): Promise<FridaEnvVars> {
	const auth = await postJSON<{ access_token?: string }>(
		BACKEND.exchangeToken,
		{ id_token: idToken },
	);
	const env = await postJSON<{ env_vars?: FridaEnvVars }>(
		BACKEND.getEnvVars,
		{},
		{ Authorization: `Bearer ${auth.access_token ?? ""}` },
	);
	return env.env_vars ?? {};
}

// ─── Credential (OAuthCredentials de pi-ai + campos extra persistidos) ────────

export interface FridaEnterpriseCredential {
	access: string;
	refresh: string;
	expires: number;
	compatibleApiUrl?: string;
	envVars?: FridaEnvVars;
	[key: string]: unknown;
}

function credentialExpiry(session: FirebaseSession): number {
	return Date.now() + session.expiresInSec * 1000 - EXPIRY_SAFETY_MS;
}

// ─── OAuth (contrato ProviderConfig.oauth de pi) ──────────────────────────────

/** Callbacks que pi-coding-agent adapta desde makeAuthInteraction() del host
 *  (extension.ts). onAuth abre el navegador; onManualCodeInput abre el InputBox. */
export interface OAuthLoginCallbacks {
	onAuth(info: { url: string; instructions?: string }): void;
	onDeviceCode(info: {
		userCode: string;
		verificationUri: string;
	}): void;
	onPrompt(prompt: {
		message: string;
		placeholder?: string;
	}): Promise<string>;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onSelect?(prompt: {
		message: string;
		options: Array<{ id: string; label: string }>;
	}): Promise<string | undefined>;
	signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new Error("Login cancelado.");
}

export function buildFridaEnterpriseOAuth(runtime: FridaEnterpriseRuntime) {
	return {
		name: FRIDA_ENTERPRISE_PROVIDER_DISPLAY,

		async login(
			callbacks: OAuthLoginCallbacks,
		): Promise<FridaEnterpriseCredential> {
			const state = makeState();
			const { codeVerifier, codeChallenge } = makePkcePair();
			// redirect_uri base64url, NO crudo — ver comentario junto a OAUTH
			const redirectUriB64 = b64url(OAUTH.redirectUri);
			const loginUrl = `${OAUTH.loginUrl}?${new URLSearchParams({
				redirect_uri: redirectUriB64,
				state,
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
				response_type: "code",
			}).toString()}`;

			callbacks.onProgress?.(
				"Abre el enlace e inicia sesión con tu cuenta corporativa. Al terminar verás una página de redirección (cuenta atrás de 3 s) y puede que el navegador ofrezca abrir VSCode: cancélalo. Copia la URL completa de la barra de direcciones (…/redirect?…code=… o vscode://…?code=…) y pégala aquí.",
			);
			callbacks.onAuth({ url: loginUrl });

			throwIfAborted(callbacks.signal);
			const pasted = await (callbacks.onManualCodeInput?.() ??
				callbacks.onPrompt({
					message: "Pega la URL de callback (o el code) de autorización",
				}));
			const code = parseCallbackInput(pasted);

			throwIfAborted(callbacks.signal);
			callbacks.onProgress?.("Intercambiando código por token…");
			const { custom_token: customToken } = await postJSON<{
				custom_token?: string;
			}>(OAUTH.tokenUrl, {
				grant_type: "authorization_code",
				code,
				code_verifier: codeVerifier,
				redirect_uri: OAUTH.redirectUri,
			});
			if (!customToken) {
				throw new Error(
					"El servidor de autenticación no devolvió custom_token.",
				);
			}

			throwIfAborted(callbacks.signal);
			callbacks.onProgress?.("Creando sesión…");
			const session = await signInWithCustomToken(customToken);

			callbacks.onProgress?.("Obteniendo configuración del gateway…");
			let envVars: FridaEnvVars = {};
			try {
				envVars = await fetchEnvVars(session.idToken);
			} catch (e: any) {
				callbacks.onProgress?.(
					`get-env-vars falló (${e?.message ?? e}); se reintentará al refrescar modelos.`,
				);
			}

			return {
				access: session.idToken,
				refresh: session.refreshToken,
				expires: credentialExpiry(session),
				compatibleApiUrl: envVars.COMPATIBLE_API_URL ?? "",
				envVars,
			};
		},

		async refreshToken(
			credentials: FridaEnterpriseCredential,
		): Promise<FridaEnterpriseCredential> {
			const session = await refreshFirebaseToken(credentials.refresh);
			let compatibleApiUrl = credentials.compatibleApiUrl || "";
			let envVars = credentials.envVars;
			if (!compatibleApiUrl) {
				try {
					envVars = await fetchEnvVars(session.idToken);
					compatibleApiUrl = envVars.COMPATIBLE_API_URL ?? "";
				} catch {
					// sin URL aún; se reintenta en el próximo refresh
				}
			}
			return {
				...credentials,
				envVars,
				compatibleApiUrl,
				access: session.idToken,
				refresh: session.refreshToken,
				expires: credentialExpiry(session),
			};
		},

		getApiKey(credentials: FridaEnterpriseCredential): string {
			// pi-ai llama getApiKey antes de onPayload; el evento
			// before_provider_request no expone headers (Errata-5). Delegamos
			// los claims al runtime compartido para que el hook los inyecte.
			runtime.rememberToken(credentials.access);
			return credentials.access;
		},
	};
}
