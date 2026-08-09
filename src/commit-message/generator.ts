// Generador de mensajes de commit con el LLM activo de Frida.
//
// Reutiliza el patrón de `generateSessionTitle` (extension.ts): crea una sesión
// efímera sin tools (`noTools: "all"`) con un systemPrompt custom, envía el diff
// staged como prompt de usuario y extrae la respuesta del último mensaje del
// asistente. La sesión se descarta al terminar.

import * as fs from "node:fs";
import {
	createAgentSession,
	DefaultResourceLoader,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface CommitMessageConfig {
	format: "conventional" | "free";
	language: "es" | "en";
	includeBody: boolean;
	maxSubjectLength: number;
	/** Path a un archivo markdown que reemplaza el system prompt default. Vacío = sin template. */
	templatePath: string;
}

export interface GeneratorDeps {
	/** modelRuntime de la sesión activa de Frida (mismo tipo que frida.modelRuntime). */
	modelRuntime: any;
	/** Modelo activo (provider + id). Si es undefined, el SDK usa su default. */
	model: any;
	cwd: string;
	agentDir: string;
}

const CONVENTIONAL_TYPES =
	"feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert";

interface PromptStrings {
	role: string;
	formatHeader: string;
	typeLine: string;
	scopeLine: string;
	bodyRule: string;
	strict: string;
}

/** Genera los strings bilingües según idioma y configuración. */
function getPromptStrings(config: CommitMessageConfig): PromptStrings {
	const es = config.language === "es";
	const bodyRule = config.includeBody
		? es
			? "- Si el cambio es complejo (varios archivos o lógica no trivial), añade una línea en blanco y luego viñetas concisas que expliquen el qué y el porqué. Si es simple, omite el cuerpo."
			: "- If the change is complex (multiple files or non-trivial logic), add a blank line then concise bullet points explaining what and why. If simple, omit the body."
		: es
			? "- No incluyas cuerpo: sólo la línea de asunto."
			: "- Do not include a body: only the subject line.";
	const strict = es
		? "Reglas estrictas:\n- Responde SOLO el mensaje de commit. Sin explicaciones, sin prefijos como «Commit:», sin bloques de código markdown."
		: 'Strict rules:\n- Respond with ONLY the commit message. No explanations, no prefixes like "Commit:", no markdown code fences.';
	if (config.format === "free") {
		return {
			role: es
				? "Eres un generador experto de mensajes de commit. Analiza el diff staged y responde SOLO con el mensaje de commit."
				: "You are an expert commit message generator. Analyze the staged diff and respond with ONLY the commit message.",
			formatHeader: "",
			typeLine: "",
			scopeLine: es
				? `- Línea 1: descripción breve del cambio, en presente e imperativo, en español, sin punto final, máximo ${config.maxSubjectLength} caracteres.`
				: `- Line 1: a brief description of the change, present tense imperative, in English, no trailing period, at most ${config.maxSubjectLength} characters.`,
			bodyRule,
			strict,
		};
	}
	return {
		role: es
			? "Eres un generador experto de mensajes de commit en Conventional Commits. Analiza el diff staged y responde SOLO con el mensaje de commit."
			: "You are an expert Conventional Commits message generator. Analyze the staged diff and respond with ONLY the commit message.",
		formatHeader: es
			? "Formato Conventional Commits:"
			: "Conventional Commits format:",
		typeLine:
			(es ? "- tipos válidos: " : "- valid types: ") + CONVENTIONAL_TYPES + ".",
		scopeLine: es
			? "- scope: infiérelo del módulo o directorio principal tocado (ej. src/providers/ → providers). Omítelo si no hay uno claro."
			: "- scope: infer it from the main module/directory touched (e.g. src/providers/ → providers). Omit if unclear.",
		bodyRule,
		strict,
	};
}

/**
 * Construye el system prompt según la configuración. Si `templatePath` apunta a
 * un archivo existente, su contenido REEMPLAZA el prompt default (permite reglas
 * de equipo: ticket JIRA obligatorio, scope fijo, etc.). Soporta los placeholders
 * `{language}`, `{maxSubjectLength}` y `{types}`.
 */
function buildSystemPrompt(config: CommitMessageConfig): string {
	const custom = readTemplate(config);
	if (custom !== undefined) return custom;

	const s = getPromptStrings(config);
	const subjectLine =
		config.format === "conventional"
			? config.language === "es"
				? `- descripción: en presente e imperativo, en español, sin punto final, máximo ${config.maxSubjectLength} caracteres.`
				: `- description: present tense imperative, in English, no trailing period, at most ${config.maxSubjectLength} characters.`
			: s.scopeLine;
	const lines = [s.role, ""];
	if (s.formatHeader) lines.push(s.formatHeader);
	if (config.format === "conventional") {
		lines.push(
			config.language === "es"
				? "- Línea 1: `tipo(scope): descripción`"
				: "- Line 1: `type(scope): description`",
		);
		lines.push(s.typeLine, s.scopeLine);
	} else {
		lines.push(s.scopeLine);
	}
	if (config.format === "conventional") {
		lines.push(subjectLine);
	} else {
		lines.push(subjectLine);
	}
	lines.push(s.bodyRule, "", s.strict);
	return lines.join("\n");
}

/** Lee el template custom si existe. undefined si no hay template. */
function readTemplate(config: CommitMessageConfig): string | undefined {
	if (!config.templatePath) return undefined;
	// El templatePath llega ya resuelto a absoluto desde loadCommitMessageConfig
	// (setting relativo → cwd; default → ~/.frida/commit-message-prompt.md).
	let content: string;
	try {
		content = fs.readFileSync(config.templatePath, "utf8");
	} catch {
		return undefined; // archivo inexistente → default prompt
	}
	return content
		.replaceAll("{language}", config.language)
		.replaceAll("{maxSubjectLength}", String(config.maxSubjectLength))
		.replaceAll("{types}", CONVENTIONAL_TYPES);
}

/** Construye el prompt de usuario con el diff staged. */
function buildUserPrompt(diff: string, config: CommitMessageConfig): string {
	const header =
		config.language === "es"
			? "Genera el mensaje de commit para el siguiente diff staged:"
			: "Generate the commit message for the following staged diff:";
	return `${header}\n\n\`\`\`diff\n${diff}\n\`\`\``;
}

/**
 * Limpia la respuesta del LLM: quita bloques de código markdown, prefijos y
 * comillas envolventes. Conserva los saltos de línea del cuerpo.
 */
function cleanMessage(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	let text = raw.trim();
	// Quitar bloque de código markdown completo (```...\n```)
	text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
	// Quitar prefijos tipo "Commit:", "Mensaje:", "Message:"
	text = text.replace(/^(commit|mensaje|message)\s*[:：]\s*/i, "");
	text = text.trim();
	return text || undefined;
}

/** Extrae el texto del último mensaje del asistente (mismo patrón que extension.ts). */
function extractLastAssistantText(
	messages: Array<{ role?: string; content?: unknown }> | undefined,
): string | undefined {
	if (!messages) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		const c = msg.content;
		if (typeof c === "string") return c;
		if (Array.isArray(c)) {
			const texts = c
				.filter(
					(x): x is { type: "text"; text: string } =>
						typeof x === "object" &&
						x !== null &&
						(x as { type?: string }).type === "text" &&
						typeof (x as { text?: unknown }).text === "string",
				)
				.map((x) => x.text);
			if (texts.length) return texts.join("\n");
		}
	}
	return undefined;
}

/** Límite razonable para el diff en el prompt (~10k caracteres). */
const MAX_DIFF_CHARS = 10_000;

function truncateDiff(diff: string): string {
	if (diff.length <= MAX_DIFF_CHARS) return diff;
	const omitted = diff.length - MAX_DIFF_CHARS;
	return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (diff truncado: ${omitted} caracteres omitidos; enfócate en lo mostrado)`;
}

/**
 * Crea una sesión efímera sin tools, envía el diff y devuelve el mensaje generado.
 * Reutiliza el patrón de generateSessionTitle (extension.ts).
 */
export async function generateCommitMessage(
	diff: string,
	config: CommitMessageConfig,
	deps: GeneratorDeps,
): Promise<string | undefined> {
	const { modelRuntime, model, cwd, agentDir } = deps;
	if (!modelRuntime) return undefined;

	const settingsManager = SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		systemPrompt: buildSystemPrompt(config),
	});
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		...(model ? { model } : {}),
		noTools: "all",
	});
	try {
		await session.prompt(buildUserPrompt(truncateDiff(diff), config));
		const messages = (
			session as unknown as {
				state?: {
					messages?: Array<{ role?: string; content?: unknown }>;
				};
			}
		).state?.messages;
		return cleanMessage(extractLastAssistantText(messages));
	} finally {
		await (
			session as unknown as { dispose?: () => Promise<void> | void }
		).dispose?.();
	}
}
