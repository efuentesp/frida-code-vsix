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

/** Modelo disponible en el registry (shape mínimo para el auto-review #72). */
export interface NativeModelRef {
	provider: string;
	id: string;
}

/** Config de hermes que garantiza auto-review funcional (#72). */
export interface AutoReviewOverride {
	llmModelOverride: string;
	llmThinkingOverride: "off";
}

/**
 * Providers registrados por frida-code vía ModelRuntime.registerProvider
 * (frida-enterprise, softtek-devengine): el subprocess de hermes corre un pi
 * plano SIN extensiones → no los ve, tengas o no token. Jamás son candidatos
 * de override (#72); sólo los providers nativos de pi lo son.
 */
const EXTENSION_ONLY_PROVIDERS = new Set(["frida-enterprise", "softtek-devengine"]);

/**
 * #72: si el modelo activo es de un provider de EXTENSIÓN (frida-enterprise,
 * softtek…), el subprocess de hermes no lo ve (pi plano sin extensiones →
 * "Model not found") y el direct puede tropezar con formatos de respuesta
 * que su parser no tolera (array puro → parse_error). Resuelve un override
 * a un provider NATIVO con auth disponible para que el auto-review corra
 * OOB en ambos transports. Pura — la llamada al registry/escritura es aparte.
 *
 * - Modelo activo nativo → undefined (no hace falta override).
 * - Sin modelo activo, sin nativos con auth, o ya resuelto → undefined
 *   (best-effort: nunca rompe el install).
 * - Elección determinista: primer nativo con auth distinto del activo, en
 *   el orden del registry (estable entre corridas).
 */
export function resolveAutoReviewOverride(
	activeModel: { provider?: string; id?: string } | undefined,
	availableModels: readonly NativeModelRef[],
	authedNativeProviders: readonly string[],
): AutoReviewOverride | undefined {
	const authed = new Set(authedNativeProviders);
	// Sin modelo activo no hay problema diagnosticable — no se escribe un
	// override preventivo (el usuario puede elegir luego un nativo).
	if (!activeModel?.provider || !activeModel.id) return undefined;
	// El modelo activo ya lo ve el subprocess → nada que hacer.
	if (authed.has(activeModel.provider)) return undefined;
	// Primer nativo con auth disponible (orden del registry, determinista).
	// Los providers de extensión jamás son candidatos aunque estén en la lista.
	const candidate = availableModels.find(
		(m) =>
			m.provider !== activeModel.provider &&
			authed.has(m.provider) &&
			!EXTENSION_ONLY_PROVIDERS.has(m.provider),
	);
	if (!candidate) return undefined;
	return {
		llmModelOverride: `${candidate.provider}/${candidate.id}`,
		llmThinkingOverride: "off",
	};
}

/**
 * #72: computa el override desde el registry real — filtra providers de
 * extensión (sin auth de subprocess) y exige auth verificada
 * (getApiKeyForProvider) antes de proponer un nativo. Best-effort: un error
 * de auth cuenta como "sin auth" (ese provider queda descartado).
 */
export async function computeAutoReviewOverride(opts: {
	activeModel: { provider?: string; id?: string } | undefined;
	allModels: readonly NativeModelRef[];
	getApiKeyForProvider: (provider: string) => Promise<string | undefined>;
}): Promise<AutoReviewOverride | undefined> {
	// Deduplica providers de los modelos disponibles y verifica auth de cada
	// uno. Los de extensión se descartan sin gastar la llamada de auth.
	const providers = [
		...new Set(
			opts.allModels
				.map((m) => m.provider)
				.filter((p) => !EXTENSION_ONLY_PROVIDERS.has(p)),
		),
	];
	const authed: string[] = [];
	for (const provider of providers) {
		try {
			const key = await opts.getApiKeyForProvider(provider);
			if (key && key.trim()) authed.push(provider);
		} catch {
			// Error de auth = sin auth para este provider (best-effort).
		}
	}
	return resolveAutoReviewOverride(opts.activeModel, opts.allModels, authed);
}

/**
 * #72: escribe hermes-memory-config.json con el override — MERGE no
 * destructivo: preserva llaves ajenas del usuario. Se abstiene (false) si:
 * - override undefined (nada que garantizar),
 * - ya existe llmModelOverride del usuario (su decisión manda),
 * - el override ya está aplicado (idempotente, no re-loggea en cada reload).
 * Best-effort: fallas de escritura se tragan (el install no debe romper).
 */
export function applyAutoReviewOverride(
	agentDir: string,
	override: AutoReviewOverride | undefined,
): boolean {
	if (!override) return false;
	const cfgPath = path.join(agentDir, "hermes-memory-config.json");
	let existing: Record<string, unknown> = {};
	try {
		existing = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
	} catch {
		// Sin config previo (o corrupto) → se crea nuevo.
	}
	// El usuario ya decidió su modelo de auto-review → no pisarlo.
	if (typeof existing.llmModelOverride === "string" && existing.llmModelOverride.trim()) {
		return false;
	}
	// Idempotente: ya aplicado (p. ej. tras /reload) → no reescribir.
	if (existing.llmModelOverride === override.llmModelOverride) return false;
	try {
		fs.writeFileSync(
			cfgPath,
			JSON.stringify(
				{ ...existing, ...override },
			null,
			"\t",
		) + "\n",
		);
		return true;
	} catch {
		return false; // Best-effort: nunca rompe el arranque.
	}
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
