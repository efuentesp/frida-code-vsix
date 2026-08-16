// frida-subagents — parser del log.jsonl de un run detached (issue #26).
//
// El child corre `pi -p --mode json`: cada evento de sesión sale como una
// línea JSON por stdout (que fue a parar directo al log file). Aquí
// convertimos ese stream en (a) progreso en vivo para el widget/panel y
// (b) el resultado final + tokens (#18) al completar. Mismos tipos de
// evento que consume subscribeAgentProgress in-process — sin proceso no hay
// suscripción: el log ES la suscripción.

/** Evento JSON del stream `--mode json` (forma relajada — líneas corruptas se saltan). */
interface JsonEvent {
	type: string;
	toolName?: string;
	usage?: { input?: number; output?: number };
	assistantMessageEvent?: { type?: string; delta?: string };
	message?: {
		role?: string;
		usage?: { input?: number; output?: number };
		content?: unknown;
	};
}

/** Progreso en vivo derivado del tail del log. */
export interface DetachedProgress {
	turnCount: number;
	toolUses: number;
	tokensIn: number;
	tokensOut: number;
	/** One-liner de actividad: herramienta en curso o "escribiendo…". */
	activity: string;
	/** Último texto parcial (para detalle). */
	lastText: string;
}

export interface DetachedOutcome {
	status: "completed" | "failed";
	/** Texto del último mensaje del asistente. */
	result: string;
	tokensIn: number;
	tokensOut: number;
	turnCount: number;
}

/** Parsea una línea JSON; undefined si no es JSON válido o está incompleta. */
function parseLine(line: string): JsonEvent | undefined {
	const t = line.trim();
	if (!t.startsWith("{")) return undefined;
	try {
		return JSON.parse(t) as JsonEvent;
	} catch {
		return undefined; // línea partida a medias por el tail
	}
}

/** Extrae texto plano del content de un message_end assistant. */
function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c) =>
				typeof c === "object" &&
				c !== null &&
				(c as { type?: string }).type === "text" &&
				typeof (c as { text?: unknown }).text === "string",
		)
		.map((c) => (c as { text: string }).text)
		.join("\n");
}

/**
 * Lee las últimas `maxBytes` del log y devuelve las líneas completas.
 * Bounded: un log de 50 MB nunca se carga entero para progreso.
 */
export function tailLogLines(logPath: string, maxBytes = 64 * 1024): string[] {
	const fs = require("node:fs") as typeof import("node:fs");
	let buf: Buffer;
	try {
		const fd = fs.openSync(logPath, "r");
		try {
			const size = fs.fstatSync(fd).size;
			const start = Math.max(0, size - maxBytes);
			buf = Buffer.alloc(size - start);
			fs.readSync(fd, buf, 0, buf.length, start);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return [];
	}
	const text = buf.toString("utf8");
	// Si cortamos a medias una línea, la primera queda incompleta → descartar.
	const lines = text.split("\n").filter((l) => l.trim());
	if (startWasMidLine(text) && lines.length > 0) lines.shift();
	return lines;
}

function startWasMidLine(text: string): boolean {
	return text.length > 0 && !text.startsWith("{");
}

/**
 * Progreso en vivo desde el tail del log: cuenta eventos, acumula usage de
 * los message_end y describe la actividad actual (herramienta abierta o
 * texto en curso).
 */
export function parseProgressFromLines(lines: string[]): DetachedProgress {
	const p: DetachedProgress = {
		turnCount: 0,
		toolUses: 0,
		tokensIn: 0,
		tokensOut: 0,
		activity: "iniciando…",
		lastText: "",
	};
	let openTool: string | undefined;
	for (const line of lines) {
		const ev = parseLine(line);
		if (!ev) continue;
		if (ev.type === "tool_execution_start") {
			openTool = ev.toolName ?? "tool";
			p.toolUses++;
		} else if (ev.type === "tool_execution_end") {
			openTool = undefined;
		} else if (ev.type === "turn_end") {
			p.turnCount++;
			openTool = undefined;
		} else if (ev.type === "message_update") {
			const ae = ev.assistantMessageEvent;
			if (ae?.type === "text_delta" && typeof ae.delta === "string") {
				p.lastText = (p.lastText + ae.delta).slice(-2000);
			}
		} else if (ev.type === "message_end" && ev.message?.role === "assistant") {
			const u = ev.message.usage;
			if (u) {
				p.tokensIn += u.input ?? 0;
				p.tokensOut += u.output ?? 0;
			}
			const txt = textFromContent(ev.message.content);
			if (txt) p.lastText = txt.slice(-2000);
		}
	}
	p.activity = openTool ? `${openTool}…` : p.lastText ? "escribiendo…" : "pensando…";
	return p;
}

/** Atajo: progreso en vivo de un run (tail bounded). */
export function readProgress(logPath: string): DetachedProgress {
	return parseProgressFromLines(tailLogLines(logPath));
}

/**
 * Escaneo COMPLETO del log (una sola vez, al finalizar): resultado, tokens
 * totales (#18) y turnos. Sin bounded tail — el archivo ya no crece.
 */
export function parseOutcome(logPath: string): DetachedOutcome | undefined {
	const fs = require("node:fs") as typeof import("node:fs");
	let text: string;
	try {
		text = fs.readFileSync(logPath, "utf8");
	} catch {
		return undefined;
	}
	const out: DetachedOutcome = {
		status: "failed",
		result: "",
		tokensIn: 0,
		tokensOut: 0,
		turnCount: 0,
	};
	let sawAssistant = false;
	for (const line of text.split("\n")) {
		const ev = parseLine(line);
		if (!ev) continue;
		if (ev.type === "turn_end") out.turnCount++;
		if (ev.type === "message_end" && ev.message?.role === "assistant") {
			const u = ev.message.usage;
			if (u) {
				out.tokensIn += u.input ?? 0;
				out.tokensOut += u.output ?? 0;
			}
			const txt = textFromContent(ev.message.content);
			if (txt) {
				sawAssistant = true;
				out.result = txt;
			}
		}
	}
	if (!sawAssistant) return undefined; // murió antes de producir texto
	out.status = "completed";
	return out;
}
