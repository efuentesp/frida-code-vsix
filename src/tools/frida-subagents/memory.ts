// frida-subagents — memoria persistente de agentes.
//
// Porte de pi-subagents/src/memory.ts (ADR-0022 Fase 5 / D4).
// Los agentes con `memory: project|local|user` obtienen un directorio
// persistente con un MEMORY.md index. Los agentes read-only reciben
// memoria de sólo lectura.

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MemoryScope } from "./types";

/**
 * Resuelve el directorio de memoria para un scope dado.
 *
 * @param scope project | local | user
 * @param agentName Nombre del agente (sin .md)
 * @param cwd Directorio de trabajo del proyecto
 */
export function resolveMemoryDir(
	scope: MemoryScope,
	agentName: string,
	cwd: string,
): string {
	switch (scope) {
		case "project":
			return join(cwd, ".frida", "agent-memory", agentName);
		case "local":
			return join(cwd, ".frida", "agent-memory-local", agentName);
		case "user":
			return join(homedir(), ".frida", "agent-memory", agentName);
		default:
			return join(cwd, ".frida", "agent-memory", agentName);
	}
}

/**
 * Asegura que el directorio de memoria existe y tiene un MEMORY.md.
 * Crea ambos si no existen.
 */
export function ensureMemoryDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const indexPath = join(dir, "MEMORY.md");
	if (!existsSync(indexPath)) {
		writeFileSync(
			indexPath,
			`# Memoria de ${dir.split("/").pop()}\n\n## Notas\n\n`,
			"utf-8",
		);
	}
}

/**
 * Construye el bloque de memoria para inyectar en el system prompt.
 *
 * Lee MEMORY.md + todos los archivos .md del directorio de memoria.
 * Si el directorio no existe o está vacío, devuelve string vacío.
 */
export function buildMemoryBlock(dir: string): string {
	if (!existsSync(dir)) return "";

	const lines: string[] = ["## Agent Memory", ""];

	// MEMORY.md index.
	const indexPath = join(dir, "MEMORY.md");
	if (existsSync(indexPath)) {
		try {
			const content = readFileSync(indexPath, "utf-8").trim();
			if (content) {
				lines.push(content);
				lines.push("");
			}
		} catch {
			// Ignorar errores de lectura.
		}
	}

	// Archivos de memoria individuales (excluyendo MEMORY.md).
	try {
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
			.sort();
		for (const file of files) {
			try {
				const content = readFileSync(join(dir, file), "utf-8").trim();
				if (content) {
					lines.push(`### ${file.replace(/\.md$/, "")}`);
					lines.push(content);
					lines.push("");
				}
			} catch {
				// Ignorar.
			}
		}
	} catch {
		// Ignorar.
	}

	const block = lines.join("\n");
	return block || "";
}

/**
 * Versión read-only del bloque de memoria (sin instrucciones de escritura).
 * Para agentes sin tools de write/edit.
 */
export function buildReadOnlyMemoryBlock(dir: string): string {
	const block = buildMemoryBlock(dir);
	if (!block) return "";
	return `[Agent Memory (read-only)]\n${block}\n[End Memory — do not modify]`;
}

/**
 * Construye el bloque de memoria apropiado según si el agente tiene
 * tools de escritura o no.
 */
export function buildMemoryForAgent(
	dir: string,
	hasWriteTools: boolean,
): string {
	return hasWriteTools ? buildMemoryBlock(dir) : buildReadOnlyMemoryBlock(dir);
}

/**
 * ¿El agente tiene tools de escritura (write o edit)?
 */
export function hasWriteTools(builtinToolNames: string[] | undefined): boolean {
	if (!builtinToolNames) return true; // sin restricción = todos los tools
	return (
		builtinToolNames.includes("write") || builtinToolNames.includes("edit")
	);
}
