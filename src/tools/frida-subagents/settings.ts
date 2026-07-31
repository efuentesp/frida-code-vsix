// frida-subagents — settings persistentes.
//
// Porte simplificado de pi-subagents/src/settings.ts (ADR-0022 Fase 4).
// Carga/persiste settings desde ~/.frida/subagents.json (global) y
// <cwd>/.frida/subagents.json (project). Project override global.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { JoinMode } from "./group-join";

export interface SubagentsSettings {
	/** Máximo de agentes background simultáneos. Default 4. */
	maxConcurrent: number;
	/** Turnos máximos por defecto. 0 = ilimitado. */
	defaultMaxTurns: number;
	/** Turnos de gracia tras max_turns antes de abortar. Default 5. */
	graceTurns: number;
	/** Modo de join para notificaciones. Default "smart". */
	joinMode: JoinMode;
}

const DEFAULTS: SubagentsSettings = {
	maxConcurrent: 4,
	defaultMaxTurns: 0,
	graceTurns: 5,
	joinMode: "smart",
};

const GLOBAL_FILE = (): string => join(homedir(), ".frida", "subagents.json");

function projectFile(cwd: string): string {
	return join(cwd, ".frida", "subagents.json");
}

/** Carga settings mergeando global + project (project override). */
export function loadSettings(cwd: string): SubagentsSettings {
	return { ...DEFAULTS, ...loadGlobal(), ...loadProject(cwd) };
}

/** Carga settings globales (~/.frida/subagents.json). */
function loadGlobal(): Partial<SubagentsSettings> {
	return loadJson(GLOBAL_FILE());
}

/** Carga settings de proyecto (<cwd>/.frida/subagents.json). */
function loadProject(cwd: string): Partial<SubagentsSettings> {
	return loadJson(projectFile(cwd));
}

/** Parsea un JSON de settings de forma segura. */
function loadJson(path: string): Partial<SubagentsSettings> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return {};
		const out: Partial<SubagentsSettings> = {};
		const r = raw as Record<string, unknown>;
		if (typeof r.maxConcurrent === "number" && r.maxConcurrent >= 1)
			out.maxConcurrent = Math.floor(r.maxConcurrent);
		if (typeof r.defaultMaxTurns === "number" && r.defaultMaxTurns >= 0)
			out.defaultMaxTurns = Math.floor(r.defaultMaxTurns);
		if (typeof r.graceTurns === "number" && r.graceTurns >= 0)
			out.graceTurns = Math.floor(r.graceTurns);
		if (
			typeof r.joinMode === "string" &&
			["smart", "async", "group"].includes(r.joinMode)
		)
			out.joinMode = r.joinMode as JoinMode;
		return out;
	} catch {
		return {};
	}
}

/** Persiste settings de proyecto. */
export function saveProjectSettings(
	cwd: string,
	settings: Partial<SubagentsSettings>,
): boolean {
	const filePath = projectFile(cwd);
	try {
		mkdirSync(join(filePath, ".."), { recursive: true });
		const current = loadProject(cwd);
		const merged = { ...current, ...settings };
		writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
		return true;
	} catch {
		return false;
	}
}

/** Formatea settings a texto legible (para /agents). */
export function formatSettings(settings: SubagentsSettings): string {
	const lines: string[] = ["Settings:"];
	lines.push(
		`  maxConcurrent: ${settings.maxConcurrent}`,
		`  defaultMaxTurns: ${settings.defaultMaxTurns === 0 ? "ilimitado" : settings.defaultMaxTurns}`,
		`  graceTurns: ${settings.graceTurns}`,
		`  joinMode: ${settings.joinMode}`,
	);
	return lines.join("\n");
}

/** Sólo tests. */
export const _DEFAULTS = DEFAULTS;
