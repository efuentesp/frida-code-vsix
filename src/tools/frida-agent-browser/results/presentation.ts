/**
 * frida-agent-browser — presentación del resultado (Fase 1).
 *
 * Orquesta categories + snapshot + next-actions para convertir el sobre JSON del
 * binario en un resultado agent-friendly: texto compacto (snapshot con @refs,
 * resumen de open, mensaje de error) + details estructurados (resultCategory,
 * successCategory|failureCategory, refs, origin, nextActions) + isError.
 *
 * Reemplaza al volcado JSON crudo del porte Esencial.
 */

import type { BrowserToolResult } from "../run";
import {
	buildArtifactVerificationSummary,
	extractRequestedPaths,
	getArtifactKind,
	getSavedPath,
	verifyArtifactFiles,
} from "./artifacts";
import { buildCategoryDetails, type FailureCategory } from "./categories";
import {
	type AgentBrowserData,
	type AgentBrowserEnvelope,
	getOrigin,
	getRefs,
} from "./envelope";
import { buildNextActions } from "./next-actions";
import { renderSnapshot } from "./snapshot";

/** Flags globales que consumen un valor (para saltarlos al detectar el comando). */
const VALUE_FLAGS = new Set(["--session", "--namespace", "--session-name"]);
const INSPECTION_COMMANDS = new Set([
	"--help",
	"-h",
	"--version",
	"-v",
	"-V",
	"skills",
	"auth",
	"profiles",
	"doctor",
	"device",
	"session",
]);

/** Primer token posicional de argv (salta --session <val> y flags sueltos). */
export function commandOf(args: string[]): string | undefined {
	let i = 0;
	while (i < args.length) {
		const a = args[i];
		if (a === "--json") {
			i++;
			continue;
		}
		if (VALUE_FLAGS.has(a)) {
			i += 2;
			continue;
		}
		if (a.startsWith("-")) {
			i++;
			continue;
		}
		return a;
	}
	return undefined;
}

function extractReadableText(
	data: AgentBrowserData | null | undefined,
): string | undefined {
	if (!data) return undefined;
	for (const key of [
		"text",
		"summary",
		"output",
		"result",
		"message",
		"value",
		"title",
		"url",
	]) {
		const v = data[key];
		if (typeof v === "string" && v.length > 0) return v;
	}
	return undefined;
}

export interface PresentOptions {
	envelope: AgentBrowserEnvelope;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	mode: string;
	args: string[];
	sessionName?: string;
	cwd: string;
}

/** Construye el BrowserToolResult a partir de un sobre JSON ya parseado. */
export function presentAgentBrowserResult(
	opts: PresentOptions,
): BrowserToolResult {
	const { envelope, mode, args, sessionName } = opts;
	const command = commandOf(args);
	const data = envelope.data ?? undefined;
	const succeeded = envelope.success === true;

	// Fase 4: verificación de artefactos (sólo en éxito + comando productor de archivos).
	const artifactKind = succeeded ? getArtifactKind(command, args) : undefined;
	const artifactEntries = artifactKind
		? verifyArtifactFiles({
				cwd: opts.cwd,
				savedPath: getSavedPath(data),
				requestedPaths: extractRequestedPaths(args),
				kind: artifactKind,
			})
		: [];
	const artifactVerification =
		buildArtifactVerificationSummary(artifactEntries);

	const category = buildCategoryDetails(succeeded, {
		command,
		args,
		errorText: envelope.error ?? undefined,
		stderr: opts.stderr,
		inspection: command ? INSPECTION_COMMANDS.has(command) : undefined,
		artifacts: artifactEntries.length > 0 ? artifactEntries : undefined,
	});

	const nextActions = buildNextActions({
		command,
		succeeded,
		failureCategory: category.failureCategory,
	});

	const baseDetails: Record<string, unknown> = {
		mode,
		command,
		session: sessionName,
		origin: getOrigin(data),
		resultCategory: category.resultCategory,
		...(category.successCategory
			? { successCategory: category.successCategory }
			: {}),
		...(category.failureCategory
			? { failureCategory: category.failureCategory }
			: {}),
		nextActions: nextActions.length > 0 ? nextActions : undefined,
		result: envelope,
		exitCode: opts.exitCode,
		...(artifactVerification ? { artifactVerification } : {}),
	};

	if (succeeded) {
		// Texto agent-friendly según el comando.
		let text: string;
		if (command === "snapshot") {
			text = renderSnapshot(data);
			baseDetails.refs = getRefs(data);
		} else if (
			command &&
			(command === "open" || command === "goto" || command === "navigate")
		) {
			const origin = getOrigin(data) ?? "";
			const title = typeof data?.title === "string" ? data.title : "";
			text = title ? `Opened ${origin} — ${title}` : `Opened ${origin}`;
		} else if (
			artifactVerification &&
			artifactVerification.artifacts.length > 0
		) {
			const a = artifactVerification.artifacts[0];
			text = `Saved ${a.kind}: ${a.absolutePath} (${a.state}, ${a.sizeBytes ?? "?"} bytes)`;
			if (!artifactVerification.verified) {
				text += ` — WARNING: ${artifactVerification.missingCount} missing; treat path as unverified until recovered.`;
			}
		} else if (category.successCategory === "inspection") {
			text = opts.stdout.trim() || JSON.stringify(envelope, null, 2);
		} else {
			text = extractReadableText(data) ?? JSON.stringify(envelope, null, 2);
		}
		return {
			content: [{ type: "text", text }],
			details: baseDetails,
			isError: false,
		};
	}

	// Fallo: mensaje del binario (o stderr) + categoría.
	const text =
		envelope.error?.trim() ||
		opts.stderr.trim() ||
		`agent-browser command "${command ?? mode}" failed (exit ${opts.exitCode ?? "?"}).`;
	return {
		content: [{ type: "text", text }],
		details: { ...baseDetails, error: envelope.error ?? undefined },
		isError: true,
	};
}

/** Resultado para stdout no-JSON (parse fallido). */
export function parseFailureResult(opts: {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	mode: string;
	args: string[];
	sessionName?: string;
}): BrowserToolResult {
	const failed = opts.exitCode !== null && opts.exitCode !== 0;
	const command = commandOf(opts.args);
	const fc: FailureCategory = "parse-failure";
	return {
		content: [
			{
				type: "text",
				text: opts.stdout.trim() || opts.stderr.trim() || "(no output)",
			},
		],
		details: {
			mode: opts.mode,
			command,
			session: opts.sessionName,
			resultCategory: failed ? "failure" : "success",
			failureCategory: failed ? fc : undefined,
			parseError: true,
			exitCode: opts.exitCode,
		},
		isError: failed,
	};
}
