/**
 * frida-sandboxes — SandboxManager (issue #35, ADR-0047).
 *
 * Registro persistente (~/.frida/sandboxes/registry.json) + orquestación de
 * lifecycle sobre el adapter Docker. La política de nombres es auto-<n> y la
 * de sync es "repo completo via docker cp" (MVP): el repo del proyecto se
 * copia al crear y los cambios se revisan con `git status` in-container
 * (flujo changes/merge estilo frida-worktree).
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	CONTAINER_WORKDIR,
	DEFAULT_IMAGE,
	registryPath,
	sandboxesDir,
} from "./constants";
import {
	copyIntoContainer,
	copyOutOfContainer,
	createContainer,
	destroyContainer,
	execInContainer,
	inspectContainer,
	pauseContainer,
	resumeContainer,
	type ContainerState,
	type DockerClient,
	DockerError,
} from "./docker";

/** Registro persistido por sandbox. */
export interface SandboxRecord {
	/** Nombre corto (sin prefix frida-sbx-). */
	name: string;
	image: string;
	createdAt: string;
	/** Estado deseado según el registry (la verdad viva la da docker). */
	state: "active" | "paused" | "destroyed";
	/** Proyecto (dir base) con el que se creó. */
	projectDir: string;
	/** Origen: quién pidió el sandbox. */
	createdBy: string;
	/** Último estado observado del container (refresh). */
	lastSeen?: ContainerState;
	publish?: string[];
}

export interface SandboxRegistry {
	sandboxes: SandboxRecord[];
}

export function loadRegistry(agentDir: string): SandboxRegistry {
	try {
		const raw = JSON.parse(fs.readFileSync(registryPath(agentDir), "utf8"));
		if (Array.isArray(raw?.sandboxes)) return raw as SandboxRegistry;
	} catch {
		/* sin registry → vacío */
	}
	return { sandboxes: [] };
}

export function saveRegistry(agentDir: string, reg: SandboxRegistry): void {
	fs.mkdirSync(sandboxesDir(agentDir), { recursive: true });
	fs.writeFileSync(registryPath(agentDir), JSON.stringify(reg, null, "\t"));
}

export class SandboxManager {
	constructor(
		private readonly client: DockerClient,
		private readonly agentDir: string,
	) {}

	private reg(): SandboxRegistry {
		return loadRegistry(this.agentDir);
	}

	private commit(reg: SandboxRegistry): void {
		saveRegistry(this.agentDir, reg);
	}

	list(): SandboxRecord[] {
		return this.reg().sandboxes.filter((s) => s.state !== "destroyed");
	}

	get(name: string): SandboxRecord | undefined {
		return this.reg().sandboxes.find((s) => s.name === name);
	}

	/**
	 * Crea un sandbox: docker create/start + sync del proyecto (docker cp).
	 * Copia el repo completo (respetando .dockerignore si existe) — el
	 * container tiene su copia independiente; los cambios viven ahí hasta
	 * merge/merge-files.
	 */
	async create(opts: {
		name?: string;
		image?: string;
		projectDir: string;
		createdBy: string;
		publish?: string[];
	}): Promise<SandboxRecord> {
		const reg = this.reg();
		const name = opts.name ?? autoName(reg);
		if (reg.sandboxes.some((s) => s.name === name && s.state !== "destroyed")) {
			throw new DockerError(`Ya existe un sandbox llamado '${name}'.`, "dup");
		}
		const image = opts.image ?? DEFAULT_IMAGE;
		await createContainer(this.client, {
			name,
			image,
			publish: opts.publish,
		});
		// Sync in: repo del proyecto → /workspace (docker cp del dir).
		await copyIntoContainer(
			this.client,
			name,
			opts.projectDir + path.sep + ".",
			CONTAINER_WORKDIR,
		);
		const rec: SandboxRecord = {
			name,
			image,
			createdAt: new Date().toISOString(),
			state: "active",
			projectDir: opts.projectDir,
			createdBy: opts.createdBy,
			publish: opts.publish,
		};
		reg.sandboxes.push(rec);
		this.commit(reg);
		return rec;
	}

	/** Ejecuta un comando dentro del container (argv). */
	async exec(
		name: string,
		cmd: string[],
		opts?: { timeout?: number; signal?: AbortSignal },
	) {
		await this.assertActive(name);
		return execInContainer(this.client, name, cmd, opts);
	}

	/** Refresca lastSeen con la verdad de docker (para el panel). */
	async refresh(name: string): Promise<ContainerState> {
		const rec = this.get(name);
		if (!rec) return "missing";
		const state = await inspectContainer(this.client, name);
		const reg = this.reg();
		const found = reg.sandboxes.find((s) => s.name === name);
		if (found) found.lastSeen = state;
		this.commit(reg);
		return state;
	}

	async pause(name: string): Promise<void> {
		await this.assertActive(name);
		await pauseContainer(this.client, name);
		this.mark(name, "paused");
	}

	async resume(name: string): Promise<void> {
		const rec = this.get(name);
		if (!rec || rec.state === "destroyed")
			throw new DockerError(`Sandbox '${name}' no existe.`, "missing");
		await resumeContainer(this.client, name);
		this.mark(name, "active");
	}

	/**
	 * Destruye el container (rm -f). El registro conserva el record con
	 * state=destroyed (historial del panel Finalizados) pero `list()` ya no
	 * lo devuelve.
	 */
	async destroy(name: string): Promise<void> {
		const rec = this.get(name);
		if (!rec)
			throw new DockerError(`Sandbox '${name}' no existe.`, "missing");
		await destroyContainer(this.client, name, true);
		this.mark(name, "destroyed");
	}

	/**
	 * Cambios pendientes in-container: `git status --porcelain` en
	 * /workspace. Requiere que el proyecto sea un repo git (flujo merge
	 * estilo worktree).
	 */
	async changes(name: string): Promise<string[]> {
		await this.assertActive(name);
		const res = await execInContainer(this.client, name, [
			"git",
			"status",
			"--porcelain",
		]);
		if (res.code !== 0) {
			throw new DockerError(
				`git status falló dentro del sandbox (¿no es un repo git?): ${res.stderr.trim()}`,
				"git",
			);
		}
		return res.stdout
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	}

	/**
	 * Merge de UN archivo: docker cp del archivo del container → host.
	 * (Merge completo por branch/cherry-pick queda para la fase de
	 * integración con workflows; MVP = archivo a archivo, como el panel.)
	 */
	async mergeFile(name: string, file: string): Promise<string> {
		await this.assertActive(name);
		const rec = this.get(name)!;
		// Rutas seguras: relativas al workdir del container. Las absolutas SOLO
		// se aceptan si ya vienen prefijadas con /workspace (se convierten a
		// relativas); cualquier otra ruta absoluta o con .. se rechaza ANTES
		// de normalizar (bug: el replace /^\/+\/ despojaba el slash inicial y
		// /etc/passwd pasaba como relativa válida).
		let clean = file;
		if (path.posix.isAbsolute(clean)) {
			if (!clean.startsWith(CONTAINER_WORKDIR + "/")) {
				throw new DockerError(`Ruta de merge inválida: ${file}`, "path");
			}
			clean = clean.slice(CONTAINER_WORKDIR.length + 1);
		}
		const rel = path.posix.normalize(clean);
		if (
			rel === "" ||
			rel === "." ||
			rel.startsWith("..") ||
			path.posix.isAbsolute(rel)
		) {
			throw new DockerError(`Ruta de merge inválida: ${file}`, "path");
		}
		const hostDest = path.join(rec.projectDir, rel);
		await copyOutOfContainerSafe(this.client, name, rel, hostDest);
		return hostDest;
	}

	private async assertActive(name: string): Promise<void> {
		const rec = this.get(name);
		if (!rec || rec.state === "destroyed")
			throw new DockerError(`Sandbox '${name}' no existe.`, "missing");
		if (rec.state === "paused")
			throw new DockerError(
				`Sandbox '${name}' está pausado — reanúdalo primero.`,
				"paused",
			);
	}

	private mark(name: string, state: SandboxRecord["state"]): void {
		const reg = this.reg();
		const found = reg.sandboxes.find((s) => s.name === name);
		if (found) found.state = state;
		this.commit(reg);
	}
}

/** docker cp OUT con mkdir del dir destino (docker cp no crea padres). */
async function copyOutOfContainerSafe(
	client: DockerClient,
	name: string,
	rel: string,
	hostDest: string,
): Promise<void> {
	fs.mkdirSync(path.dirname(hostDest), { recursive: true });
	await copyOutOfContainer(client, name, `${CONTAINER_WORKDIR}/${rel}`, hostDest);
}

/** Nombre auto: sbx-N (siguiente índice libre). */
function autoName(reg: SandboxRegistry): string {
	const taken = new Set(reg.sandboxes.map((s) => s.name));
	let i = 1;
	while (taken.has(`sbx-${i}`)) i++;
	return `sbx-${i}`;
}

/** Id corto de sandbox para logs/panel. */
export function shortId(): string {
	return randomUUID().slice(0, 8);
}
