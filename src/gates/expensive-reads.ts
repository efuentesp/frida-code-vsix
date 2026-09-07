// frida-shunt (#202): gate de lecturas costosas — delegación de I/O.
//
// Porte adaptado del patrón shunt de Spotify Portal (docs/research/2026-09-06):
// el modelo frontera no debe quemar tokens leyendo archivos completos cuando
// hay rutas más baratas. Este módulo DECIDE (puro + fs acotado); la razón del
// block enseña la ESCALERA DE DELEGACIÓN:
//
//   1. Estructura del archivo → module_report / read_symbol de pi-lens
//      (determinístico: 0 tokens, 0 latencia — ventaja que Spotify no tiene).
//   2. Pregunta profunda / multi-archivo → subagent (rol smol): el corpus
//      vive en la ventana del hijo, jamás en la del padre.
//   3. Para EDITAR → read dirigido con offset/limit (SIEMPRE permitido;
//      límite documentado del patrón: no delegas edición — los resúmenes
//      pierden números de línea).
//
// Semáforo anti-frustración (lección del "what doesn't work" del post): si el
// reason no ofreciera la ruta de edición, el agente entraría en loop.
//
// Deliberadamente FUERA de frida-permission-system: aquello es política de
// seguridad (candado); esto es un ROUTER DE COSTO. Conviven en el bus
// tool_call — el candado se registra primero y su block siempre gana.
//
// Matching bash: `cat|head|tail|less|more` sin pipe sobre archivos grandes.
// Los pipes pasan (extracción dirigida, regla del upstream). head/tail con
// conteo explícito (-n K / -K, K ≤ umbral) pasan: son lecturas dirigidas.

import { openSync, readSync, closeSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Extensiones binarias: read las sirve como imágenes/adjuntos — fuera de scope. */
const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"ico",
	"pdf",
	"zip",
	"gz",
	"tgz",
	"vsix",
	"mp4",
	"mov",
	"sqlite",
	"db",
	"woff",
	"woff2",
	"ttf",
]);

export interface ShuntConfig {
	enabled: boolean;
	/** Umbral de líneas: lecturas completas por encima redirigen. Default 350. */
	minLines: number;
	/** CWD para resolver paths relativos del input. */
	cwd: string;
}

export interface ShuntRedirect {
	/** Mensaje que ve el modelo: motivo + escalera de delegación. */
	reason: string;
	/** Diagnóstico: qué se detectó. */
	detail: string;
}

/**
 * Cuenta líneas leyendo el archivo POR CHUNKS y cortando al pasar `max`:
 * un archivo de 100 MB no se lee completo para decidir si es grande.
 * Devuelve el conteo exacto hasta max+1 ("> max"), o null si no se puede leer.
 */
export function countLinesUpTo(path: string, max: number): number | null {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return null;
	}
	try {
		const buf = Buffer.allocUnsafe(64 * 1024);
		let lines = 0;
		for (;;) {
			const n = readSync(fd, buf, 0, buf.length, null);
			if (n <= 0) break;
			for (let i = 0; i < n; i++) {
				if (buf[i] === 0x0a) {
					lines++;
					if (lines > max) return lines; // corte temprano
				}
			}
		}
		return lines;
	} catch {
		return null;
	} finally {
		try {
			closeSync(fd);
		} catch {
			/* noop */
		}
	}
}

function isTextPath(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return !BINARY_EXTENSIONS.has(ext);
}

/** Resuelve el path del input contra el cwd (el read acepta relativos). */
function resolvePath(raw: string, cwd: string): string {
	return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/** La escalera completa, en el reason que ve el modelo. */
function ladderReason(what: string, lines: number, minLines: number): string {
	return (
		`Lectura costosa bloqueada por frida-shunt: ${what} tiene ~${lines} líneas ` +
		`(umbral ${minLines}). No lo leas completo — usa la escalera:\n` +
		"1. ESTRUCTURA del archivo → tools de pi-lens: module_report (outline " +
		"navegable) o read_symbol (un símbolo exacto). Costo 0 tokens.\n" +
		"2. PREGUNTA profunda o multi-archivo → subagent tipo Explore (corre en " +
		"el rol smol, barato): pásale la pregunta y los paths; el corpus vive en " +
		"SU contexto y sólo vuelve la respuesta destilada.\n" +
		"3. Para EDITAR la sección exacta → read con offset/limit (siempre " +
		"permitido; los resúmenes no traen números de línea confiables)."
	);
}

/**
 * Evalúa una llamada de tool contra la política de lecturas costosas.
 * Devuelve el redirect (block+reason) o null si pasa.
 */
export function evaluateExpensiveRead(
	tool: string,
	input: any,
	config: ShuntConfig,
): ShuntRedirect | null {
	if (!config.enabled) return null;
	const minLines =
		Number.isFinite(config.minLines) && config.minLines > 0
			? Math.floor(config.minLines)
			: 350;

	if (tool === "read") {
		const rawPath = input?.path;
		if (typeof rawPath !== "string" || !rawPath) return null;
		// Lectura dirigida (offset/limit): SIEMPRE permitida — es la ruta 3.
		if (input?.offset != null || input?.limit != null) return null;
		if (!isTextPath(rawPath)) return null;
		const path = resolvePath(rawPath, config.cwd);
		try {
			const st = statSync(path);
			if (!st.isFile()) return null;
		} catch {
			return null; // inexistente: que el read falle con su error natural
		}
		const lines = countLinesUpTo(path, minLines);
		if (lines === null || lines <= minLines) return null;
		return {
			reason: ladderReason(`\`${rawPath}\``, lines, minLines),
			detail: `read completo de ${rawPath} (${lines}+ líneas)`,
		};
	}

	if (tool === "bash") {
		const command = input?.command;
		if (typeof command !== "string" || !command) return null;
		return evaluateBashRead(command, minLines, config.cwd);
	}

	return null;
}

/** cat|head|tail|less|more sin pipe sobre archivos grandes (paridad upstream). */
export function evaluateBashRead(
	command: string,
	minLines: number,
	cwd: string,
): ShuntRedirect | null {
	// Pipes = extracción dirigida (cat big | grep x): pasan, regla del upstream.
	if (command.includes("|")) return null;

	// Primer comando de lectura en posición de comando (sin depths de subshell).
	const m = /(?:^|[;&])\s*(cat|head|tail|less|more)\b\s*([^;&|]*)/.exec(command);
	if (!m) return null;
	const cmd = m[1];
	const rest = m[2].trim();
	if (!rest) return null;

	// head/tail con conteo explícito = lectura dirigida si K ≤ umbral; si K
	// > umbral es un read completo disfrazado → se evalúa el archivo que sigue.
	// El prefijo de conteo se DESCUENTA del resto antes de extraer el path:
	// `head -n 99999 big.ts` — el 99999 NO es el archivo (bug cazado por el test).
	let target = rest;
	const headTail = /^(?:-[a-zA-Z]*n[a-zA-Z]*\s+(\d+)|-(\d+))\b/.exec(rest);
	if (headTail) {
		const k = Number(headTail[1] ?? headTail[2]);
		if (Number.isFinite(k) && k <= minLines) return null;
		target = rest.slice(headTail[0].length).trim();
	}

	// Primer argumento no-opción = archivo (cat -n file, head file, less file).
	const argMatch = /(?:-\S+\s+)*("?)([^\s"]+)\1/.exec(target);
	if (!argMatch) return null;
	const rawPath = argMatch[2];
	if (rawPath.startsWith("-")) return null;
	if (!isTextPath(rawPath)) return null;
	const path = resolvePath(rawPath, cwd);
	try {
		if (!statSync(path).isFile()) return null;
	} catch {
		return null;
	}
	const lines = countLinesUpTo(path, minLines);
	if (lines === null || lines <= minLines) return null;
	return {
		reason: ladderReason(`\`${rawPath}\` (vía ${cmd})`, lines, minLines),
		detail: `${cmd} sobre ${rawPath} (${lines}+ líneas)`,
	};
}
