// Helpers de archivos temporales para las tools web (porte de supi-web).
//
// Escribe contenido en un archivo temporal único y devuelve la ruta absoluta.
// Usa la cola de mutación de archivos del SDK para no chocar con otros writes.

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

/** Escribe contenido en un archivo temporal único y devuelve la ruta absoluta. */
export async function writeTempFile(
	content: string,
	prefix: string,
	suffix: string,
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
	const hash = randomBytes(4).toString("hex");
	const filePath = join(dir, `${hash}${suffix}`);
	await withFileMutationQueue(filePath, () =>
		writeFile(filePath, content, "utf8"),
	);
	return filePath;
}
