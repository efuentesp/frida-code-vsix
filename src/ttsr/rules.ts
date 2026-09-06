// TTSR (#201, Fase 12 del roadmap UI/UX): reglas de stream.
//
// Reglas de proyecto que DUERMEN hasta que el modelo las viola: match regex
// sobre el contenido ACUMULADO del stream en vivo (text/thinking/toolargs) →
// abort del parcial → reinyección del recordatorio → reintento. Cero impuesto
// de contexto por turno: la regla no ocupa tokens hasta que hace falta.
//
// Módulo PURO (sin I/O, sin SDK): modelo + builtin rules + matching. La
// orquestación vive en coordinator.ts; los guards de estado en manager.ts.
//
// Deliberadamente V1: sólo regex (anyOf/allOf). astCondition (ast-grep vía
// pi-lens) queda para V2 — las builtins actuales son honestas con regex.

/** Partes del stream que una regla inspecciona. */
export type TtsrScope = "text" | "thinking" | "toolargs";

export interface TtsrRule {
	/** Id estable (settings lo referencian en frida.ttsr.disabledRules). */
	id: string;
	/** Qué protege (para el notify y el log). */
	description: string;
	/** Texto inyectado como mensaje steer tras el abort. NO debe contener los
	 *  patrones prohibidos (el modelo podría citarlos y re-disparar). */
	reminder: string;
	/** Scopes que inspecciona. */
	scopes: TtsrScope[];
	/** Bloquea si ALGUNA matchea (OR). Fuentes de regex (serializables). */
	anyOf: string[];
	/** Si se define, TODAS deben matchear además del anyOf (AND) — p. ej.
	 *  color Y path de webview en la misma llamada a edit/write. */
	allOf?: string[];
	/** once: 1 intervención por cadena de prompt; cooldown: re-interviene tras
	 *  cooldownMs. Independiente del modo, maxPerChain acota siempre. */
	repeatMode: "once" | "cooldown";
	cooldownMs?: number;
	/** Máximo de intervenciones por regla por cadena (anti-bucle). Default 2. */
	maxPerChain?: number;
}

/**
 * Reglas builtin de Frida (roadmap F12). Escritas para NO auto-matchearse:
 * los reminders describen la corrección sin citar los patrones prohibidos.
 */
export const BUILTIN_TTSR_RULES: readonly TtsrRule[] = [
	{
		id: "es-mx",
		description: "Español de México (modismos de España en texto visible)",
		reminder:
			"(Recordatorio automático TTSR) Escribe SIEMPRE en español de México " +
			"(es-MX), sin modismos ni conjugaciones de España. Dirígete al usuario " +
			"en segunda persona singular (tú/usted), nunca en plural. Corrige el " +
			"texto que estabas escribiendo y continúa desde donde ibas.",
		scopes: ["text"],
		repeatMode: "cooldown",
		cooldownMs: 30_000,
		anyOf: [
			"\\b(vosotros|vosotras|vuestro|vuestra|vuestros|vuestras)\\b",
			"\\b(tenéis|queréis|podéis|hacéis|sois|haced|tened|coged|podéis)\\b",
			"\\b(ordenador|vídeo)\\b",
		],
	},
	{
		id: "refs-not-closes",
		description:
			"Commits con Refs #N (no Closes/Fixes/Resolves — política del repo)",
		reminder:
			"(Recordatorio automático TTSR) La política de este repo exige " +
			"referenciar issues con 'Refs #N' en el cuerpo del commit — NUNCA con " +
			"cierres automáticos, porque el cierre lo hace el agente con " +
			"`gh issue close` tras verificar. Reescribe el mensaje del commit con " +
			"Refs #N y continúa.",
		scopes: ["text", "toolargs"],
		repeatMode: "cooldown",
		cooldownMs: 15_000,
		// Sin \b deliberado: en toolargs el JSON suele traer \n LITERAL antes de la
		// palabra (x\n\nCloses #N) y la "n" del escape rompe el word-boundary.
		anyOf: ["(closes?|fixes?|resolves?)\\s*:?\\s*#\\s*\\d+"],
	},
	{
		id: "vscode-tokens-ui",
		description: "Colores hardcodeados en UI del webview (usar var(--vscode-*))",
		reminder:
			"(Recordatorio automático TTSR) La UI del webview NO hardcodea colores: " +
			"usa los tokens de tema de VS Code con fallback, p. ej. " +
			"var(--vscode-focusBorder, #007fd4). Reescribe el CSS/estilo que estabas " +
			"generando usando tokens --vscode-* y continúa.",
		scopes: ["toolargs"],
		repeatMode: "once",
		anyOf: ["#[0-9a-fA-F]{6}\\b", "rgba?\\(\\s*\\d"],
		allOf: ["webview/|\\.css|\\.tsx|styles"],
	},
];

/** Regex compilada por regla (cache; las fuentes son estáticas). */
const compileCache = new Map<string, RegExp[]>();

function compiled(sources: readonly string[]): RegExp[] {
	const key = sources.join("\u0000");
	let hit = compileCache.get(key);
	if (!hit) {
		hit = [];
		for (const src of sources) {
			try {
				hit.push(new RegExp(src, "i"));
			} catch {
				// Fuente inválida (regla custom corrupta): se salta, no rompe TTSR.
			}
		}
		compileCache.set(key, hit);
	}
	return hit;
}

export interface TtsrMatch {
	/** Id de la regla que disparó. */
	ruleId: string;
	/** Scope donde matcheó. */
	scope: TtsrScope;
	/** El patrón (fuente) que matcheó — para diagnóstico. */
	pattern: string;
	/** Fragmento del stream que matcheó (acotado) — para diagnóstico. */
	fragment: string;
}

/**
 * Evalúa una regla contra el contenido acumulado de UN scope.
 * Devuelve el primer match (anyOf) que además cumpla allOf, o null.
 * Escaneo acotado a `maxScan` chars desde el final (mensajes largos: basta la
 * ventana reciente — las violaciones ocurren donde el modelo está escribiendo).
 */
export function matchRule(
	rule: TtsrRule,
	scope: TtsrScope,
	content: string,
	maxScan = 16_000,
): TtsrMatch | null {
	if (!rule.scopes.includes(scope) || !content) return null;
	const window = content.length > maxScan ? content.slice(-maxScan) : content;
	if (rule.allOf) {
		for (const re of compiled(rule.allOf)) {
			if (!re.test(window)) return null;
		}
	}
	for (const src of rule.anyOf) {
		for (const re of compiled([src])) {
			const m = re.exec(window);
			if (m) {
				return {
					ruleId: rule.id,
					scope,
					pattern: src,
					fragment: m[0].slice(0, 80),
				};
			}
		}
	}
	return null;
}

/**
 * Extrae el contenido acumulado por scope de un mensaje parcial del assistant
 * (el `partial` del AssistantMessageEvent). Los toolCall se serializan
 * (nombre + arguments) para que las regex operen sobre texto plano.
 */
export function extractScopes(partial: any): {
	text: string;
	thinking: string;
	toolargs: string;
} {
	const out = { text: "", thinking: "", toolargs: "" };
	const content = partial?.content;
	if (!Array.isArray(content)) return out;
	for (const item of content) {
		if (item?.type === "text" && typeof item.text === "string") {
			out.text += item.text;
		} else if (item?.type === "thinking" && typeof item.thinking === "string") {
			out.thinking += item.thinking;
		} else if (item?.type === "toolCall") {
			out.toolargs += `${item.name ?? ""}(${String(item.arguments ?? "")}) `;
		}
	}
	return out;
}
