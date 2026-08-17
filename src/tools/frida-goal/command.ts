// frida-goal — parser del comando /goal (porte de pi-goal/command.ts, MVP).
//
// Gramática: /goal [status] · /goal <objetivo> [--tokens Nk] ·
// /goal pause|resume|clear|edit <nuevo objetivo> [--tokens Nk].
// Tokenizer con comillas dobles/simples para objetivos multi-palabra.

/** Máx 4000 chars como el upstream. */
export const MAX_OBJECTIVE_LENGTH = 4_000;

export type CommandResult =
	| { kind: "start"; objective: string; tokenBudget?: number }
	| { kind: "edit"; objective: string; tokenBudget?: number }
	| { kind: "pause" }
	| { kind: "resume" }
	| { kind: "clear" }
	| { kind: "show" };

/** Parsea los args del comando; string = mensaje de uso (error). */
export function parseCommand(args: string): CommandResult | string {
	const tokens = tokenize(args.trim());
	if (tokens.length === 0) return { kind: "show" };
	const [first, ...rest] = tokens;
	switch (first) {
		case "pause":
			return rest.length === 0 ? { kind: "pause" } : "Uso: /goal pause";
		case "resume":
			return rest.length === 0 ? { kind: "resume" } : "Uso: /goal resume";
		case "clear":
		case "stop":
			return rest.length === 0 ? { kind: "clear" } : "Uso: /goal clear";
		case "status":
			return rest.length === 0 ? { kind: "show" } : "Uso: /goal status";
		case "edit":
			return parseObjective("edit", rest);
		default:
			return parseObjective("start", tokens);
	}
}

/** "--tokens 100k" | "--tokens=100k" | "--tokens 150000" → número. */
export function parseTokenBudget(raw: string): number | undefined {
	const value = raw.trim().toLowerCase();
	const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(value);
	if (!m) return undefined;
	const n = Number(m[1]);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1;
	const total = Math.round(n * mult);
	return total > 0 && Number.isSafeInteger(total) ? total : undefined;
}

/** Valida el objetivo: no vacío, sin marcadores propios, ≤ 4000. */
export function validateObjective(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed.length === 0) return "El objetivo no puede estar vacío.";
	if (trimmed.length > MAX_OBJECTIVE_LENGTH)
		return `El objetivo excede ${MAX_OBJECTIVE_LENGTH} caracteres (tiene ${trimmed.length}).`;
	if (/<!--\s*frida-goal-(?:prompt|continuation):/.test(trimmed))
		return "El objetivo contiene marcadores internos de frida-goal.";
	return undefined;
}

/** Extrae {objective, tokenBudget?} de los tokens; undefined = sin --tokens. */
export function splitObjectiveTokens(
	tokens: string[],
): { objective: string; tokenBudget?: number } | string {
	// Busca --tokens al final (últimos 1-2 tokens) o =inline.
	let budget: number | undefined;
	let objectiveTokens = [...tokens];
	for (let i = 0; i < objectiveTokens.length; i++) {
		const t = objectiveTokens[i]!;
		if (t === "--tokens" || t.startsWith("--tokens=")) {
			const inline = t.startsWith("--tokens=")
				? t.slice("--tokens=".length)
				: objectiveTokens[i + 1];
			if (inline === undefined)
				return "Uso: --tokens <presupuesto> (ej. --tokens 100k).";
			budget = parseTokenBudget(inline);
			if (budget === undefined)
				return `Presupuesto inválido: "${inline}". Usa N, Nk oNm (ej. 100k).`;
			objectiveTokens = objectiveTokens.filter((_, j) =>
				t.startsWith("--tokens=") ? j !== i : j !== i && j !== i + 1
			);
			break;
		}
	}
	const objective = objectiveTokens.join(" ").trim();
	const err = validateObjective(objective);
	if (err) return err;
	return { objective, tokenBudget: budget };
}

function parseObjective(
	kind: "start" | "edit",
	tokens: string[],
): CommandResult | string {
	const split = splitObjectiveTokens(tokens);
	if (typeof split === "string") return split;
	if (split.objective === "")
		return kind === "start"
			? "Uso: /goal <objetivo> [--tokens Nk]"
			: "Uso: /goal edit <nuevo objetivo>";
	return { kind, objective: split.objective, tokenBudget: split.tokenBudget };
}

/** Tokenizer simple con soporte de comillas. */
export function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i]!;
		if (quote) {
			if (ch === quote) quote = undefined;
			else current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current) tokens.push(current);
	return tokens;
}
