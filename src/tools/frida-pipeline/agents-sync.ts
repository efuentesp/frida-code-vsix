// frida-pipeline — sincronización de agentes empaquetados al agentDir global.
//
// Porte simplificado de `rpiv-core/agents.ts` (ADR-0021 Fase 5). Copia los 15
// perfiles .md de `BUNDLED_AGENTS_DIR` a `~/.frida/global/agents/` con tracking
// sha256 en `.frida-managed.json` para detectar drift.
//
// Simplificaciones vs rpiv-pi:
//   - Sin per-cwd cleanup (Frida nunca tuvo agentes per-cwd).
//   - Sin model frontmatter injection (Fase posterior; el gate de Fase 5 es
//     sync + drift, no model override en agentes).
//   - Sin parseFrontmatterBounds (no se muta el frontmatter).
//
// Detección de drift:
//   - apply=false (session_start): nuevos → siempre copia; existentes
//     modificados por el usuario → pendingUpdate (gated, respeta ediciones).
//   - apply=true (/frida-update-agents): fuerza overwrite de todo.
//
// Nunca lanza — los errores se coleccionan en `result.errors`.

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { BUNDLED_AGENTS_DIR, getGlobalAgentsDir } from "./paths";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface SyncError {
	file?: string;
	op: string;
	message: string;
}

export interface SyncResult {
	/** Archivos nuevos copiados (en source, ausentes en destino). */
	added: string[];
	/** Archivos existentes sobreescritos con contenido actualizado. */
	updated: string[];
	/** Archivos cuyo destino coincide exactamente con el source. */
	unchanged: string[];
	/** Archivos gestionados stale eliminados (en manifest, ausentes en source). */
	removed: string[];
	/** Archivos cuyo destino difiere del source (detectado, no aplicado). */
	pendingUpdate: string[];
	/** Archivos gestionados que ya no están en source (detectado, no eliminados). */
	pendingRemove: string[];
	/** Errores por archivo recolectados durante el sync. */
	errors: SyncError[];
}

function emptySyncResult(): SyncResult {
	return {
		added: [],
		updated: [],
		unchanged: [],
		removed: [],
		pendingUpdate: [],
		pendingRemove: [],
		errors: [],
	};
}

// ---------------------------------------------------------------------------
// Allowlist de path-traversal (endurece el boundary del manifest)
// ---------------------------------------------------------------------------

/** Allowlist para nombres de agente gestionado: basename, sin .., termina .md. */
function isManagedAgentName(name: string): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	if (name.includes("\0")) return false;
	if (name.includes("/") || name.includes("\\")) return false;
	if (name === "." || name === "..") return false;
	if (name.includes("..")) return false;
	if (isAbsolute(name)) return false;
	if (!name.endsWith(".md")) return false;
	return true;
}

/** Resolve un path dentro de targetDir, rechazando si escapa. */
function safeJoin(targetDir: string, name: string): string | null {
	const resolved = resolve(targetDir, name);
	const root = resolve(targetDir) + sep;
	if (!resolved.startsWith(root)) return null;
	return resolved;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const MANIFEST_FILE = ".frida-managed.json";

/** filename → sha256 hex del contenido que instalamos. "" = desconocido. */
type Manifest = Record<string, string>;

function sha256(buf: Buffer | string): string {
	return createHash("sha256").update(buf).digest("hex");
}

/** Lee el manifest desde el directorio destino. Fail-soft: {} ante cualquier fallo. */
function readManifest(targetDir: string): Manifest {
	const manifestPath = join(targetDir, MANIFEST_FILE);
	if (!existsSync(manifestPath)) return {};
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: Manifest = {};
			for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof v === "string" && isManagedAgentName(k)) out[k] = v;
			}
			return out;
		}
		return {};
	} catch {
		return {};
	}
}

/** Escribe el manifest atómicamente (tmp + rename). Empuja error en fallo. */
function writeManifest(
	targetDir: string,
	manifest: Manifest,
	result: SyncResult,
): void {
	const manifestPath = join(targetDir, MANIFEST_FILE);
	try {
		const ordered: Manifest = {};
		for (const k of Object.keys(manifest).sort()) ordered[k] = manifest[k];
		const content = `${JSON.stringify(ordered, null, 2)}\n`;
		const tmpFile = join(targetDir, `${MANIFEST_FILE}.${process.pid}.tmp`);
		try {
			writeFileSync(tmpFile, content, "utf-8");
			renameSync(tmpFile, manifestPath);
		} catch (inner) {
			try {
				unlinkSync(tmpFile);
			} catch {
				/* ignore */
			}
			throw inner;
		}
	} catch (e) {
		result.errors.push({
			op: "manifest-write",
			message: e instanceof Error ? e.message : String(e),
		});
	}
}

// ---------------------------------------------------------------------------
// Predicado de seguridad para ops destructivas
// ---------------------------------------------------------------------------

/**
 * ¿Seguro aplicar auto-update/remove? Sólo cuando el hash registrado coincide
 * con el destino (instalamos esos bytes y el usuario no los editó). Sin hash
 * registrado → gated.
 */
function isSafeDestructiveOp(knownHash: string, destHash: string): boolean {
	return knownHash !== "" && destHash === knownHash;
}

// ---------------------------------------------------------------------------
// Engine de sync — orquestador
// ---------------------------------------------------------------------------

/**
 * Sincroniza los agentes empaquetados desde `BUNDLED_AGENTS_DIR` hacia el
 * agentDir global de Frida (`~/.frida/global/agents/`).
 *
 * Política de resolución (apply=false, session_start):
 *   - Nuevos → siempre copiados.
 *   - Dest === src → unchanged, hash registrado.
 *   - Dest ≠ src:
 *     - dest === hash registrado → auto-update (smart gate).
 *     - sino → pendingUpdate (gated; respeta ediciones del usuario).
 *   - Stale gestionados: misma decisión para removal.
 *
 * apply=true (/frida-update-agents): fuerza adds/updates/removes sin importar
 * el hash registrado (override manual; archivos editados por el usuario se
 * sobreescriben).
 *
 * Nunca lanza — los errores se coleccionan en `result.errors`.
 */
export function syncBundledAgents(
	apply: boolean,
	agentDir: string,
): SyncResult {
	const result = emptySyncResult();

	if (!existsSync(BUNDLED_AGENTS_DIR)) {
		return result;
	}

	const targetDir = getGlobalAgentsDir(agentDir);
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch (e) {
		result.errors.push({
			op: "mkdir",
			message: e instanceof Error ? e.message : String(e),
		});
		return result;
	}

	// 1. Enumerar archivos fuente.
	let sourceEntries: string[];
	try {
		sourceEntries = readdirSync(BUNDLED_AGENTS_DIR).filter((f) =>
			f.endsWith(".md"),
		);
	} catch {
		result.errors.push({
			op: "read-src",
			message: "No se pudo leer el directorio de agentes empaquetados",
		});
		return result;
	}

	const sourceNames = new Set(sourceEntries);
	const manifest = readManifest(targetDir);
	const newManifest: Manifest = {};

	// 2. Procesar cada archivo fuente.
	for (const entry of sourceEntries) {
		const src = join(BUNDLED_AGENTS_DIR, entry);
		const dest = safeJoin(targetDir, entry);
		const knownHash = manifest[entry] ?? "";
		if (dest === null) {
			result.errors.push({
				file: entry,
				op: "copy",
				message: "path inseguro rechazado",
			});
			newManifest[entry] = knownHash;
			continue;
		}

		let srcContent: string;
		try {
			srcContent = readFileSync(src, "utf-8");
		} catch (e) {
			result.errors.push({
				file: entry,
				op: "read-src",
				message: e instanceof Error ? e.message : String(e),
			});
			newManifest[entry] = knownHash;
			continue;
		}
		const srcHash = sha256(srcContent);

		if (!existsSync(dest)) {
			// Nuevo: siempre copiar.
			try {
				writeFileSync(dest, srcContent, "utf-8");
				result.added.push(entry);
				newManifest[entry] = srcHash;
			} catch (e) {
				result.errors.push({
					file: entry,
					op: "copy",
					message: e instanceof Error ? e.message : String(e),
				});
				newManifest[entry] = knownHash;
			}
			continue;
		}

		let destContent: string;
		try {
			destContent = readFileSync(dest, "utf-8");
		} catch (e) {
			result.errors.push({
				file: entry,
				op: "read-dest",
				message: e instanceof Error ? e.message : String(e),
			});
			newManifest[entry] = knownHash;
			continue;
		}
		const destHash = sha256(destContent);

		if (srcHash === destHash) {
			result.unchanged.push(entry);
			newManifest[entry] = srcHash;
			continue;
		}

		// Drift detectado.
		if (apply || isSafeDestructiveOp(knownHash, destHash)) {
			try {
				writeFileSync(dest, srcContent, "utf-8");
				result.updated.push(entry);
				newManifest[entry] = srcHash;
			} catch (e) {
				result.errors.push({
					file: entry,
					op: "copy",
					message: e instanceof Error ? e.message : String(e),
				});
				newManifest[entry] = knownHash;
			}
		} else {
			// El usuario editó el archivo → gated (respeta su edición).
			result.pendingUpdate.push(entry);
			newManifest[entry] = knownHash;
		}
	}

	// 3. Stale-removal: clasificar → escribir manifest → commitear unlinks.
	const toUnlink: { name: string; destPath: string }[] = [];
	for (const name of Object.keys(manifest)) {
		if (sourceNames.has(name)) continue;

		const knownHash = manifest[name];
		const destPath = safeJoin(targetDir, name);
		if (destPath === null) {
			result.errors.push({
				file: name,
				op: "remove",
				message: "path inseguro rechazado",
			});
			continue;
		}
		if (!existsSync(destPath)) {
			result.removed.push(name);
			continue;
		}

		let destContent: string;
		try {
			destContent = readFileSync(destPath, "utf-8");
		} catch (e) {
			result.errors.push({
				file: name,
				op: "read-dest",
				message: e instanceof Error ? e.message : String(e),
			});
			newManifest[name] = knownHash;
			continue;
		}
		const destHash = sha256(destContent);

		if (apply || isSafeDestructiveOp(knownHash, destHash)) {
			toUnlink.push({ name, destPath });
		} else {
			result.pendingRemove.push(name);
			newManifest[name] = knownHash;
		}
	}

	// Persistir manifest antes de unlinks destructivos.
	writeManifest(targetDir, newManifest, result);

	// Commitear unlinks.
	for (const { name, destPath } of toUnlink) {
		try {
			unlinkSync(destPath);
			result.removed.push(name);
		} catch (e) {
			result.errors.push({
				file: name,
				op: "remove",
				message: e instanceof Error ? e.message : String(e),
			});
			newManifest[name] = manifest[name];
		}
	}
	if (result.errors.some((e) => e.op === "remove")) {
		writeManifest(targetDir, newManifest, result);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Formato de reporte (para notificaciones y /frida-update-agents)
// ---------------------------------------------------------------------------

/** Total de cambios aplicados (added + updated + removed). */
export function totalSynced(result: SyncResult): number {
	return result.added.length + result.updated.length + result.removed.length;
}

/** Formatea el resultado del sync a texto chat-friendly. */
export function formatSyncReport(result: SyncResult): string {
	const total = totalSynced(result);
	if (total === 0 && result.errors.length === 0) {
		// Reportar drift pendiente si lo hay.
		if (result.pendingUpdate.length > 0 || result.pendingRemove.length > 0) {
			const parts: string[] = [];
			if (result.pendingUpdate.length > 0)
				parts.push(`${result.pendingUpdate.length} desactualizado(s)`);
			if (result.pendingRemove.length > 0)
				parts.push(`${result.pendingRemove.length} obsoleto(s)`);
			return `Agentes sincronizados. Pendientes: ${parts.join(", ")}. Corre /frida-update-agents para aplicar.`;
		}
		return "Todos los agentes están actualizados.";
	}

	const parts: string[] = [];
	if (result.added.length > 0) parts.push(`${result.added.length} añadido(s)`);
	if (result.updated.length > 0)
		parts.push(`${result.updated.length} actualizado(s)`);
	if (result.removed.length > 0)
		parts.push(`${result.removed.length} eliminado(s)`);
	if (result.pendingUpdate.length > 0)
		parts.push(`${result.pendingUpdate.length} pendiente(s)`);
	if (result.pendingRemove.length > 0)
		parts.push(`${result.pendingRemove.length} obsoleto(s)`);

	const summary = `Agentes sincronizados: ${parts.join(", ")}.`;
	if (result.errors.length > 0) {
		return `${summary} ${result.errors.length} error(es): ${result.errors.map((e) => e.message).join("; ")}`;
	}
	return summary;
}
