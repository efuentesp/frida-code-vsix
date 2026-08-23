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
import { findCommandStartIndex } from "../argv-grammar";

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

/**
 * Primer token de comando de argv. Mirror 0.34.0: usa findCommandStartIndex
 * (salta flags globales con payload y booleanos con true/false), así
 * `--profile Default open x` → `open` y `wait --state visible` → `wait`.
 */
export function commandOf(args: string[]): string | undefined {
	const start = findCommandStartIndex(args);
	return start === undefined ? undefined : args[start];
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

/**
 * Resumen de tabs para cualquier sobre con `data.tabs` (contrato 0.34.0:
 * el listado incluye el CDP targetId de cada tab cuando el binario lo
 * reporta, y esos ids sirven como refs de tab). Mirror de getTabSummary
 * del referencia; simplificación: sin redacción model-facing (el port pasa
 * el texto tal cual en el resto de comandos).
 */
export function getTabSummary(
	data: AgentBrowserData | null | undefined,
): string | undefined {
	const tabs = Array.isArray(data?.tabs) ? (data?.tabs as unknown[]) : undefined;
	if (!tabs) return undefined;
	const lines = tabs.map((raw, index) => {
		const tab =
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const marker = tab.active === true ? "*" : "-";
		const title =
			typeof tab.title === "string" && tab.title.length > 0
				? tab.title
				: "(untitled)";
		const url =
			typeof tab.url === "string" && tab.url.length > 0 ? tab.url : "(no url)";
		const label =
			typeof tab.label === "string" && tab.label.trim().length > 0
				? tab.label.trim()
				: undefined;
		const tabSelector =
			typeof tab.tabId === "string" && tab.tabId.trim().length > 0
				? tab.tabId.trim()
				: (label ??
					(typeof tab.index === "number" ? String(tab.index) : String(index)));
		const labelText = label && label !== tabSelector ? ` label=${label}` : "";
		const targetId =
			typeof tab.targetId === "string" && tab.targetId.trim().length > 0
				? tab.targetId.trim()
				: undefined;
		const targetText =
			targetId && targetId !== tabSelector ? ` target=${targetId}` : "";
		return `${marker} [${tabSelector}]${labelText}${targetText} ${title} — ${url}`;
	});
	return lines.join("\n");
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
	const artifactVerification = buildArtifactVerificationSummary(artifactEntries);

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
		} else if (getTabSummary(data)) {
			// Contrato 0.34.0: listados de tab con selector + label + CDP targetId
			// (los tres sirven como refs de tab en comandos posteriores).
			text = getTabSummary(data)!;
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
