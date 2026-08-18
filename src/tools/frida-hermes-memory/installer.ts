/**
 * frida-hermes-memory — installer on-demand (issue #21, ADR-0032).
 *
 * Instala pi-hermes-memory@PIN en <agentDir>/npm (~/.frida/npm) con el MISMO
 * mecanismo que el PackageManager del SDK (patrón frida-codebase-index,
 * installer.ts): `npm install <spec> --prefix <agentDir>/npm
 * --legacy-peer-deps`. Los peer-deps (pi-ai, pi-coding-agent) NO se instalan
 * — se resuelven vía aliases de jiti a la copia del SDK que frida ya shipea
 * (constants.upstreamPeerAliases).
 *
 * ⚠️ better-sqlite3 NO es ABI-estable: publica prebuilds POR runtime/ABI, y
 * npm resuelve el del node que lo ejecuta (p. ej. nvm node 25 → ABI 141).
 * Pero el módulo lo REQUIERE el extension host, que corre el node bundled
 * de Electron (VS Code 1.133 → Electron 42 → ABI 146) → ABI mismatch → el
 * require falla y memory auto-review muere en ambos transports (issue #62).
 * Fix: tras un install exitoso bajo Electron, re-targetear el prebuild con
 * `prebuild-install --runtime electron --target <ver>` (bin del propio tree,
 * sin red extra; si falla: advisory, nunca rompe el install).
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
		opts?: { cwd?: string },
	) => Promise<{ code: number | null; stderr: string }>;
	/** Timeout del spawn (ms). Default 5 min (better-sqlite3 puede compilar). */
	timeoutMs?: number;
	/** Binario node para el retarget electron (issue #62); default "node". */
	nodeBin?: string;
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
async function defaultRun(bin: string, args: string[], opts?: {
	cwd?: string;
}) {
	return new Promise<{ code: number | null; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(bin, args, {
				...(opts?.cwd ? { cwd: opts.cwd } : {}),
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
	/** Issue #62: se re-targeteó el prebuild de better-sqlite3 al Electron del host. */
	retargeted: boolean;
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
		/** Versión de Electron del host (issue #62). Default: process.versions.electron. */
		electronVersion?: string;
	} = {},
): Promise<EnsureInstalledResult> {
	if (isInstalledAtPin(agentDir)) return { alreadyInstalled: true, retargeted: false };
	const {
		npmBin = "npm",
		run = defaultRun,
		timeoutMs = 5 * 60_000,
		nodeBin = "node",
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

	// Issue #62: bajo Electron, re-targetear el prebuild de better-sqlite3 al
	// ABI del extension host (npm lo resolvió para el node que ejecutó npm).
	// Best-effort: cualquier falla es advisory, nunca rompe el install.
	const electronVersion =
		opts.electronVersion ??
		(typeof process.versions.electron === "string" ? process.versions.electron : undefined);
	if (electronVersion) {
		const nm = path.join(agentDir, "npm", "node_modules");
		const pbiBin = path.join(nm, "prebuild-install", "bin.js");
		const sqliteDir = path.join(nm, "better-sqlite3");
		if (fs.existsSync(pbiBin) && fs.existsSync(path.join(sqliteDir, "package.json"))) {
			opts.onProgress?.(
				`Ajustando better-sqlite3 al Electron ${electronVersion} del extension host…`,
			);
			try {
				const rt = await withTimeout(
					run(
						nodeBin,
						[pbiBin, "--runtime", "electron", "--target", electronVersion],
						{ cwd: sqliteDir },
					),
					timeoutMs,
				);
				if (rt.code === 0) return { alreadyInstalled: false, retargeted: true };
				opts.onProgress?.(
					`No se pudo re-ajustar el prebuild de better-sqlite3 a Electron ${electronVersion} (exit ${rt.code}). ` +
						`Si la memoria falla con error de ABI, corre manualmente: cd "${sqliteDir}" && npx prebuild-install --runtime electron --target ${electronVersion}`,
				);
			} catch {
				opts.onProgress?.(
					`No se pudo re-ajustar el prebuild de better-sqlite3 a Electron ${electronVersion}. ` +
					`Si la memoria falla con error de ABI, corre manualmente: cd "${sqliteDir}" && npx prebuild-install --runtime electron --target ${electronVersion}`,
				);
			}
		}
	}
	return { alreadyInstalled: false, retargeted: false };
}
