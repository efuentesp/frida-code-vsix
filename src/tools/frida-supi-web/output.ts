// Preparación de salida visible para el modelo (porte de supi-web).
//
// Trunca el contenido a los límites por defecto del SDK (2000 líneas / 50 KB) y,
// si se trunca, vuelca el contenido COMPLETO a un archivo temporal y deja en el
// texto devuelto un aviso con la ruta. Así el modelo ve una cabecera útil y puede
// apuntar al archivo completo con la tool `read`.

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { writeTempFile } from "./temp-file";

/** Contrato legible de truncado, compartido por todas las salidas web. */
export const MODEL_OUTPUT_LIMIT_DESCRIPTION = `Inline truncates at ${DEFAULT_MAX_LINES.toLocaleString()} lines/${formatSize(
	DEFAULT_MAX_BYTES,
)}; full saved to temp.`;

/** Resultado de preparar contenido para una respuesta de tool visible al modelo. */
export interface ModelVisibleOutput {
	/** Texto seguro para devolver en el resultado del tool. */
	text: string;
	/** Metadatos de truncado cuando ocurrió. */
	truncation?: TruncationResult;
	/** Archivo temporal con la salida completa sin truncar, cuando se truncó. */
	fullOutputPath?: string;
}

/** Prepara contenido para salida visible al modelo; guarda el completo en temp si se trunca. */
export async function limitModelVisibleOutput(
	content: string,
	options: { tempPrefix: string; suffix: string },
): Promise<ModelVisibleOutput> {
	const truncation = truncateHead(content, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	if (!truncation.truncated) {
		return { text: content };
	}

	const fullOutputPath = await writeTempFile(
		content,
		options.tempPrefix,
		options.suffix,
	);
	const prefix =
		truncation.content.length > 0 ? `${truncation.content}\n\n` : "";
	const notice = [
		`[Output truncated: ${truncation.outputLines.toLocaleString()}/${truncation.totalLines.toLocaleString()} lines,`,
		`${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}.`,
		`Full: ${fullOutputPath}]`,
	].join(" ");

	return {
		text: `${prefix}${notice}`,
		truncation,
		fullOutputPath,
	};
}
