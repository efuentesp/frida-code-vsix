// frida-pipeline — inyección de guidance (walk recursivo).
//
// Porte de `rpiv-core/guidance.ts` al namespace Frida (ADR-0021 Fase 2). En
// cada nivel de directorio desde la raíz del proyecto hasta el directorio del
// archivo tocado, escoge el primero que exista de:
//
//   AGENTS.md > CLAUDE.md > .frida/guidance/<sub>/architecture.md
//
// Profundidad 0 (raíz) omite AGENTS.md/CLAUDE.md porque el resource-loader de
// Pi ya carga <cwd>/AGENTS.md o <cwd>/CLAUDE.md en el bloque "# Project
// Context" del system prompt. La profundidad 0 SÍ revisa
// <cwd>/.frida/guidance/architecture.md — el loader de Pi no ve esa ruta.
//
// Inyección en dos puntos:
//   1. session_start  → injectRootGuidance (sólo architecture.md raíz)
//   2. tool_call      → handleToolCallGuidance (walk completo del archivo tocado)
//
// `resolveGuidance` es lógica pura sin ExtensionAPI (regla de módulo-
// utilidad). Los efectos secundarios (sendMessage, Set de dedup) viven en
// `handleToolCallGuidance` (sendMessage), `resolveAndFormatNewGuidance`
// (dueño del Set) e `injectRootGuidance`.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type {
	ExtensionAPI,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
	ARCHITECTURE_MD,
	FLAG_DEBUG,
	FRIDA_DIR,
	GUIDANCE_SUBDIR,
	MSG_TYPE_GUIDANCE,
} from "./constants";

// ---------------------------------------------------------------------------
// Constantes locales
// ---------------------------------------------------------------------------

const AGENTS_MD = "AGENTS.md";
const CLAUDE_MD = "CLAUDE.md";
/** Clave de dedup forward-slash para la guidance raíz — NO usar join() para
 *  compatibilidad cross-platform. */
const ROOT_GUIDANCE_KEY = `${FRIDA_DIR}/${GUIDANCE_SUBDIR}/${ARCHITECTURE_MD}`;
/** Tools que tocan archivos y disparan el walk de guidance. */
const FILE_TOUCH_TOOLS = ["read", "edit", "write"] as const;

// ---------------------------------------------------------------------------
// Resolución de guidance
// ---------------------------------------------------------------------------

type GuidanceKind = "agents" | "claude" | "architecture";

export interface GuidanceFile {
	/** Path normalizado con forward-slash desde la raíz — clave de dedup estable. */
	relativePath: string;
	absolutePath: string;
	content: string;
	kind: GuidanceKind;
}

/**
 * Resuelve los archivos de guidance para un path dado.
 *
 * Camina desde la raíz del proyecto hasta el directorio del archivo. En cada
 * profundidad, escoge el primero que exista de AGENTS.md > CLAUDE.md >
 * architecture.md (precedencia por-directorio del loader de Pi, extendida con
 * architecture.md como tercer candidato). La profundidad 0 sólo revisa
 * architecture.md — el loader de Pi ya maneja <cwd>/AGENTS.md y
 * <cwd>/CLAUDE.md.
 *
 * Devuelve los archivos raíz-primero (general → específico), a lo más uno por
 * profundidad.
 */
export function resolveGuidance(
	filePath: string,
	projectDir: string,
): GuidanceFile[] {
	const fileDir = dirname(filePath);
	const relativeDir = relative(projectDir, fileDir);

	// Guarda: el archivo está fuera de la raíz del proyecto.
	if (relativeDir.startsWith("..") || isAbsolute(relativeDir)) {
		return [];
	}

	const parts = relativeDir ? relativeDir.split(sep) : [];
	const results: GuidanceFile[] = [];

	for (let depth = 0; depth <= parts.length; depth++) {
		const subPath = parts.slice(0, depth).join(sep);

		// Escalera de candidatos por profundidad. Gana el primero que exista.
		const candidates: Array<{ relative: string; kind: GuidanceKind }> = [];

		// Profundidad 0: omitir AGENTS/CLAUDE — el loader de Pi ya los cargó.
		if (depth > 0) {
			candidates.push({ relative: join(subPath, AGENTS_MD), kind: "agents" });
			candidates.push({ relative: join(subPath, CLAUDE_MD), kind: "claude" });
		}
		candidates.push({
			relative: join(
				FRIDA_DIR,
				GUIDANCE_SUBDIR,
				...(subPath ? [subPath] : []),
				ARCHITECTURE_MD,
			),
			kind: "architecture",
		});

		for (const candidate of candidates) {
			const absolute = join(projectDir, candidate.relative);
			if (existsSync(absolute)) {
				results.push({
					relativePath: candidate.relative.split(sep).join("/"),
					absolutePath: absolute,
					content: readFileSync(absolute, "utf-8"),
					kind: candidate.kind,
				});
				break; // gana el primero en esta profundidad
			}
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Estado de sesión (dedup)
// ---------------------------------------------------------------------------

/** Set en memoria de paths de guidance ya inyectados, por sesión. */
const injectedGuidance = new Set<string>();

/** Reinicia el estado de dedup (session_start / session_compact / tests). */
export function clearInjectionState(): void {
	injectedGuidance.clear();
}

// ---------------------------------------------------------------------------
// Inyección de guidance raíz (session_start)
// ---------------------------------------------------------------------------

/**
 * Inyecta el `.frida/guidance/architecture.md` raíz al iniciar la sesión.
 *
 * Se llama desde `session_start` para que la guidance raíz esté disponible
 * antes del primer turno del agente — sin esperar un tool_call de
 * read/edit/write. Reusa el mismo Set `injectedGuidance` para dedup, así
 * `handleToolCallGuidance` no la reinyecta después.
 */
export function injectRootGuidance(cwd: string, pi: ExtensionAPI): void {
	const relativePath = ROOT_GUIDANCE_KEY;

	if (injectedGuidance.has(relativePath)) return;

	const absolutePath = join(cwd, relativePath);
	if (!existsSync(absolutePath)) return;

	let content: string;
	try {
		content = readFileSync(absolutePath, "utf-8");
	} catch {
		// Fallo silencioso — session_start corre antes de que cualquier UI esté
		// conectada, así que un error de permisos/race aquí no debe crashear el
		// hook. No marcar como inyectado para que un tool_call posterior pueda
		// reintentar.
		return;
	}
	injectedGuidance.add(relativePath);

	const file: GuidanceFile = {
		relativePath,
		absolutePath,
		content,
		kind: "architecture",
	};
	sendGuidanceMessage(
		pi,
		wrapGuidance(
			formatLabel(file),
			content,
			"cargado automáticamente al iniciar la sesión",
		),
	);
}

// ---------------------------------------------------------------------------
// Handler de tool_call
// ---------------------------------------------------------------------------

/**
 * Resuelve, dedupe, marca y formatea la guidance para un archivo tocado — la
 * mitad "build" de la inyección por tool_call (sin ExtensionAPI, sin
 * sendMessage). Es dueño del Set `injectedGuidance` (lectura+marca) para que
 * el filtro de dedup y el paso de marca queden en una sola función: marcar
 * antes de devolver el contenido deja idempotencia > confiabilidad.
 *
 * Devuelve los bloques formateados unidos con `"\n\n---\n\n"`, o `null` cuando
 * nada resuelve a lo largo de la escalera O todos los archivos resueltos ya
 * están inyectados (no marca nada en los casos null).
 */
export function resolveAndFormatNewGuidance(
	filePath: string,
	cwd: string,
	toolName: string,
): string | null {
	const resolved = resolveGuidance(filePath, cwd);
	const newFiles = resolved.filter(
		(g) => !injectedGuidance.has(g.relativePath),
	);
	if (newFiles.length === 0) return null;

	// Marcar antes de enviar — idempotencia > confiabilidad.
	for (const g of newFiles) {
		injectedGuidance.add(g.relativePath);
	}

	const trigger = `cargado automáticamente porque ${toolName} tocó ${shortenPath(filePath, cwd)}`;
	const contextParts = newFiles.map((g) =>
		wrapGuidance(formatLabel(g), g.content, trigger),
	);

	return contextParts.join("\n\n---\n\n");
}

/**
 * Maneja la inyección de guidance en eventos tool_call para read/edit/write —
 * una tubería delgada: filtrar → extraer → delegar → enviar. Resolve/dedup/
 * marca/formatear viven en `resolveAndFormatNewGuidance`; este handler no
 * añade referencias directas a `injectedGuidance`.
 */
export function handleToolCallGuidance(
	event: ToolCallEvent,
	ctx: { cwd: string },
	pi: ExtensionAPI,
): void {
	if (!(FILE_TOUCH_TOOLS as readonly string[]).includes(event.toolName)) return;

	// El SDK actual usa `.path`; `.file_path` es fallback para versiones
	// anteriores de Pi (rpiv-pi lo checaba así).
	const filePath =
		(event.input as { path?: string; file_path?: string }).path ??
		(event.input as { file_path?: string }).file_path;
	if (!filePath) return;

	const content = resolveAndFormatNewGuidance(
		filePath,
		ctx.cwd,
		event.toolName,
	);
	if (content !== null) sendGuidanceMessage(pi, content);
}

// ---------------------------------------------------------------------------
// Formato y envío
// ---------------------------------------------------------------------------

/**
 * Envuelve el contenido de guidance en un envelope que NO es una tarea. El
 * disclaimer inicial le dice al agente que este bloque es material de
 * referencia — no una instrucción — y declara el disparador para que el agente
 * pueda juzgar si el bloque es relevante a la petición actual del usuario.
 * Encabezado en español (convención AGENTS.md).
 */
function wrapGuidance(label: string, content: string, trigger: string): string {
	return [
		`[frida-guidance — material de referencia, NO una tarea. ${trigger}.`,
		`Consúltalo sólo si es relevante a la petición actual del usuario; ignóralo en caso contrario.]`,
		"",
		`## Guidance de arquitectura: ${label}`,
		"",
		content,
	].join("\n");
}

/**
 * Renderiza un path relativo al proyecto, normalizado con forward-slash, para
 * el disclaimer del disparador. Cae al path absoluto si el archivo vive fuera
 * de la raíz (defensivo — handleToolCallGuidance ya cortocircuita vía
 * resolveGuidance en ese caso, así que esta rama es inalcanzable hoy).
 */
function shortenPath(filePath: string, cwd: string): string {
	const r = relative(cwd, filePath);
	return r && !r.startsWith("..") ? r.split(sep).join("/") : filePath;
}

/**
 * Formatea el label de encabezado de un archivo de guidance.
 *   src/tools/frida-pipeline/AGENTS.md          → "src/tools/frida-pipeline (AGENTS.md)"
 *   scripts/CLAUDE.md                           → "scripts (CLAUDE.md)"
 *   .frida/guidance/scripts/architecture.md     → "scripts (architecture.md)"
 *   .frida/guidance/architecture.md             → "raíz (architecture.md)"
 */
function formatLabel(g: GuidanceFile): string {
	if (g.kind === "architecture") {
		const stripped = g.relativePath.replace(/^\.frida\/guidance\//, "");
		const sub =
			stripped === "architecture.md"
				? ""
				: stripped.replace(/\/architecture\.md$/, "");
		return `${sub || "raíz"} (architecture.md)`;
	}
	const fileName = g.kind === "agents" ? "AGENTS.md" : "CLAUDE.md";
	const idx = g.relativePath.lastIndexOf("/");
	const sub = idx > 0 ? g.relativePath.slice(0, idx) : "";
	return `${sub || "raíz"} (${fileName})`;
}

/** Envía un mensaje de guidance al transcript (display sólo si --frida-debug). */
function sendGuidanceMessage(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({
		customType: MSG_TYPE_GUIDANCE,
		content,
		display: !!pi.getFlag(FLAG_DEBUG),
	});
}
