// Adaptador PURO Pi → Frida Enterprise (ADR-1002).
//
// Este módulo NO hace I/O (ni fetch ni timers ni estado global): sólo
// transforma datos. Toda la semántica propietaria del gateway vive aquí:
//   • identidad obligatoria (user_id/email — HTTP 422 si faltan, Errata-2/5)
//   • auto_log (logging corporativo)
//   • reasoning_effort (OpenAI) → reasoning:{effort} (formato Frida)
//   • enrutamiento por capabilities (chat | responses | embeddings)
//   • baseUrl por modelo = raíz + /v1 (el SDK de OpenAI NO antepone /v1, Errata-4)
//   • clasificación de errores del gateway para mensajes accionables
//
// Los tests de contrato están en test/frida-enterprise/adapter.test.ts y
// tools-conformance.test.ts (escritos ANTES que este archivo, TDD).

// ─── Identidad ───────────────────────────────────────────────────────────────

export interface FridaIdentity {
	user_id?: string;
	email?: string;
}

/** Claims del payload de un JWT SIN verificar firma (el gateway la valida).
 *  user_id es el claim propietario de Frida; sub es el estándar Firebase. */
export function identityFromToken(
	idToken: string,
): FridaIdentity | undefined {
	try {
		const part = String(idToken ?? "").split(".")[1];
		if (!part) return undefined;
		const claims: any = JSON.parse(
			Buffer.from(part, "base64url").toString("utf8"),
		);
		const user_id =
			typeof claims?.user_id === "string"
				? claims.user_id
				: typeof claims?.sub === "string"
					? claims.sub
					: undefined;
		const email =
			typeof claims?.email === "string" ? claims.email : undefined;
		if (user_id === undefined && email === undefined) return undefined;
		return { user_id, email };
	} catch {
		return undefined;
	}
}

// ─── Payload: Pi (OpenAI estándar) → Frida ──────────────────────────────────

/**
 * Traduce el payload que arma el adapter openai-completions de pi-ai al
 * contrato del gateway. Reglas (Erratas 2, 4 y 5 del ADR-1001):
 *   1. injecta user_id/email de `identity` (obligatorios; 422 si faltan);
 *   2. auto_log = true;
 *   3. reasoning_effort (OpenAI) → reasoning:{effort} (Frida), sólo si no hay
 *      `reasoning` ya presente;
 *   4. TODO lo demás (model/messages/stream/tools/…) pasa TAL CUAL — el
 *      passthrough de tools es por referencia (sin copia ni mutación);
 *   5. devuelve SIEMPRE un objeto nuevo; nunca muta el de entrada.
 */
export function buildFridaPayload(
	piPayload: Record<string, unknown>,
	identity: FridaIdentity,
): Record<string, unknown> {
	if (!piPayload || typeof piPayload !== "object") return piPayload;
	const out: Record<string, unknown> = { ...piPayload };
	// Errata-8: con modelo reasoning, pi-ai envía el system prompt como
	// role "developer" (convención OpenAI nueva); el gateway Frida sólo
	// acepta system|user|assistant|tool → 422 "Input should be 'system'…".
	// Traducción shallow: sólo se copian los mensajes "developer".
	if (Array.isArray(out.messages)) {
		let changed = false;
		const messages = out.messages.map((m: any) => {
			if (m && typeof m === "object" && m.role === "developer") {
				changed = true;
				return { ...m, role: "system" };
			}
			return m;
		});
		if (changed) out.messages = messages;
	}
	// Errata-8 (responses, E3/E10): el adapter openai-responses también envía
	// el system prompt como role "developer" dentro de `input`; mismo 500.
	// Misma traducción shallow sobre los items de input.
	//
	// Errata-13 (2026-08-17): el gateway /v1/responses devuelve 500 en cuanto
	// el input lleva items del turno PREVIO del assistant en la forma estándar
	// de OpenAI que envía pi-ai. Probe en vivo (reporte-multiturn.md):
	//   ❌ {type:"reasoning", …}                        ← se DESCARTA
	//   ❌ assistant content[].type "output_text"        ← → "input_text"
	//   ✅ "input_text"/string/fc/fc_out tal cual
	// Coste: sin continuidad de razonamiento entre turnos (hoy TODO turno 2
	// muere en 500, así que no se pierde nada que funcionara). Removible:
	// cuando el gateway acepte la forma estándar, borrar este bloque y el
	// T1 de live-multiturn.e2e seguirá verde (prueba la cadena real).
	if (Array.isArray(out.input)) {
		let changed = false;
		const input: unknown[] = [];
		for (const m of out.input as any[]) {
			if (m && typeof m === "object") {
				// Errata-13: items reasoning fuera (el gateway crashea con ellos)
				if (m.type === "reasoning") {
					changed = true;
					continue;
				}
				// Errata-8: developer → system
				if (m.role === "developer") {
					changed = true;
					input.push({ ...m, role: "system" });
					continue;
				}
				// Errata-13: assistant previo con output_text → input_text
				if (
					m.role === "assistant" &&
					Array.isArray(m.content) &&
					m.content.some(
						(c: any) => c && typeof c === "object" && c.type === "output_text",
					)
				) {
					changed = true;
					input.push({
						...m,
						content: m.content.map((c: any) =>
							c && typeof c === "object" && c.type === "output_text"
								? { ...c, type: "input_text" }
								: c,
						),
					});
					continue;
				}
			}
			input.push(m);
		}
		if (changed) out.input = input;
	}
	if (identity.user_id !== undefined) out.user_id = identity.user_id;
	if (identity.email !== undefined) out.email = identity.email;
	out.auto_log = true;
	if (
		typeof out.reasoning_effort === "string" &&
		(out.reasoning as unknown) == null
	) {
		out.reasoning = { effort: out.reasoning_effort };
		delete out.reasoning_effort;
	}
	return out;
}

// ─── Observabilidad del effort (ADR-1003-F2) ─────────────────────────────────

/** Tag corto del effort que lleva (o NO lleva) un payload, para el dbg del
 *  hook: el usuario siempre debe poder ver en ~/.frida/logs a qué nivel se
 *  mandó cada request. Pura y defensiva (Errata-6: nunca lanza).
 *  • chat traducido   → reasoning=high
 *  • responses         → reasoning=high(auto)
 *  • campo ausente     → reasoning=ausente  ← el gateway aplicará su default
 */
export function reasoningEffortTag(
	payload: Record<string, unknown> | undefined,
): string {
	try {
		const r = payload?.reasoning;
		let effort: string | undefined;
		let summary: string | undefined;
		if (r && typeof r === "object") {
			effort =
				typeof (r as any).effort === "string" ? (r as any).effort : undefined;
			summary =
				typeof (r as any).summary === "string" ? (r as any).summary : undefined;
		} else if (typeof payload?.reasoning_effort === "string") {
			effort = payload.reasoning_effort;
		}
		if (effort === undefined) return "reasoning=ausente";
		return summary ? `reasoning=${effort}(${summary})` : `reasoning=${effort}`;
	} catch {
		return "reasoning=ausente";
	}
}

// ─── Shape del payload (Errata-13: diagnóstico del 500 multi-turno) ─────────

/** Etiqueta corta con la FORMA del payload (roles/types en orden de aparición,
 * con conteo si se repiten), para el dbg del hook. Con el incidente del
 * gateway (500 en cuanto el input lleva assistant(output_text) o items
 * `reasoning` — Errata-13), esta etiqueta hace visible en
 * ~/.frida/logs/frida-enterprise-debug.log QUÉ forma viajaba en cada request
 * sin loguear contenido. Pura y defensiva (Errata-6: nunca lanza).
 *  • responses → shape=input[system,user,assistant(output_text),reasoning,fc,fc_out]
 *  • chat      → shape=msgs[system,user,assistant(tool_calls),tool]
 *  • ninguno   → shape=—
 */
export function payloadShapeTag(
	payload: Record<string, unknown> | undefined,
): string {
	try {
		const seq = (items: unknown[]): string[] => {
			const out: string[] = [];
			for (const it of items) {
				if (it && typeof it === "object") {
					const o = it as Record<string, unknown>;
				if (o.type === "function_call") out.push("fc");
					else if (o.type === "function_call_output") out.push("fc_out");
					else if (o.type === "reasoning") out.push("reasoning");
					else if (typeof o.role === "string") {
						// content-types de un message (sólo el primero, basta para diagnosticar)
						let suffix = "";
						const c = o.content;
						if (Array.isArray(c) && c[0] && typeof c[0] === "object" &&
							typeof (c[0] as any).type === "string") {
							suffix = `(${(c[0] as any).type})`;
						}
						if (o.role === "assistant" && Array.isArray(o.tool_calls)) {
							suffix = "(tool_calls)";
						}
						out.push(`${o.role}${suffix}`);
					} else out.push("?");
				} else out.push("?");
			}
			// comprimir repetidos: user,user → user×2
			const comp: Array<{ base: string; n: number }> = [];
			for (const s of out) {
				const prev = comp[comp.length - 1];
				if (prev && prev.base === s) prev.n += 1;
				else comp.push({ base: s, n: 1 });
			}
			return comp.map((c) => (c.n > 1 ? `${c.base}×${c.n}` : c.base));
		};
		if (Array.isArray(payload?.input)) {
			return `shape=input[${seq(payload.input).join(",")}]`;
		}
		if (Array.isArray(payload?.messages)) {
			return `shape=msgs[${seq(payload.messages).join(",")}]`;
		}
		return "shape=—";
	} catch {
		return "shape=?";
	}
}

// ─── Enrutamiento por modelo ─────────────────────────────────────────────────

export type FridaEndpoint = "chat" | "responses" | "embeddings" | "none";

/** Decide qué endpoint sirve a un modelo según sus capabilities (las
 *  combinaciones son las reales del catálogo, ver ADR-1001 §Validación).
 *  "chat"+"responses" → "chat": pi consume chat/completions (mismo criterio
 *  que la extensión original cuando ambos endpoints están declarados). */
export function endpointForCapabilities(caps: unknown): FridaEndpoint {
	if (!Array.isArray(caps)) return "none";
	const lowered = caps.map((c) => String(c).toLowerCase());
	if (lowered.includes("chat")) return "chat";
	if (lowered.includes("responses")) return "responses";
	if (lowered.includes("embeddings")) return "embeddings";
	return "none";
}

/** Adapter pi-ai para un modelo según capabilities (ADR-1003, E4/E5):
 *  "responses" tiene PRIORIDAD (como yAt de la extensión original): los
 *  modelos [chat,responses] — NIKE y compañía — SÓLO razonan por
 *  /v1/responses (reasoning_summary_text → thinking_delta nativo de pi-ai).
 *  undefined ⇒ fuera del catálogo (embeddings / caps vacías). */
export function apiForCapabilities(
	caps: unknown,
): "openai-completions" | "openai-responses" | undefined {
	if (!Array.isArray(caps)) return undefined;
	const lowered = caps.map((c) => String(c).toLowerCase());
	if (lowered.includes("responses")) return "openai-responses";
	if (lowered.includes("chat")) return "openai-completions";
	return undefined;
}

// ─── Catalogación ────────────────────────────────────────────────────────────

export interface FridaEnterpriseModelConfig {
	id: string;
	name: string;
	/** Adapter pi-ai por modelo (ADR-1003): "responses" en capabilities →
	 *  openai-responses (/v1/responses, reasoning_summary → thinking nativo);
	 *  sólo "chat" → openai-completions. Igual criterio que la original (E4). */
	api?: "openai-completions" | "openai-responses";
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	baseUrl?: string;
	compat?: Record<string, unknown>;
	/** Niveles de thinking del footer → valores del payload (pi-ai).
	 *  ADR-1003-F2: off:"none" en modelos chat para que el nivel Off del
	 *  selector viaje EXPLÍCITO (sin él, off ⇒ campo ausente ⇒ el gateway
	 *  aplica su propio default). Responses no lo necesita: pi-ai ya emite
	 *  effort:"none" nativo en ese canal. */
	thinkingLevelMap?: Record<string, string | null>;
}

/** Defaults del gateway cuando /v1/models no los expone (mismos que la
 *  extensión original). */
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_MAX_TOKENS = 128_000;

/** Tope EFECTIVO de contexto del gateway: los upstream (Anthropic…)
 *  rechazan prompts >200k tokens aunque el gateway anuncie 1M/400k.
 *  Incidente verificado: 2025-08-19 (400 "prompt is too long: 215974 > 200000").
 *  Sin clamp, el editor no compacta a tiempo y las sesiones mueren con 400.
 *  Remover cuando Frida Platform corrija el upstream para honrar 1M.
 *  (Refs: pi-frida-enterprise/adapter.ts L45-50, VALIDACION-E2E.md). */
export const EFFECTIVE_CONTEXT_CEILING = 200_000;

function clampContextWindow(announced: number): number {
	return Math.min(announced, EFFECTIVE_CONTEXT_CEILING);
}

/** Entrada cruda de /v1/models → ProviderModelConfig listo para pi-ai, con
 *  baseUrl = raíz + "/v1" (Errata-4). Devuelve undefined para modelos que
 *  no sirven por chat/completions (se filtran del catálogo). */
function formatContextTokens(ctx: number): string {
	if (ctx >= 1_000_000) {
		const m = Math.round((ctx / 1_000_000) * 10) / 10;
		return `${m}M`;
	}
	return `${Math.round(ctx / 1000)}k`;
}

/** Clase de tamaño para el selector: el usuario distingue de un vistazo. */
export function modelClass(id: string, contextWindow: number): string {
	if (id === "model-router") return "meta";
	if (contextWindow >= 1_000_000) return "grande";
	if (contextWindow >= 200_000) return "mediano";
	return "compacto";
}

/** Un modelo sugerido ⭐ POR CLASE de tamaño — criterio MEDIDO (F3-c,
 *  2026-08-16, reporte-reasoning.md): uno por clase que SÍ razona
 *  visible con effort high. DEMETER-BLOOM (grande, 686 reasoning_tokens),
 *  TITAN-CROWN (mediano, 721) y MIDAS-GOLD (compacto, 805). Desplazan a
 *  NIKE-VICTORY/SELENE-CIPHER/MERCURY-WING: NIKE pierde el reasoning en
 *  la traducción Anthropic→responses del gateway (0 tokens) y MERCURY no
 *  expone razonamiento. */
export function isSuggested(id: string): boolean {
	return (
		id === "DEMETER-BLOOM" ||
		id === "TITAN-CROWN" ||
		id === "MIDAS-GOLD"
	);
}

export function toProviderModel(
	raw: Record<string, unknown>,
	rootUrl: string,
): FridaEnterpriseModelConfig | undefined {
	if (typeof raw?.id !== "string" || raw.id.length === 0) return undefined;
	// ADR-1003: el catálogo curado es chat-capable (los [chat,responses] van
	// por /v1/responses). Responses-only/embeddings/caps vacías quedan fuera
	// (no hay matriz live que los respalde).
	const caps: string[] = Array.isArray(raw.capabilities)
		? raw.capabilities.map((c) => String(c).toLowerCase())
		: [];
	if (!caps.includes("chat")) return undefined;
	const api = apiForCapabilities(caps)!;
	// #clamp-200k: separamos el valor ANUNCIADO del EFECTIVO. El tier
	// (grande/mediano/compacto) se clasifica por el anunciado — el gateway
	// sigue distinguiendo sus modelos por 1M/400k/128k — pero el contexto
	// EFECTIVO (lo que ve pi-ai para compactar y lo que muestra el statusbar)
	// queda clampeado a 200k: el upstream Anthropic rechaza >200k (400).
	const announced =
		typeof (raw as any).context_window_tokens === "number"
			? (raw as any).context_window_tokens
			: DEFAULT_CONTEXT_WINDOW;
	const contextWindow = clampContextWindow(announced);
	// Anotaciones del selector: capability responses + clase de tamaño
	// (grande/mediano/compacto/meta) con contexto humano EFECTIVO.
	const klass = modelClass(raw.id, announced);
	const tags: string[] = [];
	if (caps.includes("responses")) tags.push("responses");
	tags.push(
		klass === "meta" ? "meta" : `${klass} ${formatContextTokens(contextWindow)}`,
	);
	// ⭐ prefija al sugerido de su clase de tamaño
	const prefix = isSuggested(raw.id) ? "\u2b50 " : "";
	return {
		id: raw.id,
		name: `${prefix}${raw.id} (${tags.join(", ")})`,
		api,
		// ADR-1003 (E5/E6): qué-raciona lo deciden modelo+endpoint (el gateway
		// no declara capability "reasoning" en NINGÚN modelo). Con true, pi-ai
		// expone el selector de thinking y manda reasoning/reasoning_effort.
		reasoning: true,
		// Sólo-chat necesita el flag para que pi-ai emita reasoning_effort
		// (E8) y buildFridaPayload lo traduzca; responses la lleva nativa.
		// thinkingLevelMap off:"none" (ADR-1003-F2): nivel Off del footer
		// explícito — sin él, pi-ai omite el campo y el gateway aplica su
		// propio default (E8 validó effort none → 200 en ambos endpoints).
		...(api === "openai-completions"
			? {
					compat: { supportsReasoningEffort: true },
					thinkingLevelMap: { off: "none" },
				}
			: {}),
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens:
			typeof (raw as any).max_output_tokens === "number"
				? (raw as any).max_output_tokens
				: DEFAULT_MAX_TOKENS,
		baseUrl: rootUrl ? `${rootUrl.replace(/\/$/, "")}/v1` : "",
	};
}

// ─── Respuesta Frida → Pi ────────────────────────────────────────────────────

export interface FridaTranslatedToolCall {
	id?: string;
	name?: string;
	arguments: Record<string, unknown>;
	index?: number;
}

export interface FridaTranslatedResponse {
	content: unknown;
	reasoning?: unknown;
	toolCalls?: FridaTranslatedToolCall[];
	finishReason: "stop" | "length" | "toolUse" | "error";
	usage?: {
		input: number;
		output: number;
		totalTokens: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	raw: unknown;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

function mapFinishReason(reason: unknown): FridaTranslatedResponse["finishReason"] {
	if (reason === "tool_calls" || reason === "function_call") return "toolUse";
	if (reason === "length" || reason === "max_tokens" || reason === "max_output_tokens") return "length";
	if (reason === "stop" || reason === "end" || reason == null) return "stop";
	return "error";
}

/** Traduce una respuesta JSON completa del gateway al contrato semántico de Pi.
 * No depende del SDK: sirve para tests, errores y una futura API custom. */
export function translateFridaResponse(response: any): FridaTranslatedResponse {
	const choice = response?.choices?.[0] ?? {};
	const message = choice.message ?? {};
	const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const toolCalls = rawToolCalls.map((call: any) => ({
		id: call?.id,
		name: call?.function?.name,
		arguments: parseToolArguments(call?.function?.arguments),
		index: call?.index,
	}));
	const usage = response?.usage;
	return {
		content: message.content ?? "",
		reasoning: message.reasoning_content ?? message.reasoning,
		...(toolCalls.length ? { toolCalls } : {}),
		finishReason: mapFinishReason(choice.finish_reason),
		...(usage
			? {
					usage: {
						input: Number(usage.prompt_tokens ?? 0),
						output: Number(usage.completion_tokens ?? 0),
						totalTokens: Number(usage.total_tokens ?? 0),
						cacheRead: Number(usage.cache_read_input_tokens ?? 0),
						cacheWrite: Number(usage.cache_write_input_tokens ?? 0),
					},
				}
			: {}),
		raw: response,
	};
}

export interface FridaTranslatedStreamEvent {
	type: "text_delta" | "reasoning_delta" | "tool_call_delta" | "done";
	text?: string;
	index?: number;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	finishReason?: FridaTranslatedResponse["finishReason"];
}

/** Traduce un chunk SSE JSON individual del gateway a un evento Pi agnóstico. */
export function translateFridaStreamChunk(
	chunk: any,
): FridaTranslatedStreamEvent | undefined {
	const choice = chunk?.choices?.[0];
	const delta = choice?.delta ?? {};
	if (typeof delta.content === "string")
		return { type: "text_delta", text: delta.content };
	if (typeof delta.reasoning_content === "string")
		return { type: "reasoning_delta", text: delta.reasoning_content };
	const call = Array.isArray(delta.tool_calls) ? delta.tool_calls[0] : undefined;
	if (call) {
		return {
			type: "tool_call_delta",
			index: call.index,
			id: call.id,
			name: call.function?.name,
			arguments: parseToolArguments(call.function?.arguments),
		};
	}
	if (choice?.finish_reason != null)
		return { type: "done", finishReason: mapFinishReason(choice.finish_reason) };
	return undefined;
}

// ─── Errores ─────────────────────────────────────────────────────────────────

export type FridaGatewayError =
	| { kind: "identity"; hint: string }
	| { kind: "model-unavailable"; hint: string }
	| { kind: "auth-expired"; hint: string }
	| { kind: "unknown"; hint: string };

/** Clasifica status/body del gateway para mensajes de UI accionables, con los
 *  errores REALES capturados en la validación en vivo (ADR-1001 §Erratas). */
export function classifyGatewayError(
	status: number,
	body?: string,
): FridaGatewayError {
	const text = String(body ?? "");
	if (status === 401 || status === 403)
		return {
			kind: "auth-expired",
			hint: "Sesión expirada: ejecuta /login frida-enterprise",
		};
	if (status === 422 && /user_id|email/i.test(text))
		return {
			kind: "identity",
			hint: "El gateway no recibió user_id/email: reinicia sesión (/login frida-enterprise)",
		};
	if (status === 502 || /not available for chat/i.test(text))
		return {
			kind: "model-unavailable",
			hint: "El backend del gateway no sirve este modelo (502/no disponible)",
		};
	return { kind: "unknown", hint: `HTTP ${status}` };
}
