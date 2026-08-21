// Catálogo de modelos Frida Enterprise (ADR-1002).
//
// GET {raíz}/v1/models → ProviderModelConfig vía el adaptador puro
// (toProviderModel: filtro chat + baseUrl con /v1, Errata-4). El fallback
// MODEL1..4 replica los roles de la extensión original.

import {
	toProviderModel,
	isSuggested,
	type FridaEnterpriseModelConfig,
} from "./adapter";
import { dbg } from "./runtime";
import type { FridaEnvVars } from "./oauth";

/** Rango de clase para ordenar bloques: grande(0) → mediano(1) → compacto(2).
 *  Basado en ID (estable) en vez de contextWindow (ahora clampeado a 200k —
 *  DEMETER-BLOOM/TITAN-CROWN/model-router quedarían todos "mediano" si
 *  clasificáramos por contexto numérico). */
function classRank(id: string, contextWindow: number): number {
	if (id === "model-router") return 3;
	if (id === "DEMETER-BLOOM") return 0; // grande (gateway anuncia 1M)
	if (id === "TITAN-CROWN") return 1; // mediano (gateway anuncia 400k)
	if (id === "MIDAS-GOLD") return 2; // compacto (128k)
	// Fallback genérico por contexto (para futuros modelos):
	if (contextWindow >= 1_000_000) return 0;
	if (contextWindow >= 200_000) return 1;
	return 2;
}

export type { FridaEnterpriseModelConfig };

/** Catálogo CURADO: los 32 modelos chat que pasaron la matriz live completa
 *  (generación + tool-call + round-trip + streaming) el 2026-08-16. Excluye:
 *  • 11 con 502 del backend (deployments rotos del gateway, p.ej. VULCAN-FORGE);
 *  • 2 flaky (SELENE-GLOW/SELENE-DRIFT: round-trip sin contenido);
 *  • responses-only / embeddings / caps vacías (Errata-4, también filtrados
 *    por capability).
 *  ⚠️ Mantenimiento: al publicar modelos nuevos, correr
 *  `FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/live.test.ts`
 *  y promover aquí los que pasen. Cuando el gateway arregle los 502, se
 *  pueden re-incorporar y eventualmente eliminar la lista blanca. */
export const VERIFIED_MODEL_IDS: ReadonlySet<string> = new Set([
	"SELENE-CIPHER",
	"ATHENA-LANCE",
	"ORPHEUS-VERSE",
	"AEOLUS-GALE",
	"ZEUS-THUNDER",
	"POSEIDON-DEEP",
	"KRONOS-VEIL",
	"HADES-PRIME",
	"OURANOS-CROWN",
	"DEMETER-BLOOM",
	"NIKE-VICTORY",
	"SATURN-RING",
	"MARS-SHIELD",
	"PHOEBE-DUST",
	"MERCURY-WING",
	"PUCK-SWIFT",
	"TITAN-CROWN",
	"AEGIS-WAVE",
	"HELIOS-BRIGHT",
	"OLYMPUS-PEAK",
	"OLYMPUS-GUST",
	"ATLAS-CROWN",
	"GAIA-GLEAM",
	"GAIA-FLARE",
	"GAIA-LOOM",
	"MIDAS-GOLD",
	"JANUS-GATE",
	"ORACLE-SIGHT",
	"PYTHIA-LENS",
	"SIBYL-GLASS",
	"TIRESIAS-PRISM",
	"model-router",
]);

/** Catálogo del SELECTOR (F3-c, 2026-08-16): los ⭐ MEDIDOS + el meta del
 *  gateway — criterio de razonamiento observable del reporte-reasoning.md
 *  (T4, effort high). El combo del webview muestra SÓLO éstos; el resto de
 *  VERIFIED sigue sembrando knowsModel (sesiones activas intactas) y el
 *  barrido T4 de salud. Para re-ampliar el selector, promover aquí (y en
 *  isSuggested si corresponde ⭐) tras re-correr la matriz live. */
export const SELECTED_MODEL_IDS: ReadonlySet<string> = new Set([
	"DEMETER-BLOOM", // ⭐ grande (686 reasoning_tokens)
	"TITAN-CROWN", // ⭐ mediano (721)
	"MIDAS-GOLD", // ⭐ compacto (805)
	"model-router", // meta: el gateway enruta por tarea
]);

/** GET {raíz}/v1/models con Bearer idToken. OJO: `baseUrl` aquí es la RAÍZ
 *  del gateway (sin /v1) — la función añade /v1/models ella misma; no
 *  confundir con el `baseUrl` por modelo que consume pi-ai (CON /v1). */
export async function fetchFridaEnterpriseModels(
	baseUrl: string,
	idToken: string,
): Promise<FridaEnterpriseModelConfig[]> {
	const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${idToken}` },
	});
	const text = await res.text();
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`GET /v1/models → HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	if (!res.ok) {
		throw new Error(
			`GET /v1/models → HTTP ${res.status}: ${json?.error?.message ?? text.slice(0, 300)}`,
		);
	}
	const list: any[] = Array.isArray(json?.data) ? json.data : [];
	const rootUrl = baseUrl.replace(/\/$/, "");
	const out = list
		.map((m) => toProviderModel(m, rootUrl))
		.filter((m): m is FridaEnterpriseModelConfig => m !== undefined)
		// Catálogo curado: sólo modelos con respuesta verificada en vivo
		.filter((m) => VERIFIED_MODEL_IDS.has(m.id))
		// F3-c: el SELECTOR muestra sólo los ⭐ medidos + meta (el resto de
		// VERIFIED alimenta knowsModel y el barrido de salud, no el combo).
		.filter((m) => SELECTED_MODEL_IDS.has(m.id))
		// Orden estable para el selector: clase grande → mediano → compacto
		// (⭐ sugerido abre cada bloque; luego ctx desc, empate → id asc) y
		// model-router (meta) SIEMPRE al final.
		.sort((a, b) => {
			if (a.id === "model-router") return 1;
			if (b.id === "model-router") return -1;
			const ka = classRank(a.id, a.contextWindow);
			const kb = classRank(b.id, b.contextWindow);
			if (ka !== kb) return ka - kb; // grande(0) < mediano(1) < compacto(2)
			if (isSuggested(a.id) !== isSuggested(b.id))
				return isSuggested(a.id) ? -1 : 1; // ⭐ abre el bloque
			return (
				b.contextWindow - a.contextWindow || a.id.localeCompare(b.id)
			);
		});
	dbg(
		`catálogo: ${list.length} brutos → ${out.length} verificados · ⭐ ${out
			.filter((m) => isSuggested(m.id))
			.map((m) => m.id)
			.join(", ") || "—"} · primero: ${out[0]?.name ?? "—"}`,
	);
	return out;
}

/** Catálogo de fallback (F3-d, 2026-08-16): los 4 SELECTED medidos — NO
 *  MODEL1..4 del gateway. Con el selector reducido (F3-c), el combo debe
 *  mostrar SÓLO estos modelos TAMBIÉN offline/sin store; el fallback de
 *  MODEL1..4 (AEOLUS/NIKE/TIRESIAS/SELENE) hacía ver modelos viejos que
 *  ya no deben aparecer. Metadatos medidos en la matriz live (ctx real del
 *  gateway; todos razonan vía /v1/responses, reporte-reasoning.md). Vacío
 *  sin envVars (pre-login no hay nada conocido).
 *  Los valores de contextWindow están clampeados a EFFECTIVE_CONTEXT_CEILING
 *  (200k) para coincidir con el clamp de toProviderModel — el gateway anuncia
 *  1M/400k pero el upstream Anthropic rechaza prompts >200k con 400
 *  (incidente 2025-08-19). */
const FALLBACK_SELECTED: FridaEnterpriseModelConfig[] = [
	{
		id: "DEMETER-BLOOM",
		name: "⭐ DEMETER-BLOOM (responses, grande 200k)",
		api: "openai-responses",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000, // clamp: gateway anuncia 1M, upstream acepta 200k
		maxTokens: 16_384,
	},
	{
		id: "TITAN-CROWN",
		name: "⭐ TITAN-CROWN (responses, mediano 200k)",
		api: "openai-responses",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000, // clamp: gateway anuncia 400k, upstream acepta 200k
		maxTokens: 16_384,
	},
	{
		id: "MIDAS-GOLD",
		name: "⭐ MIDAS-GOLD (responses, compacto 128k)",
		api: "openai-responses",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000, // sin clamp: ya está por debajo del ceiling
		maxTokens: 16_384,
	},
	{
		id: "model-router",
		name: "model-router (responses, meta)",
		api: "openai-responses",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000, // clamp: gateway anuncia 1M, upstream acepta 200k
		maxTokens: 16_384,
	},
];

/** Fallback offline: los SELECTED medidos (roles MODEL1..4 del gateway ya
 *  NO alimentan el selector). Devuelve [] pre-login (sin envVars). */
export function buildFallbackCatalog(
	envVars: FridaEnvVars,
): FridaEnterpriseModelConfig[] {
	const hasAny =
		!!envVars?.COMPATIBLE_API_URL ||
		!!envVars?.MODEL1 ||
		!!envVars?.MODEL2 ||
		!!envVars?.MODEL3 ||
		!!envVars?.MODEL4;
	return hasAny ? FALLBACK_SELECTED.map((m) => ({ ...m })) : [];
}
