/**
 * frida-hermes-memory — installer on-demand (issue #21, ADR-0032).
 *
 * Instala pi-hermes-memory@PIN en <agentDir>/npm (~/.frida/npm) con el MISMO
 * mecanismo que el PackageManager del SDK (patrón frida-codebase-index,
 * installer.ts): `npm install <spec> --prefix <agentDir>/npm
 * --legacy-peer-deps`. Los peer-deps (pi-ai, pi-coding-agent) NO se instalan
 * — se resuelven vía aliases de jiti a la copia del SDK que frida ya shipea
 * (constants.upstreamPeerAliases). better-sqlite3 (dep nativa del upstream)
 * resuelve su prebuild N-API en el install (ABI-estable; verificado que hay
 * prebuilds node-v115..v141 y que el binding usa node-addon-api NAPI v10).
 *
 * Sin poda de natives (a diferencia de codebase-index): better-sqlite3
 * descarga SOLO el prebuild de la plataforma actual vía prebuild-install.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	HERMES_MEMORY_PIN,
	HERMES_MEMORY_SPEC,
	installedVersionPath,
	upstreamEntryPath,
} from "./constants";

/** Error de instalación con guía accionable (D6: nunca errores opacos). */
export class HermesMemoryInstallError extends Error {
	/** Pasos concretos para resolver (se loggea/notifica al usuario). */
	readonly guide: string;
	constructor(message: string, guide: string) {
		super(message);
		this.name = "HermesMemoryInstallError";
		this.guide = guide;
	}
}

/** Ejecutable/resultado inyectable para tests. */
export interface InstallDeps {
	npmBin?: string;
	/** Spawn inyectable: resuelve código de salida o rechaza (ENOENT npm ausente). */
	run?: (
		bin: string,
		args: string[],
	) => Promise<{ code: number | null; stderr: string }>;
	/** Timeout del spawn (ms). Default 5 min (mejor-sqlite3 puede compilar). */
	timeoutMs?: number;
}

/** Versión instalada del paquete en ~/.frida/npm (lee su package.json). */
export function installedVersion(agentDir: string): string | undefined {
	try {
		const raw = JSON.parse(
			fs.readFileSync(installedVersionPath(agentDir), "utf-8"),
		) as { version?: string };
		return typeof raw.version === "string" ? raw.version : undefined;
	} catch {
		return undefined;
	}
}

/** ¿El paquete está instalado con el pin actual y entry válido? */
export function isInstalledAtPin(agentDir: string): boolean {
	return (
		installedVersion(agentDir) === HERMES_MEMORY_PIN &&
		fs.existsSync(upstreamEntryPath(agentDir))
	);
}

/** Ejecuta un comando (impl real por defecto; win32 usa shell para npm.cmd). */
async function defaultRun(bin: string, args: string[]) {
	return new Promise<{ code: number | null; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(bin, args, {
				shell: process.platform === "win32",
			});
			let stderr = "";
			child.stderr?.on("data", (d) => {
				stderr += String(d);
			});
			child.on("error", reject); // ENOENT: npm ausente
			child.on("close", (code) => resolve({ code, stderr }));
		},
	);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(
			() =>
				reject(
					Object.assign(new Error(`timeout tras ${ms}ms`), {
						code: "ETIMEOUT",
					}),
				),
			ms,
		);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}

/** Comando manual equivalente, con prefix ABSOLUTO entre comillas (win32). */
export function manualInstallCmd(agentDir: string): string {
	return `npm install ${HERMES_MEMORY_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`;
}

export interface EnsureInstalledResult {
	alreadyInstalled: boolean;
}

/**
 * Garantiza que pi-hermes-memory@PIN esté instalado en <agentDir>/npm.
 * Idempotente: si ya está al pin con entry válido, no toca nada.
 * Falla con HermesMemoryInstallError (guía accionable) si npm falta/timeout/
 * install falla (prebuild de better-sqlite3 sin asset para tu Node → intenta
 * compilar con node-gyp → requiere toolchain de C++).
 */
export async function ensureInstalled(
	agentDir: string,
	opts: {
		deps?: InstallDeps;
		onProgress?: (line: string) => void;
	} = {},
): Promise<EnsureInstalledResult> {
	if (isInstalledAtPin(agentDir)) return { alreadyInstalled: true };
	const {
		npmBin = "npm",
		run = defaultRun,
		timeoutMs = 5 * 60_000,
	} = opts.deps ?? {};
	opts.onProgress?.(
		`Instalando ${HERMES_MEMORY_SPEC} en ${path.join(agentDir, "npm")} (incluye better-sqlite3 nativo)…`,
	);
	fs.mkdirSync(path.join(agentDir, "npm"), { recursive: true });
	let res: { code: number | null; stderr: string };
	try {
		res = await withTimeout(
			run(npmBin, [
				"install",
				HERMES_MEMORY_SPEC,
				"--prefix",
				path.join(agentDir, "npm"),
				"--legacy-peer-deps",
				"--no-audit",
				"--no-fund",
			]),
			timeoutMs,
		);
	} catch (e: any) {
		if (e?.code === "ETIMEOUT") {
			throw new HermesMemoryInstallError(
				`La instalación excedió ${Math.round(timeoutMs / 60_000)} min.`,
				"Reintenta con mejor red, o corre manualmente: " +
					manualInstallCmd(agentDir),
			);
		}
		throw new HermesMemoryInstallError(
			`npm no está disponible (${e?.message ?? e}).`,
			"Instala Node.js 20+ (incluye npm) o corre manualmente: " +
				manualInstallCmd(agentDir),
		);
	}
	if (res.code !== 0 || !fs.existsSync(upstreamEntryPath(agentDir))) {
		throw new HermesMemoryInstallError(
			`npm install falló (exit ${res.code}). ${res.stderr.slice(0, 500)}`,
			"Revisa la salida (red/proxy corporativo o toolchain C++ ausente para better-sqlite3 son las causas típicas). Comando manual: " +
				manualInstallCmd(agentDir),
		);
	}
	return { alreadyInstalled: false };
}
