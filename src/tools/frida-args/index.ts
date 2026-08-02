// frida-args — argumentos y sustitución de shell para skills.
//
// Porte de @juicesharp/rpiv-args v2.3.0 (MIT, juicesharp) como extensión nativa
// embebida de Frida. Misma funcionalidad y contratos, reorganizada como factory
// (patrón de frida-context/frida-lens) en vez de paquete pi-extension suelto.
//
// Qué añade a las skills (.frida/skills, ~/.frida/skills):
//   - Placeholders estilo shell: $1, $2… $N, $ARGUMENTS, $@, ${@:N}, ${@:N:L}
//   - Variables de runtime: ${SKILL_DIR}, ${SESSION_ID}
//   - Sustitución de shell: !`cmd` (inline) y ```! … ``` (bloque multilínea)
//
// Superficie completa: 3 hooks de Pi (input, before_agent_start, session_start).
// No registra tools, ni comandos, ni keybindings. Es 100% headless → funciona
// completo en el modo rpc del webview de Frida.
//
// Tubería (hook `input`, se ejecuta ANTES del expansor nativo _expandSkillCommand):
//   strip frontmatter
//     → $N/$ARGUMENTS (sólo si el cuerpo tenía placeholders)
//     → ${SKILL_DIR}/${SESSION_ID} (siempre)
//     → ejecución de !`cmd` / ```! (siempre: bloques primero, luego inlines)
//     → envolver en <skill name="…" location="…">…</skill>  (byte-exacto vs parseSkillBlock)
//
// Si una skill no tiene placeholders ni sintaxis de shell, la salida es byte-
// idéntica a la expansión nativa de Pi → instalar frida-args es un no-op para
// skills existentes.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExecResult,
	formatSize,
	parseFrontmatter,
	stripFrontmatter,
	type TruncationResult,
	truncateTail,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Tokens y constantes
// ---------------------------------------------------------------------------

/** Coincide cualquier placeholder que substituteArgs reemplazaría. Sirve como
 *  compuerta opt-in para la ruta de sustitución $N/$ARGUMENTS Y como bandera
 *  (hadTokens) que decide el sufijo de argumentos final. */
const TOKEN_REGEX = /\$(?:\d+|ARGUMENTS|@|\{@:\d+(?::\d+)?\})/;

/** Prefijo que Pi usa para las skills. Tokenización por espacio simple. */
const SKILL_PREFIX = "/skill:";

/** Guarda de re-entrada: texto ya envuelto pasa intacto. */
const WRAPPED_PREFIX = "<skill ";

/** Techo por defecto para la ejecución de shell: 2 minutos. El frontmatter
 *  `shell-timeout` (segundos) lo sobreescribe; `0` lo desactiva. */
const DEFAULT_SHELL_TIMEOUT_MS = 120_000;

/** Shell inline: !`comando` — no cruza newlines, no greedy. El capture exige al
 *  menos un char para que un `` !`` `` literal en prosa no ejecute el shell con
 *  un `-c` vacío. Debe ser /g (se consume con matchAll). */
const SHELL_INLINE_PATTERN = /!`([^`\n]+)`/g;

/** Shell en bloque: ```!\n…\n``` — multiline no greedy. El contenido va al shell
 *  como un solo programa (se preservan los newlines). Debe ser /g. */
const SHELL_BLOCK_PATTERN = /```!\n([\s\S]*?)\n```/g;

// ---------------------------------------------------------------------------
// Tokenizador — byte-equivalente a parseCommandArgs de Pi. Divide el string de
// argumentos estilo shell (comillas dobles y simples, split por espacio/tab).
// ---------------------------------------------------------------------------

export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];
		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current) args.push(current);
	return args;
}

// ---------------------------------------------------------------------------
// Sustituidor de argumentos — byte-equivalente a substituteArgs de Pi.
// Orden: $N primero, luego ${@:N[:L]}, luego $ARGUMENTS, luego $@. El orden es
// determinante: como $N corre primero, un valor que contenga $1 NO se re-
// expande al caer en el cuerpo vía $ARGUMENTS o un slice. No hay sustitución
// recursiva.
// ---------------------------------------------------------------------------

export function substituteArgs(content: string, args: string[]): string {
	let result = content;
	result = result.replace(
		/\$(\d+)/g,
		(_, num) => args[parseInt(num, 10) - 1] ?? "",
	);
	result = result.replace(
		/\$\{@:(\d+)(?::(\d+))?\}/g,
		(_, startStr, lengthStr) => {
			let start = parseInt(startStr, 10) - 1;
			if (start < 0) start = 0;
			if (lengthStr) {
				const length = parseInt(lengthStr, 10);
				return args.slice(start, start + length).join(" ");
			}
			return args.slice(start).join(" ");
		},
	);
	const allArgs = args.join(" ");
	result = result.replace(/\$ARGUMENTS/g, allArgs);
	result = result.replace(/\$@/g, allArgs);
	return result;
}

// ---------------------------------------------------------------------------
// Sustitución de variables — mecánica, corre después de $N/$ARGUMENTS y antes
// del shell. La normalización de barras invertidas sólo aplica en Windows
// (gated en process.platform) para que una ruta POSIX con backslash literal se
// preserve byte a byte.
// ---------------------------------------------------------------------------

export function substituteVariables(
	body: string,
	vars: { skillDir: string; sessionId: string },
): string {
	const skillDir =
		process.platform === "win32"
			? vars.skillDir.split("\\").join("/")
			: vars.skillDir;
	return body
		.replace(/\$\{SKILL_DIR\}/g, skillDir)
		.replace(/\$\{SESSION_ID\}/g, vars.sessionId);
}

// ---------------------------------------------------------------------------
// Resolución de shell-timeout desde el frontmatter.
//
// La coerción de escalares YAML puede dar number, string, boolean, null, NaN o
// Infinity. Number.isFinite es determinante: NaN falsearía el corto-circuito
// `timeout > 0` de exec.js y desactivaría el timer silenciosamente; Infinity
// haría que setTimeout lo clampee a 1ms (kill inmediato). `0` se respeta como
// desactivación explícita.
// ---------------------------------------------------------------------------

export function resolveShellTimeoutMs(frontmatter: {
	"shell-timeout"?: unknown;
}): number {
	const raw = frontmatter["shell-timeout"];
	if (raw === undefined) return DEFAULT_SHELL_TIMEOUT_MS;
	if (typeof raw !== "number" || !Number.isFinite(raw))
		return DEFAULT_SHELL_TIMEOUT_MS;
	if (raw < 0) return DEFAULT_SHELL_TIMEOUT_MS;
	if (raw === 0) return 0;
	return raw * 1000;
}

// ---------------------------------------------------------------------------
// Ejecución de shell.
//
// Orden: bloques primero, luego inlines. Es determinante: el grupo de captura
// del bloque `[\s\S]*?` puede legítimamente contener `!\``; si corriera inline
// primero, se comería backticks del contenido del bloque.
//
// Iteración secuencial estricta (nunca Promise.all): los autores de skills
// confían en que !`mkdir x` → !`ls x` respete el orden.
//
// pi.exec NUNCA rechaza (toda ruta de terminación resuelve), así que no hace
// falta try/catch. sh -c en POSIX, powershell.exe -Command en Windows.
//
// Orden de la rama: killed → code !== 0 → success. `killed` se chequea primero
// porque un proceso matado por timeout puede reportar también code != 0.
// ---------------------------------------------------------------------------

/** Trunca una cadena para consumo del LLM: presupuesto de cola 50KB / 2000
 *  líneas, con footer `[truncated: hit ...]` cuando truncó. Compartido por la
 *  ruta de éxito y la de exit != 0 para que un stderr de varios MB de un
 *  `!`npm test`` fallido no sobrepase el presupuesto. */
function truncateForLLM(content: string): string {
	const trunc: TruncationResult = truncateTail(content, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	let out = trunc.content;
	if (trunc.truncated) {
		const limit =
			trunc.truncatedBy === "lines"
				? `${trunc.maxLines} lines`
				: formatSize(trunc.maxBytes);
		out += `\n[truncated: hit ${limit}]`;
	}
	return out;
}

function formatShellOutput(res: ExecResult): string {
	let combined = res.stdout;
	if (res.stderr && res.stderr.length > 0) {
		const sep = combined.length === 0 || combined.endsWith("\n") ? "" : "\n";
		combined = `${combined}${sep}[stderr]\n${res.stderr}`;
	}
	return truncateForLLM(combined);
}

async function runOneShellCommand(
	command: string,
	pi: ExtensionAPI,
	cwd: string,
	timeoutMs: number,
): Promise<string> {
	const [shCmd, shFlag] =
		process.platform === "win32"
			? ["powershell.exe", "-Command"]
			: ["sh", "-c"];
	const res: ExecResult = await pi.exec(shCmd, [shFlag, command], {
		cwd,
		timeout: timeoutMs,
	});
	if (res.killed) {
		// Piso en 1s para que un shell-timeout sub-segundo no muestre el contradictorio
		// "timed out after 0s".
		const sec = Math.max(1, Math.round(timeoutMs / 1000));
		return `[Shell error: timed out after ${sec}s]`;
	}
	if (res.code !== 0) {
		return `[Shell error: exit code ${res.code}]\n${truncateForLLM(res.stderr)}`;
	}
	return formatShellOutput(res);
}

/** Estrategia mask-and-restore: pasada de bloques primero, reemplazando cada
 *  match con un centinela no imprimible (`\x00BLOCK${n}\x00`) que el regex
 *  inline NO puede coincidir (los centinelas no tienen backticks). Luego la
 *  pasada de inline sobre el string con centinelas. Al final se restauran los
 *  centinelas a las salidas de bloque. Garantiza que un stdout de bloque con
 *  `!`...`` literal NUNCA se re-ejecute en la pasada inline. */
export async function executeShellInBody(
	body: string,
	pi: ExtensionAPI,
	cwd: string,
	timeoutMs: number,
): Promise<string> {
	const blockOutputs: string[] = [];
	let withSentinels = "";
	{
		const matches = [...body.matchAll(SHELL_BLOCK_PATTERN)];
		let last = 0;
		for (const m of matches) {
			const idx = m.index ?? 0;
			withSentinels += body.slice(last, idx);
			withSentinels += `\x00BLOCK${blockOutputs.length}\x00`;
			blockOutputs.push(
				await runOneShellCommand(m[1] ?? "", pi, cwd, timeoutMs),
			);
			last = idx + m[0].length;
		}
		withSentinels += body.slice(last);
	}
	let withInlines = "";
	{
		const matches = [...withSentinels.matchAll(SHELL_INLINE_PATTERN)];
		let last = 0;
		for (const m of matches) {
			const idx = m.index ?? 0;
			withInlines += withSentinels.slice(last, idx);
			withInlines += await runOneShellCommand(m[1] ?? "", pi, cwd, timeoutMs);
			last = idx + m[0].length;
		}
		withInlines += withSentinels.slice(last);
	}
	return withInlines.replace(
		/\x00BLOCK(\d+)\x00/g,
		(_, n) => blockOutputs[parseInt(n, 10)] ?? "",
	);
}

// ---------------------------------------------------------------------------
// Índice de skills — se construye una vez (lazy) desde el registry de comandos
// de Pi y se cachea por sesión. Se invalida en session_start(reload|startup).
// ---------------------------------------------------------------------------

export interface SkillIndexEntry {
	readonly name: string;
	readonly filePath: string;
	readonly baseDir: string;
}

let skillIndex: Map<string, SkillIndexEntry> | null = null;

export function invalidateSkillIndex(): void {
	skillIndex = null;
}

/** Construye el índice name→path desde el registry de comandos de Pi.
 *  `pi.getCommands()` devuelve todo slash command visible — incluyendo skills
 *  declaradas por manifiestos de paquetes (`pi.skills: [...]`), no sólo las del
 *  walk del FS. Es la fuente autoritativa. */
function buildSkillIndex(pi: ExtensionAPI): Map<string, SkillIndexEntry> {
	const index = new Map<string, SkillIndexEntry>();
	for (const cmd of pi.getCommands()) {
		if (cmd.source !== "skill") continue;
		// Pi prefija los comandos de skill con "skill:".
		const name = cmd.name.startsWith("skill:")
			? cmd.name.slice("skill:".length)
			: cmd.name;
		const filePath = cmd.sourceInfo.path;
		// No se puede usar cmd.sourceInfo.baseDir: para skills de un manifiesto de
		// extensión, el loader sobreescribe baseDir con el del paquete, no el del
		// folder de la skill. El Skill.baseDir interno de Pi es dirname(filePath),
		// que es lo que esperan las sustituciones ${SKILL_DIR}.
		const baseDir = dirname(filePath);
		index.set(name, { name, filePath, baseDir });
	}
	return index;
}

function getSkillIndex(pi: ExtensionAPI): Map<string, SkillIndexEntry> {
	if (!skillIndex) skillIndex = buildSkillIndex(pi);
	return skillIndex;
}

// ---------------------------------------------------------------------------
// Emisión del wrapper — byte-exacto contra el regex parseSkillBlock de Pi y
// byte-equivalente a la salida de _expandSkillCommand. No reformatear.
// ---------------------------------------------------------------------------

export function buildSkillBlock(entry: SkillIndexEntry, body: string): string {
	return `<skill name="${entry.name}" location="${entry.filePath}">\nReferences are relative to ${entry.baseDir}.\n\n${body}\n</skill>`;
}

export function appendArgs(skillBlock: string, args: string): string {
	return args ? `${skillBlock}\n\n${args}` : skillBlock;
}

/** Etiqueta del trailer para la ruta con tokens. Una etiqueta de prosa (no un
 *  wrapper XML): el renderer interactivo de Pi muestra el post-`</skill>` tal
 *  cual en una caja de mensaje de usuario, así que etiquetas crudas se verían
 *  en la UI. Referenciada por SKILL_INVOCATION_PROTOCOL abajo. */
export const SKILL_INPUT_LABEL = "Skill input:";

/** Trailer para la ruta con tokens: lleva la cadena de argumentos CRUDOS,
 *  etiquetada, tras `</skill>` para que el argumento sobreviva como señal
 *  inequívoca aun cuando la sustitución lo teja en slots del cuerpo con forma
 *  de doc. Args vacíos no emiten trailer. */
export function appendSkillInput(skillBlock: string, args: string): string {
	return args ? `${skillBlock}\n\n${SKILL_INPUT_LABEL} ${args}` : skillBlock;
}

// ---------------------------------------------------------------------------
// Handler de input — tubería asíncrona.
//
// `pi` se pasa como 3er parámetro (no se captura a nivel de módulo) para que la
// extensión no adquiera estado singleton nuevo. `ctx` lleva el sessionManager
// para ${SESSION_ID}.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Expansión reutilizable — única fuente de verdad para el bloque <skill>.
// El hook `input` (handleInput) y el host de Frida (runPrompt, para mostrar el
// bloque en vivo en el webview) llaman AMBOS a expandSkillText → el texto que
// ve el modelo es idéntico al que se renderiza. El host envía el bloque ya
// expandido a session.prompt; la guardia de re-entrada de handleInput lo deja
// pasar intacto (empieza con "<skill "), así que NO hay doble expansión ni
// doble ejecución de shell.
// ---------------------------------------------------------------------------

export interface ExpandSkillDeps {
	/** ExtensionAPI de Pi: provee getCommands() (índice de skills) y exec (shell). */
	pi: ExtensionAPI;
	/** ID de la sesión para ${SESSION_ID}. */
	sessionId: string;
	/** cwd para la ejecución de !`cmd` / ```! (normalmente el workspace). */
	cwd: string;
}

/** Expande `/skill:<name> <args>` al bloque `<skill>` completo (mismo pipeline
 *  que handleInput). Devuelve `null` cuando el texto no es invocación de skill,
 *  la skill es desconocida o falla la lectura → el llamador cae al comportamiento
 *  por defecto (texto crudo, que Pi/_expandSkillCommand manejará). Nunca lanza. */
export async function expandSkillText(
	text: string,
	deps: ExpandSkillDeps,
): Promise<string | null> {
	if (text.startsWith(WRAPPED_PREFIX)) return null; // ya envuelto
	if (!text.startsWith(SKILL_PREFIX)) return null;

	// Tokenización por espacio simple — byte-match con Pi.
	const spaceIndex = text.indexOf(" ");
	const skillName =
		spaceIndex === -1
			? text.slice(SKILL_PREFIX.length)
			: text.slice(SKILL_PREFIX.length, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

	const entry = getSkillIndex(deps.pi).get(skillName);
	if (!entry) return null; // skill desconocido → que Pi lo maneje

	let content: string;
	try {
		content = readFileSync(entry.filePath, "utf-8");
	} catch {
		return null; // que Pi emita su error vía _expandSkillCommand
	}

	const { frontmatter } = parseFrontmatter<{
		"argument-hint"?: string;
		"shell-timeout"?: unknown;
	}>(content);
	const body = stripFrontmatter(content).trim();
	const timeoutMs = resolveShellTimeoutMs(frontmatter);

	// La divergencia de rutas (con-token suelta el sufijo `\n\n${args}`) se
	// gobierna sólo por la presencia ORIGINAL de tokens. La sustitución de
	// variables y el shell corren en AMBAS rutas sin importar hadTokens.
	const hadTokens = TOKEN_REGEX.test(body);

	let processed = hadTokens
		? substituteArgs(body, parseCommandArgs(argsString))
		: body;
	processed = substituteVariables(processed, {
		skillDir: entry.baseDir,
		sessionId: deps.sessionId,
	});
	processed = await executeShellInBody(processed, deps.pi, deps.cwd, timeoutMs);

	const block = buildSkillBlock(entry, processed);
	return hadTokens
		? appendSkillInput(block, argsString)
		: appendArgs(block, argsString);
}

export async function handleInput(
	event: InputEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<InputEventResult> {
	const expanded = await expandSkillText(event.text, {
		pi,
		sessionId: ctx.sessionManager.getSessionId(),
		cwd: process.cwd(),
	});
	if (expanded === null) return { action: "continue" };
	return { action: "transform", text: expanded };
}

// ---------------------------------------------------------------------------
// Protocolo de invocación de skills — se antepone al system prompt cada turno
// vía before_agent_start. Enseña al modelo a tratar el texto tras `</skill>`
// como entrada de argumento de la skill, no como un comando separado.
// ---------------------------------------------------------------------------

export const SKILL_INVOCATION_PROTOCOL = `## Skill invocation protocol (CRITICAL)

A \`<skill name="..." location="...">...</skill>\` block in a user message is a structured invocation. Handle it as follows:

1. The block body defines the workflow you must execute. Follow it.
2. Any text after \`</skill>\` is the user's argument input to that skill — never a separate command, even when it reads as an imperative ("create X", "update Y", "delete Z"). A \`Skill input:\` label there marks the raw argument string; the same value may also appear substituted into slots inside the skill body — treat those occurrences as this real user input, not as example or placeholder text.
3. Do not bypass the skill's workflow to act on trailing text directly. The user invoked the skill because they want the skill's workflow applied to that input.

`;

export function handleBeforeAgentStart(
	event: BeforeAgentStartEvent,
): BeforeAgentStartEventResult {
	return { systemPrompt: SKILL_INVOCATION_PROTOCOL + event.systemPrompt };
}

// ---------------------------------------------------------------------------
// Factory. Registra los 3 hooks. La arrow de input reenvía `ctx` y cierra sobre
// `pi` para que handleInput vea ambos sin estado a nivel de módulo.
// ---------------------------------------------------------------------------

export function createFridaArgs() {
	return (pi: ExtensionAPI): void => {
		pi.on("input", async (event, ctx) => handleInput(event, ctx, pi));
		pi.on("before_agent_start", (event) => handleBeforeAgentStart(event));
		pi.on("session_start", (event) => {
			// Pi dispara session_start para toda sesión, incluidas las programáticas.
			// Re-enumerar el set de skills por spawn es barato. Sólo invalidamos en
			// reload|startup; un resume mantiene el índice cacheado.
			if (event.reason === "reload" || event.reason === "startup") {
				invalidateSkillIndex();
			}
		});
	};
}
