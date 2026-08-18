// Tests del proveedor Frida Enterprise (ADR-1001). Cubren las piezas puras y el
// flujo OAuth/login con fetch global mockeado. Los endpoints reales no se tocan
// aquí (la prueba de integración es el VSIX auto-modificado contra el SSO real).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	makePkcePair,
	parseCallbackInput,
	buildFridaEnterpriseProviderConfig,
	buildFridaEnterpriseOAuth,
	createFridaEnterpriseRuntime,
	buildFallbackCatalog,
	fetchFridaEnterpriseModels,
	createFridaEnterpriseHooks,
	FRIDA_ENTERPRISE_PROVIDER,
} from "../src/providers/frida-enterprise";

// ─── PKCE ─────────────────────────────────────────────────────────────────────

describe("makePkcePair (PKCE S256, paridad con el bundle original)", () => {
	it("genera verifier/challenge base64url sin padding", () => {
		const { codeVerifier, codeChallenge } = makePkcePair();
		expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(codeVerifier).not.toEqual(codeChallenge);
	});

	it("el challenge es SHA-256(verifier) base64url (verificable)", async () => {
		const { createHash } = await import("node:crypto");
		const { codeVerifier, codeChallenge } = makePkcePair();
		const expected = createHash("sha256")
			.update(codeVerifier)
			.digest("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		expect(codeChallenge).toBe(expected);
	});

	it("dos pares son distintos (aleatorios)", () => {
		const a = makePkcePair();
		const b = makePkcePair();
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
	});
});

// ─── parseCallbackInput ────────────────────────────────────────────────────────

describe("parseCallbackInput", () => {
	it("extrae el code de la URL de callback vscode:// completa", () => {
		expect(
			parseCallbackInput(
				"vscode://fridaplatform.frida-extension?code=abc123xyz&state=st",
			),
		).toBe("abc123xyz");
	});

	it("extrae el code de una URL https con query", () => {
		expect(
			parseCallbackInput("https://example.com/cb?state=x&code=QQQ999"),
		).toBe("QQQ999");
	});

	it("extrae el code de la página /redirect del portal (la que queda en la barra)", () => {
		// Caso real observado en vivo: tras el login SSO el portal aterriza en
		// /redirect?redirect_uri=…&code=…&state=… (countdown 3 s + offer VSCode).
		expect(
			parseCallbackInput(
				"https://extension.enterprise.fridaplatform.online/redirect?redirect_uri=vscode%3A%2F%2Ffridaplatform.frida-extension&code=b992bbad-cda4-4105-b6ad-ffc80dbc9dc7&state=st",
			),
		).toBe("b992bbad-cda4-4105-b6ad-ffc80dbc9dc7");
	});

	it("acepta el code pelado", () => {
		expect(parseCallbackInput("  abc123def  ")).toBe("abc123def");
	});

	it("lanza con input vacío", () => {
		expect(() => parseCallbackInput("   ")).toThrow(/código/i);
	});

	it("lanza con basura multi-palabra sin query", () => {
		expect(() => parseCallbackInput("hola mundo esto no es un code")).toThrow(
			/code/i,
		);
	});
});

// ─── Fallback catalog (F3-d: SELECTED, no MODEL1..4) ───────────────────────

describe("buildFallbackCatalog (F3-d: offline muestra SÓLO los ⭐ medidos)", () => {
		it("con envVars → los 4 SELECTED, aunque MODEL1..4 nombren a los viejos", () => {
			const cat = buildFallbackCatalog({
				COMPATIBLE_API_URL: "https://gw",
				MODEL1: "AEOLUS-GALE",
				MODEL2: "NIKE-VICTORY",
				MODEL3: "TIRESIAS-PRISM",
				MODEL4: "SELENE-CIPHER",
			});
			// El combo jamás muestra los viejos (ni online ni offline)
			expect(cat.map((m) => m.id)).toEqual([
				"DEMETER-BLOOM",
				"TITAN-CROWN",
				"MIDAS-GOLD",
				"model-router",
			]);
			expect(cat.map((m) => m.name)).toEqual([
				"\u2b50 DEMETER-BLOOM (responses, grande 1M)",
				"\u2b50 TITAN-CROWN (responses, mediano 400k)",
				"\u2b50 MIDAS-GOLD (responses, compacto 128k)",
				"model-router (responses, meta)",
			]);
		});

		it("sin env vars → catálogo vacío (pre-login, nada conocido)", () => {
			expect(buildFallbackCatalog({})).toEqual([]);
		});

		it("todos reasoning:true y por /v1/responses (medido 2026-08-16)", () => {
			const cat = buildFallbackCatalog({ MODEL1: "x" });
			expect(cat.length).toBe(4);
			for (const m of cat) {
				expect(m.reasoning).toBe(true);
				expect(m.api).toBe("openai-responses");
				expect(m.contextWindow).toBeGreaterThan(0);
			}
		});
});

// ─── Provider config ──────────────────────────────────────────────────────────

describe("buildFridaEnterpriseProviderConfig", () => {
	it("tiene la forma que espera ModelRuntime.registerProvider", () => {
		const cfg = buildFridaEnterpriseProviderConfig() as any;
		expect(cfg.name).toBe("Frida Enterprise");
		expect(cfg.api).toBe("openai-completions");
		expect(cfg.authHeader).toBe(true); // Bearer idToken vía oauth.getApiKey
		expect(Array.isArray(cfg.models)).toBe(true); // [] hasta autenticar
		expect(typeof cfg.oauth.login).toBe("function");
		expect(typeof cfg.oauth.refreshToken).toBe("function");
		expect(typeof cfg.oauth.getApiKey).toBe("function");
		expect(typeof cfg.refreshModels).toBe("function");
	});

	it("getApiKey devuelve el access (idToken)", () => {
		const cfg = buildFridaEnterpriseProviderConfig() as any;
		expect(cfg.oauth.getApiKey({ access: "IDTOKEN" })).toBe("IDTOKEN");
	});
});

// ─── fetch /v1/models ─────────────────────────────────────────────────────────

describe("fetchFridaEnterpriseModels", () => {
	it("mapea el catálogo: capability chat + LISTA BLANCA de verificados", async () => {
		const calls: any[] = [];
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async (url: any, init?: any) => {
			calls.push({ url: String(url), auth: init?.headers?.Authorization });
			return new Response(
				JSON.stringify({
					data: [
						// ⭐ medido (SELECTED + verificado)
						{
							id: "DEMETER-BLOOM",
							capabilities: ["chat", "responses"],
							context_window_tokens: 1000000,
							max_output_tokens: 128000,
						},
						// ⭐ compacto (SELECTED) → pasa y se anota
						{ id: "MIDAS-GOLD", capabilities: ["chat", "responses"], context_window_tokens: 128000 },
						// chat PERO con 502 del backend (matriz live) → EXCLUIDO
						{ id: "VULCAN-FORGE", capabilities: ["chat"] },
						// flaky (round-trip sin contenido) → EXCLUIDO
						{ id: "SELENE-GLOW", capabilities: ["chat"] },
						// responses-only → 400 por chat (Errata-4) → EXCLUIDO
						{ id: "HEPHAESTUS-ANVIL", capabilities: ["responses"] },
						// embeddings-only → EXCLUIDO
						{ id: "CLIO-RELIC", capabilities: ["embeddings"] },
						// modelo NUEVO del gateway, aún sin verificar → EXCLUIDO
						// (agregarlo a VERIFIED_MODEL_IDS tras pasar la matriz live)
						{ id: "BRAND-NEW-MODEL", capabilities: ["chat"] },
					],
				}),
				{ status: 200 },
			);
		};
		try {
			const models = await fetchFridaEnterpriseModels(
				"https://gateway.example/",
				"IDTOKEN",
			);
			expect(calls[0].url).toBe("https://gateway.example/v1/models");
			expect(calls[0].auth).toBe("Bearer IDTOKEN");
			// Triple filtro: capability "chat" (Errata-4) + verificación en
			// vivo + SELECTED del selector (F3-c)
			expect(models.map((m) => m.id)).toEqual(["DEMETER-BLOOM", "MIDAS-GOLD"]);
			expect(models[0]).toMatchObject({
				id: "DEMETER-BLOOM",
				reasoning: true,
				contextWindow: 1000000,
				maxTokens: 128000,
			});
			expect(models[1]).toMatchObject({
				id: "MIDAS-GOLD",
				name: "\u2b50 MIDAS-GOLD (responses, compacto 128k)",
				contextWindow: 128000,
				maxTokens: 128000, // default
			});
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("F3-c: el SELECTOR muestra SOLO los ⭐ medidos (SELECTED_MODEL_IDS), no los 32 verificados", async () => {
		// El combo del webview se alimenta de refreshModels → fetch…Models.
		// Tras F3-c el catálogo del selector se reduce a los medidos (uno por
		// clase + meta); VERIFIED (32) sigue sembrando knowsModel para que
		// sesiones activas con otros modelos no pierdan la identidad.
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			jsonResponse({
				data: [
					// ⭐ medidos (deben quedar, con ⭐ y orden)
					{ id: "MIDAS-GOLD", capabilities: ["chat", "responses"], context_window_tokens: 128000 },
					{ id: "TITAN-CROWN", capabilities: ["chat", "responses"], context_window_tokens: 400000 },
					{ id: "DEMETER-BLOOM", capabilities: ["chat", "responses"], context_window_tokens: 1000000 },
					{ id: "model-router", capabilities: ["chat"], context_window_tokens: 1000000 },
					// verificados PERO fuera de SELECTED → no aparecen en el combo
					{ id: "NIKE-VICTORY", capabilities: ["chat", "responses"], context_window_tokens: 1000000 },
					{ id: "SELENE-CIPHER", capabilities: ["chat"], context_window_tokens: 262144 },
					{ id: "MERCURY-WING", capabilities: ["chat"], context_window_tokens: 128000 },
					{ id: "GAIA-FLARE", capabilities: ["chat", "responses"], context_window_tokens: 1000000 },
					// no verificados → siguen fuera
					{ id: "VULCAN-FORGE", capabilities: ["chat"] },
				],
			});
		try {
			const models = await fetchFridaEnterpriseModels(
				"https://gateway.example",
				"IDTOKEN",
			);
			// Contenido EXACTO del combo: 4 options en orden grande→mediano→compacto→meta
			expect(models.map((m) => m.name)).toEqual([
				"\u2b50 DEMETER-BLOOM (responses, grande 1M)",
				"\u2b50 TITAN-CROWN (responses, mediano 400k)",
				"\u2b50 MIDAS-GOLD (responses, compacto 128k)",
				"model-router (meta)",
			]);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("el catálogo llega ORDENADO: grande → mediano → compacto, meta al final", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			jsonResponse({
				data: [
					// los 4 SELECTED en DESORDEN: el sort los ordena por clase
					{ id: "MIDAS-GOLD", capabilities: ["chat", "responses"], context_window_tokens: 128000 }, // compacto
					{ id: "model-router", capabilities: ["chat"], context_window_tokens: 1000000 }, // meta
					{ id: "DEMETER-BLOOM", capabilities: ["chat", "responses"], context_window_tokens: 1000000 }, // grande
					{ id: "TITAN-CROWN", capabilities: ["chat", "responses"], context_window_tokens: 400000 }, // mediano
				],
			});
		try {
			const models = await fetchFridaEnterpriseModels(
				"https://gateway.example/",
				"IDTOKEN",
			);
			// por BLOQUE de clase; con SELECTED hay UNO por bloque + meta al final
			expect(models.map((m) => m.id)).toEqual([
				"DEMETER-BLOOM", // ⭐ grande
				"TITAN-CROWN", // ⭐ mediano (400k)
				"MIDAS-GOLD", // ⭐ compacto (128k)
				"model-router", // meta
			]);
			// y los badges quedan visibles en el nombre
			expect(models.map((m) => m.name)).toEqual([
				"\u2b50 DEMETER-BLOOM (responses, grande 1M)",
				"\u2b50 TITAN-CROWN (responses, mediano 400k)",
				"\u2b50 MIDAS-GOLD (responses, compacto 128k)",
				"model-router (meta)",
			]);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("el ⭐ sugerido ABRE cada bloque de tamaño en el orden final", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			jsonResponse({
				data: [
					// los 4 SELECTED…
					{ id: "PUCK-SWIFT", capabilities: ["chat"], context_window_tokens: 128000 },
					{ id: "model-router", capabilities: ["chat"], context_window_tokens: 1000000 },
					{ id: "DEMETER-BLOOM", capabilities: ["chat", "responses"], context_window_tokens: 1000000 }, // ⭐ grande
					{ id: "GAIA-FLARE", capabilities: ["chat", "responses"], context_window_tokens: 1050000 },
					{ id: "MIDAS-GOLD", capabilities: ["chat", "responses"], context_window_tokens: 128000 }, // ⭐ compacto
					{ id: "SELENE-CIPHER", capabilities: ["chat"], context_window_tokens: 262144 },
					{ id: "TITAN-CROWN", capabilities: ["chat", "responses"], context_window_tokens: 400000 }, // ⭐ mediano
					{ id: "NIKE-VICTORY", capabilities: ["chat", "responses"], context_window_tokens: 1000000 },
				],
			});
		try {
			const models = await fetchFridaEnterpriseModels(
				"https://gateway.example/",
				"IDTOKEN",
			);
			// Con SELECTED hay UN ⭐ por clase; los verificados NO seleccionados
			// (GAIA-FLARE, SELENE-CIPHER, PUCK-SWIFT, NIKE-VICTORY) no llegan
			// al combo aunque estén en VERIFIED (F3-c).
			expect(models.map((m) => m.name)).toEqual([
				"\u2b50 DEMETER-BLOOM (responses, grande 1M)",
				"\u2b50 TITAN-CROWN (responses, mediano 400k)",
				"\u2b50 MIDAS-GOLD (responses, compacto 128k)",
				"model-router (meta)",
			]);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("propaga error HTTP con detalle", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			new Response(JSON.stringify({ error: { message: "nope" } }), {
				status: 403,
			});
		try {
			await expect(
				fetchFridaEnterpriseModels("https://gw", "T"),
			).rejects.toThrow(/403.*nope/);
		} finally {
			globalThis.fetch = orig;
		}
	});
});

// ─── refreshModels (baseUrl /v1 — Errata-4) ─────────────────────────────

describe("refreshModels (Errata-4: baseUrl con /v1)", () => {
	it("asigna baseUrl = raíz + /v1 a cada modelo (el SDK de OpenAI no lo antepone)", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			jsonResponse({
				data: [
					{ id: "DEMETER-BLOOM", capabilities: ["chat", "responses"] },
				],
			}); // ⭐ seleccionado
		try {
			const cfg = buildFridaEnterpriseProviderConfig() as any;
			const models = await cfg.refreshModels({
				allowNetwork: true,
				credential: { access: "IDT", compatibleApiUrl: "https://gw.example/" },
			});
			expect(models.map((m: any) => m.id)).toEqual(["DEMETER-BLOOM"]);
			expect(models[0].baseUrl).toBe("https://gw.example/v1");
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("fallback MODEL1..4 también lleva /v1 (y sin URL conocida, baseUrl vacío)", async () => {
		const cfg = buildFridaEnterpriseProviderConfig() as any;
		const models = await cfg.refreshModels({
			allowNetwork: false,
			credential: { compatibleApiUrl: "https://gw.example", envVars: { MODEL1: "m1" } },
		});
		expect(models.length).toBeGreaterThan(0);
		expect(models[0].baseUrl).toBe("https://gw.example/v1");
		const empty = await cfg.refreshModels({
			allowNetwork: false,
			credential: { envVars: { MODEL1: "m1" } },
		});
		expect(empty[0].baseUrl).toBe("");
	});
});

// ─── OAuth login/refresh con fetch mockeado ────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe("buildFridaEnterpriseOAuth", () => {
	const oauth = buildFridaEnterpriseOAuth();

	function makeCallbacks(override: Partial<any> = {}) {
		const seen: any = { auth: [], progress: [] };
		const cbs = {
			onAuth: (info: any) => seen.auth.push(info),
			onProgress: (m: string) => seen.progress.push(m),
			onDeviceCode: async () => {},
			onPrompt: async () =>
				"vscode://fridaplatform.frida-extension?code=THECODE&state=x",
			onManualCodeInput: async () =>
				"vscode://fridaplatform.frida-extension?code=THECODE&state=x",
			...override,
		};
		return { cbs, seen };
	}

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("login: prefiere onPrompt con instrucciones de paste (UX #58) sobre el texto genérico del SDK", async () => {
		const orig = globalThis.fetch;
		const prompts: any[] = [];
		const bodies: string[] = [];
		(globalThis as any).fetch = async (url: any, init?: any) => {
			if (init?.body) bodies.push(String(init.body));
			if (String(url).includes("auth/enterprise/token"))
				return jsonResponse({ custom_token: "CT" });
			if (String(url).includes("signInWithCustomToken"))
				return jsonResponse({
					idToken: "ID1",
				refreshToken: "R1",
				expiresIn: "3600",
				});
			if (String(url).includes("/auth/token"))
				return jsonResponse({ access_token: "AT" });
			if (String(url).includes("get-env-vars"))
				return jsonResponse({
					env_vars: { COMPATIBLE_API_URL: "https://gw" },
				});
			return jsonResponse({});
		};
		try {
			const { cbs } = makeCallbacks({
				onPrompt: async (p: any) => {
					prompts.push(p);
					return "https://extension.enterprise.fridaplatform.online/redirect?code=PROMPTCODE&state=y";
				},
				onManualCodeInput: async () => {
					throw new Error(
						"onManualCodeInput no debe usarse cuando onPrompt existe",
					);
				},
			});
			const cred = await oauth.login(cbs);
			expect(prompts).toHaveLength(1);
			// Instrucciones claras: la URL de la barra de direcciones, no un "code" abstracto.
			expect(prompts[0].message).toMatch(/barra de direcciones/);
			expect(String(prompts[0].placeholder ?? "")).toMatch(/code=/);
			expect((cred as any).access).toBe("ID1");
			// El exchange viajó con el code extraído del paste de onPrompt.
			expect(bodies.some((b) => b.includes("PROMPTCODE"))).toBe(true);
		} finally {
			(globalThis as any).fetch = orig;
		}
	});

	it("login: URL con PKCE S256 + exchange + firebase + env-vars", async () => {
		const posts: any[] = [];
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async (url: any, init?: any) => {
			posts.push({ url: String(url), init });
			if (String(url).includes("auth/enterprise/token"))
				return jsonResponse({ custom_token: "CT" });
			if (String(url).includes("signInWithCustomToken"))
				return jsonResponse({
					idToken: "ID1",
					refreshToken: "RF1",
					expiresIn: "3600",
				});
			if (String(url).includes("/auth/token"))
				return jsonResponse({ access_token: "AT" });
			if (String(url).includes("get-env-vars"))
				return jsonResponse({
					env_vars: { COMPATIBLE_API_URL: "https://gw.example" },
				});
			throw new Error("unexpected fetch " + url);
		};
		const { cbs, seen } = makeCallbacks();
		try {
			const cred = await oauth.login(cbs as any);
			// URL de login con los 5 params del protocolo
			const authUrl = seen.auth[0].url as string;
			expect(authUrl.startsWith("https://extension.enterprise.fridaplatform.online/login?")).toBe(true);
			const params = new URLSearchParams(authUrl.split("?")[1]);
			// redirect_uri va BASE64URL: el portal SPA lo decodifica con atob (fIe→dIe)
			// y descarta los params si falla — con el URI crudo el login termina en
			// /home sin code (verificado en vivo 2026-08-15).
			expect(params.get("redirect_uri")).toBe(
				Buffer.from("vscode://fridaplatform.frida-extension")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, ""),
			);
			expect(params.get("code_challenge_method")).toBe("S256");
			expect(params.get("response_type")).toBe("code");
			expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
			// El code enviado al exchange es el parseado de la URL pegada; y ojo:
			// el exchange espera el redirect_uri CRUDO (JSON body), no el b64 de la
			// URL de login — contrato distinto del portal web.
			const exchange = JSON.parse(posts[0].init.body);
			expect(exchange).toMatchObject({
				grant_type: "authorization_code",
				code: "THECODE",
				redirect_uri: "vscode://fridaplatform.frida-extension",
			});
			expect(typeof exchange.code_verifier).toBe("string");
			// Credential resultante
			expect(cred.access).toBe("ID1");
			expect(cred.refresh).toBe("RF1");
			expect(cred.compatibleApiUrl).toBe("https://gw.example");
			// Expiración: ~1h menos el margen de 2 min
			expect(cred.expires).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
			expect(cred.expires).toBeLessThan(Date.now() + 60 * 60 * 1000);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("login: custom_token ausente → error explícito", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async () => jsonResponse({});
		const { cbs } = makeCallbacks();
		try {
			await expect(oauth.login(cbs as any)).rejects.toThrow(/custom_token/);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("login: get-env-vars fallando NO rompe el login (compatibleApiUrl vacío)", async () => {
		const orig = globalThis.fetch;
		(globalThis as any).fetch = async (url: any) => {
			if (String(url).includes("auth/enterprise/token"))
				return jsonResponse({ custom_token: "CT" });
			if (String(url).includes("signInWithCustomToken"))
				return jsonResponse({
					idToken: "ID1",
					refreshToken: "RF1",
					expiresIn: "3600",
				});
			return jsonResponse({}, 500);
		};
		const { cbs } = makeCallbacks();
		try {
			const cred = await oauth.login(cbs as any);
			expect(cred.access).toBe("ID1");
			expect(cred.compatibleApiUrl).toBe("");
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("refreshToken: rota tokens y reintenta env-vars si faltaba la URL", async () => {
		const orig = globalThis.fetch;
		let envCalls = 0;
		(globalThis as any).fetch = async (url: any, init?: any) => {
			const u = String(url);
			if (u.includes("securetoken")) {
				// securetoken = form-urlencoded
				expect(String(init.headers["Content-Type"])).toContain(
					"application/x-www-form-urlencoded",
				);
				expect(String(init.body)).toContain("grant_type=refresh_token");
				return jsonResponse({
					id_token: "ID2",
					refresh_token: "RF2",
					expires_in: "3600",
				});
			}
			if (u.includes("/auth/token")) {
				envCalls++;
				return jsonResponse({ access_token: "AT" });
			}
			if (u.includes("get-env-vars"))
				return jsonResponse({
					env_vars: { COMPATIBLE_API_URL: "https://gw2.example" },
				});
			throw new Error("unexpected " + u);
		};
		try {
			const cred = await oauth.refreshToken({
				access: "ID1",
				refresh: "RF1",
				expires: 1, // ya vencido
				compatibleApiUrl: "",
			} as any);
			expect(cred.access).toBe("ID2");
			expect(cred.refresh).toBe("RF2");
			expect(cred.compatibleApiUrl).toBe("https://gw2.example");
			expect(envCalls).toBe(1);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("refreshToken: conserva la URL conocida sin volver a pedir env-vars", async () => {
		const orig = globalThis.fetch;
		let envCalls = 0;
		(globalThis as any).fetch = async (url: any) => {
			if (String(url).includes("securetoken"))
				return jsonResponse({
					id_token: "ID2",
					refresh_token: "RF2",
					expires_in: "3600",
				});
			envCalls++;
			throw new Error("unexpected " + url);
		};
		try {
			const cred = await oauth.refreshToken({
				access: "ID1",
				refresh: "RF1",
				expires: 1,
				compatibleApiUrl: "https://known.example",
			} as any);
			expect(cred.access).toBe("ID2");
			expect(cred.compatibleApiUrl).toBe("https://known.example");
			expect(envCalls).toBe(0);
		} finally {
			globalThis.fetch = orig;
		}
	});
});

// ─── Hooks de sesión ──────────────────────────────────────────────────────────

describe("createFridaEnterpriseHooks", () => {
	it("before_provider_request: enriquece payload sólo para frida-enterprise", () => {
		const events: any[] = [];
		const pi = {
			on: (name: string, fn: any) => events.push({ name, fn }),
		};
		const unauthorized = vi.fn();
		// Gate Errata-7: siembra el modelo del payload en la whitelist (en el
		// host real lo siembra refreshModels con catálogo/store/fallback).
		const runtime = createFridaEnterpriseRuntime(["m1"]);
		createFridaEnterpriseHooks({ onUnauthorized: unauthorized, runtime })(pi as any);
		const headersHook = events.find((e) => e.name === "before_provider_headers");
		const before = events.find((e) => e.name === "before_provider_request");
		const after = events.find((e) => e.name === "after_provider_response");

		// JWT con user_id/email en el payload (sin firma — el gateway valida).
		const claims = { user_id: "uid-1", email: "u@softtek.com" };
		const jwt = `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
		const payload: any = { model: "m1", reasoning_effort: "high" };
		// Orden real de pi-ai: headers (before_provider_headers) capturan la
		// identidad ANTES de onPayload — aquí hacia el runtime sembrado.
		headersHook.fn({ headers: { Authorization: `Bearer ${jwt}` } });
		const result = before.fn(
			{ payload },
			{ model: { provider: FRIDA_ENTERPRISE_PROVIDER } },
		);
		expect(result.user_id).toBe("uid-1");
		expect(result.email).toBe("u@softtek.com");
		expect(result.auto_log).toBe(true);
		expect(result.reasoning).toEqual({ effort: "high" });
		expect(result.reasoning_effort).toBeUndefined();

		// Otro provider: el hook no toca nada (retorna undefined sin mutar).
		const other: any = { model: "m" };
		expect(
			before.fn({ payload: other }, { model: { provider: "zai" } }),
		).toBeUndefined();
		expect(other.user_id).toBeUndefined();

		// Sin headers en before_provider_request, la implementación anterior no
		// podía cumplir el contrato user_id/email; el flujo nuevo sí los conserva.

		// 401 → onUnauthorized
		after.fn({ status: 401 }, { model: { provider: FRIDA_ENTERPRISE_PROVIDER } });
		expect(unauthorized).toHaveBeenCalledTimes(1);
	});
});
