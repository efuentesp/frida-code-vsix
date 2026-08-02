// frida-pix-skills — Ejecución de directivas `` !`cmd` `` (porte de pix-skills).
//
// Porte literal de @xynogen/pix-skills/src/run.ts. Spawn de argv directo (SIN
// shell), bounded y non-throwing. Las directivas de skills cargan salida de
// comandos en vivo (git status, etc.); este módulo los corre de forma segura y
// acotada para que la carga de una skill siempre complete.
//
// Política de seguridad (sin diálogo, igual que pix-skills):
//   - shell-free: spawn directo (nunca `bash -c`); los metacaracteres se
//     rechazan ANTES en directive.ts (hasShellMeta).
//   - bounded: 10s por comando, 16KB de salida combinada.
//   - non-throwing: timeouts, exit != 0 y errores de spawn resuelven a texto
//     descriptivo (nunca lanzan) → skill loading siempre completa.

import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 16_384;

export interface RunOptions {
	cwd: string;
	timeoutMs?: number;
	maxBytes?: number;
}

/**
 * Spawn argv directamente (NO shell). Devuelve stdout+stderr combinado, acotado
 * a maxBytes. Nunca lanzar: timeouts, exits != 0 y errores de spawn resuelven a
 * texto descriptivo para que la carga de la skill siempre complete.
 *
 * Usa child_process de Node (corre bajo el host runtime de Pi/Frida).
 */
export function runArgv(argv: string[], opts: RunOptions): Promise<string> {
	if (!argv.length) return Promise.resolve("(empty command)");
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

	return new Promise((resolve) => {
		let settled = false;
		const finish = (text: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(text);
		};

		let child: ReturnType<typeof spawn>;
		try {
			const cmd = argv[0] ?? "";
			child = spawn(cmd, argv.slice(1), {
				cwd: opts.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			finish(
				`[command failed: ${err instanceof Error ? err.message : String(err)}]`,
			);
			return;
		}

		const chunks: Buffer[] = [];
		let bytes = 0;
		const collect = (buf: Buffer) => {
			if (bytes >= maxBytes) return;
			bytes += buf.length;
			chunks.push(buf);
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);

		const timer = setTimeout(() => {
			child.kill();
			finish(format(chunks, bytes, maxBytes, "[output truncated: timed out]"));
		}, timeoutMs);

		child.on("error", (err) => finish(`[command failed: ${err.message}]`));
		child.on("close", () => finish(format(chunks, bytes, maxBytes)));
	});
}

function format(
	chunks: Buffer[],
	bytes: number,
	maxBytes: number,
	truncMarker = "[output truncated]",
): string {
	const combined = Buffer.concat(chunks).toString("utf-8").trimEnd();
	if (bytes > maxBytes)
		return `${combined.slice(0, maxBytes)}\n… ${truncMarker}`;
	return combined || "(no output)";
}
