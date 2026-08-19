import {
	appendFileSync,
	copyFileSync,
	mkdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Forense compartido de Frida (#85 stop / #86 provider-audit).
 *
 * Appenders best-effort: un fallo de disco NUNCA debe tumbar la extensión ni
 * la corrida que se intenta diagnosticar. Todo método traga errores.
 */

export interface ForensicAppender {
	append(line: string): void;
}

export interface ForensicOptions {
	/** Archivo destino absoluto. */
	file: string;
	/** Rotación: al superar, el archivo pasa a <file>.1 y se reinicia. */
	maxBytes?: number;
}

/** Appender con rotación simple (mismo patrón que abort.log de extension.ts). */
export function createForensicAppender(
	opts: ForensicOptions,
): ForensicAppender {
	const maxBytes = opts.maxBytes ?? 1024 * 1024;
	let bytes = -1;
	return {
		append(line: string): void {
			try {
				mkdirSync(dirname(opts.file), { recursive: true });
				if (bytes < 0) {
					try {
						bytes = statSync(opts.file).size;
					} catch {
						bytes = 0;
					}
				}
				if (bytes >= maxBytes) {
					try {
						copyFileSync(opts.file, `${opts.file}.1`);
					} catch {
						/* noop */
					}
					try {
						writeFileSync(opts.file, "");
					} catch {
						/* noop */
					}
					bytes = 0;
				}
				appendFileSync(opts.file, `${line}\n`);
				bytes += Buffer.byteLength(line) + 1;
			} catch {
				/* noop — forense best-effort */
			}
		},
	};
}

/** Ruta estándar de un log forense: ~/.frida/logs/<name>. */
export function forensicLogPath(name: string): string {
	return join(homedir(), ".frida", "logs", name);
}

/** Línea con timestamp ISO + tag de camino ([chat]/[wf]/[detached]/[provider]). */
export function forensicLine(tag: string, msg: string): string {
	return `[${new Date().toISOString()}] [${tag}] ${msg}`;
}

/** Ventana de vigilancia post-abort (#85 chat): un evento de agente dentro de
 * 30s tras abortRun END es un "revive" — el responsable queda identificado. */
export const REVIVE_WINDOW_MS = 30_000;

/** Devuelve la línea REVIVE si el evento cae dentro de la ventana; null si no. */
export function reviveCheck(
	abortEndAtMs: number,
	eventAtMs: number,
	eventType: string,
): string | null {
	if (!abortEndAtMs) return null;
	const elapsed = eventAtMs - abortEndAtMs;
	if (elapsed < 0 || elapsed > REVIVE_WINDOW_MS) return null;
	return `REVIVE event=${eventType} tras ${elapsed}ms del abortRun END`;
}

/** Referencia legible provider/modelId para líneas de audit (#86). */
export function formatModelRef(
	provider: string | undefined,
	modelId: string | undefined,
): string {
	return provider && modelId ? `${provider}/${modelId}` : "(unset)";
}
