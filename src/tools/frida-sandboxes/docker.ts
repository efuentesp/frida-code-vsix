/**
 * frida-sandboxes — adapter Docker local (issue #35, ADR-0047 D3/D5).
 *
 * Porte del patrón de lifecycle de pi-extension-e2b (edlsh, MIT) con el swap
 * E2B SDK → `docker` CLI: create/pause/resume/destroy → `docker`
 * create/pause/unpause/rm; file sync → `docker cp`; ejecución → `docker
 * exec`. Todo argv spawn (sin shell → sin inyección), igual que el seam de
 * frida-worktree (src/worktree/exec.ts).
 *
 * `probe()` es el gating de capability (ADR-0047 D5): detecta si Docker está
 * disponible en el host, con cache corto (PROBE_CACHE_MS).
 */
import { spawn } from "node:child_process";
import {
	DOCKER_OP_TIMEOUT_MS,
	PROBE_CACHE_MS,
} from "./constants";

/** Resultado de una ejecución de docker (éxito o exit code no-cero). */
export interface DockerExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
	readonly killed: boolean;
}

export interface DockerClient {
	/** `docker <args>` — argv spawn con cwd/timeout/abort opcionales. */
	exec(
		args: string[],
		opts?: { timeout?: number; signal?: AbortSignal },
	): Promise<DockerExecResult>;
}

export class DockerError extends Error {
	constructor(
		message: string,
		readonly code: string | undefined,
	) {
		super(message);
		this.name = "DockerError";
	}
}

/** Cliente docker real (spawn argv). Seam único — los tests inyectan fakes. */
export function createDockerClient(): DockerClient {
	return {
		async exec(args, opts) {
			return runDocker(args, opts?.timeout, opts?.signal);
		},
	};
}

async function runDocker(
	args: string[],
	timeout = DOCKER_OP_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<DockerExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});
		let stdout = "";
		let stderr = "";
		let killed = false;
		const timer = setTimeout(() => {
			killed = true;
			child.kill("SIGKILL");
		}, timeout);
		child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		child.on("error", (e: NodeJS.ErrnoException) => {
			// docker no instalado → ENOENT. Mensaje honesto para el gating.
			clearTimeout(timer);
			reject(
				new DockerError(
					e.code === "ENOENT"
						? "Docker no está instalado en el host (comando `docker` no encontrado)."
						: `No se pudo ejecutar docker: ${e.message}`,
					e.code,
				),
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? -1, killed });
		});
	});
}

// ── Capability probe (gating, ADR D5) ─────────────────────────────────────

export interface DockerCapability {
	/** Docker instalado Y el daemon responde. */
	available: boolean;
	/** Motivo cuando no está disponible (para disclosure honesta). */
	reason?: string;
	checkedAt: number;
}

let probeCache: DockerCapability | null = null;

/**
 * Probe de capability con cache (PROBE_CACHE_MS). `docker --version` dice si
 * el CLI existe; `docker info` si el daemon corre (Docker Desktop apagado →
 * CLI existe pero daemon no). Invalidable con force=true (botón "Reintentar
 * detección" del panel).
 */
export async function probeDocker(
	client: DockerClient,
	force = false,
): Promise<DockerCapability> {
	const now = Date.now();
	if (!force && probeCache && now - probeCache.checkedAt < PROBE_CACHE_MS) {
		return probeCache;
	}
	let cap: DockerCapability;
	try {
		const v = await client.exec(["--version"], { timeout: 5_000 });
		if (v.code === 0) {
			const info = await client.exec(["info", "--format", "{{.ServerVersion}}"], {
				timeout: 8_000,
			});
			cap =
				info.code === 0
					? { available: true, checkedAt: now }
					: {
							available: false,
							reason:
								"Docker CLI presente pero el daemon no responde (¿Docker Desktop apagado?).",
							checkedAt: now,
						};
		} else {
			cap = {
				available: false,
				reason: `docker --version salió con código ${v.code}`,
				checkedAt: now,
			};
		}
	} catch (e: any) {
		cap = {
			available: false,
			reason:
				e?.code === "ENOENT"
					? "Docker no está instalado en el host (comando `docker` no encontrado)."
					: String(e?.message ?? e),
			checkedAt: now,
		};
	}
	probeCache = cap;
	return cap;
}

/** Resetea el cache del probe (tests). */
export function resetProbeCache(): void {
	probeCache = null;
}

// ── Lifecycle (mapeo directo del patrón e2b → docker) ─────────────────────

/** Nombre canónico del container: frida-sbx-<name>. */
export function containerName(name: string): string {
	return `frida-sbx-${name}`;
}

export interface CreateOpts {
	/** Nombre corto (sin prefix). */
	name: string;
	image: string;
	/** Puerto del container → host ("5432:5432"). Opcional. */
	publish?: string[];
}

/** docker create + start: container listo con workdir /workspace. */
export async function createContainer(
	client: DockerClient,
	opts: CreateOpts,
): Promise<string> {
	const args = [
		"create",
		"--name",
		containerName(opts.name),
		"-w",
		"/workspace",
		...(opts.publish ?? []).flatMap((p) => ["-p", p]),
		opts.image,
		"sleep",
		"infinity",
	];
	const res = await client.exec(args);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker create falló", "create");
	const start = await client.exec(["start", containerName(opts.name)]);
	if (start.code !== 0)
		throw new DockerError(cleanErr(start.stderr) || "docker start falló", "start");
	return containerName(opts.name);
}

export async function pauseContainer(
	client: DockerClient,
	name: string,
): Promise<void> {
	const res = await client.exec(["pause", containerName(name)]);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker pause falló", "pause");
}

export async function resumeContainer(
	client: DockerClient,
	name: string,
): Promise<void> {
	const res = await client.exec(["unpause", containerName(name)]);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker unpause falló", "unpause");
}

export async function destroyContainer(
	client: DockerClient,
	name: string,
	force = false,
): Promise<void> {
	const args = ["rm", "-f"];
	if (!force) args.length = 2; // rm sin -f: falla si está corriendo (guard)
	const res = await client.exec(["rm", ...(force ? ["-f"] : []), containerName(name)]);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker rm falló", "rm");
}

/** docker exec — corre un comando dentro del container (argv, sin shell). */
export async function execInContainer(
	client: DockerClient,
	name: string,
	cmd: string[],
	opts?: { timeout?: number; signal?: AbortSignal; workdir?: string },
): Promise<DockerExecResult> {
	const res = await client.exec(
		[
			"exec",
			"-w",
			opts?.workdir ?? "/workspace",
			containerName(name),
			...cmd,
		],
		{ timeout: opts?.timeout, signal: opts?.signal },
	);
	return res;
}

/** docker cp IN: hostPath (archivo o dir) → container:/workspace[/dest]. */
export async function copyIntoContainer(
	client: DockerClient,
	name: string,
	hostPath: string,
	dest: string,
): Promise<void> {
	const res = await client.exec([
		"cp",
		hostPath,
		`${containerName(name)}:${dest}`,
	]);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker cp falló", "cp");
}

/** docker cp OUT: container:srcPath → hostDest. */
export async function copyOutOfContainer(
	client: DockerClient,
	name: string,
	srcPath: string,
	hostDest: string,
): Promise<void> {
	const res = await client.exec([
		"cp",
		`${containerName(name)}:${srcPath}`,
		hostDest,
	]);
	if (res.code !== 0)
		throw new DockerError(cleanErr(res.stderr) || "docker cp falló", "cp");
}

export type ContainerState =
	| "created"
	| "running"
	| "paused"
	| "exited"
	| "missing";

/** Inspecciona el estado real del container (docker inspect). */
export async function inspectContainer(
	client: DockerClient,
	name: string,
): Promise<ContainerState> {
	const res = await client.exec([
		"inspect",
		"--format",
		"{{.State.Status}}",
		containerName(name),
	]);
	if (res.code !== 0) return "missing";
	const s = res.stdout.trim();
	if (s === "running" || s === "paused" || s === "created" || s === "exited")
		return s;
	return "exited";
}

function cleanErr(stderr: string): string {
	return stderr.trim().split("\n").slice(-1)[0] ?? "";
}
