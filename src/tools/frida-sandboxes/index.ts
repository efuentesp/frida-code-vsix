/**
 * frida-sandboxes — extensión (issue #35, ADR-0047).
 *
 * Container Docker local por agente ("own computer"): el agente crea un
 * sandbox, sus comandos `bash` se REDIRIGEN al container (hook tool_call
 * reescribe input.command → docker exec, patrón createE2bReadOps), los
 * cambios se revisan con git in-container y se mergean con docker cp.
 *
 * Superficie:
 *  - Tools: sandbox_create / sandbox_exec / sandbox_status / sandbox_changes
 *    / sandbox_merge / sandbox_destroy.
 *  - Comando /sandbox: panel webview (o texto si no hay sink).
 *  - Hook tool_call: redirección bash→container mientras haya sandbox
 *    activo para la sesión.
 *
 * Gating (D5): sin Docker, los tools degradan con mensaje honesto de una
 * línea — jamás botón muerto ni stack al usuario.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXEC_TIMEOUT_MS } from "./constants";
import {
	createDockerClient,
	probeDocker,
	resetProbeCache,
	type DockerClient,
} from "./docker";
import { SandboxManager, type SandboxRecord } from "./manager";
import {
	DEFAULT_POLICY,
	checkCommand,
	resolveAllowances,
	type SandboxPolicy,
} from "./policy";
import {
	SANDBOXES_COMMAND,
	SANDBOXES_FACTORY_NAME,
	sandboxesDir,
} from "./constants";

export { SANDBOXES_FACTORY_NAME };
import type {
	SandboxPanelActions,
	SandboxPanelRequest,
	SandboxPanelSink,
} from "./panel";

/** Shape del resultado de tool (AgentToolResult: content + details + isError). */
type ToolResult = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
};

export interface CreateSandboxesOpts {
	agentDir: string;
	/** cwd del workspace (default: process.cwd()). */
	cwd?: string;
	onLog?: (line: string) => void;
	/** Panel sink (webview). Sin él, /sandbox responde texto plano. */
	panel?: SandboxPanelSink;
	/** Policy in-container (settings frida.sandboxes.*). */
	policy?: SandboxPolicy;
	/** Seam de tests: cliente docker falso. */
	docker?: DockerClient;
}

function text(body: string, isError = false): ToolResult {
	return { content: [{ type: "text", text: body }], details: {}, isError };
}

function ok(body: string): ToolResult {
	return text(body, false);
}

function fail(body: string): ToolResult {
	return text(body, true);
}

export function createFridaSandboxes(
	opts: CreateSandboxesOpts & { onStateChange?: (s: { ready: boolean; sandboxes: number }) => void },
) {
	const { agentDir, onLog } = opts;
	const client = opts.docker ?? createDockerClient();
	const policy: SandboxPolicy = {
		...DEFAULT_POLICY,
		...(opts.policy ?? {}),
	};
	return async (pi: ExtensionAPI): Promise<void> => {
		const manager = new SandboxManager(client, agentDir);
		fs_mkdir(sandboxesDir(agentDir));
		const notifyState = () =>
			opts.onStateChange?.({
				ready: true,
				sandboxes: manager.list().length,
			});
		notifyState();

		// ── Redirección de tools (ADR D3): bash → docker exec ──
		// Mientras la sesión tenga un sandbox ACTIVO, el comando bash se
		// reescribe para correr dentro del container (el input es mutable:
		// pi ejecuta la mutación, no un bloqueo). Es la redirección real —
		// el agente no cambia su flujo, sólo cambia dónde corre.
		let activeSandbox: string | null = null;

		pi.on("tool_call", (event: any) => {
			if (event.toolName !== "bash" || !activeSandbox) return;
			const cmd: string | undefined = event.input?.command;
			if (typeof cmd !== "string" || !cmd.trim()) return;
			const violations = checkCommand(cmd, policy);
			if (violations.length) {
				return {
					block: true,
					reason: `sandbox_exec: policy in-container violada → ${violations
						.map((v) => v.message)
						.join("; ")}`,
				};
			}
			// docker exec -w /workspace <ctr> bash -lc '<cmd>' — single-quote
			// POSIX (el bash tool del host corre el wrapper vía shell).
			event.input.command = `docker exec -w /workspace frida-sbx-${activeSandbox} bash -lc ${shQuote(cmd)}`;
		});

		// ── Tools ──
		pi.registerTool({
			name: "sandbox_create",
			label: "sandbox_create",
			description:
				"Crea un sandbox: un container Docker local aislado con una copia del proyecto en /workspace. " +
				"Tras crearlo, TODOS tus comandos bash de esta sesión corren automáticamente DENTRO del sandbox " +
				"(redirección transparente) — instala dependencias, corre tests o scripts destructivos sin riesgo " +
				"para la máquina del usuario. Usa sandbox_changes para ver qué modificaste y sandbox_merge para " +
				"traer archivos de vuelta. VE DIRECTO AL TOOL cuando el usuario pida 'hazlo en un sandbox' o la " +
				"tarea sea destructiva y el usuario dude.",
			parameters: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Nombre corto opcional (default: sbx-N)",
					},
					image: {
						type: "string",
						description:
							"Imagen Docker (default: node:22 — trae git+npm). Debe incluir git para changes/merge.",
					},
				},
			},
			async execute(
				_args: string,
				args: { name?: string; image?: string },
			): Promise<ToolResult> {
				const cap = await probeDocker(client);
				if (!cap.available) {
					return fail(
						`📦 Sandbox no disponible (${cap.reason ?? "Docker no detectado"}). ` +
							"Continúa con las herramientas normales e informa al usuario que frida-sandboxes requiere Docker.",
					);
				}
				try {
					const rec = await manager.create({
						name: args?.name,
						image: args?.image,
						projectDir: opts.cwd ?? process.cwd(),
						createdBy: "agente",
					});
					activeSandbox = rec.name;
					return ok(
						[
							`📦 Sandbox '${rec.name}' listo (imagen ${rec.image}).`,
							"El proyecto está copiado en /workspace. Tus comandos bash YA corren dentro del sandbox.",
							`Policy: dominios ${resolveAllowances(policy).domains} · escritura en ${resolveAllowances(policy).writePaths}.`,
							"Revisa cambios con sandbox_changes; tráelos de vuelta con sandbox_merge.",
						].join("\n"),
					);
				} catch (e: any) {
					return fail(`sandbox_create falló: ${e?.message ?? e}`);
				}
			},
		});

		pi.registerTool({
			name: "sandbox_exec",
			label: "sandbox_exec",
			description:
				"Ejecuta un comando DENTRO del sandbox activo (docker exec). Úsalo para comandos que quieras " +
				"aislados aunque la redirección automática ya cubra bash. Sujeto a policy in-container (dominios " +
				"de red y rutas de escritura).",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Comando shell a ejecutar" },
				},
				required: ["command"],
			},
			async execute(
				_args: string,
				args: { command?: string },
			): Promise<ToolResult> {
				const cmd = args?.command?.trim();
				if (!cmd) return fail("sandbox_exec: falta 'command'.");
				if (!activeSandbox)
					return fail(
						"No hay sandbox activo en esta sesión. Créalo con sandbox_create primero.",
					);
				const violations = checkCommand(cmd, policy);
				if (violations.length)
					return fail(`Policy: ${violations.map((v) => v.message).join("; ")}`);
				try {
					const res = await manager.exec(
						activeSandbox,
						["bash", "-lc", cmd],
						{ timeout: EXEC_TIMEOUT_MS },
					);
					const body =
						[res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n") ||
						"(sin output)";
					return text(
						`exit ${res.code}\n${body}`,
						res.code !== 0,
					);
				} catch (e: any) {
					return fail(`sandbox_exec falló: ${e?.message ?? e}`);
				}
			},
		});

		pi.registerTool({
			name: "sandbox_status",
			label: "sandbox_status",
			description:
				"Lista los sandboxes de Frida (nombre, imagen, estado, proyecto) — el inventario vivo del panel /sandbox.",
			parameters: { type: "object", properties: {} },
			async execute(): Promise<ToolResult> {
				const list = manager.list();
				if (!list.length)
					return ok("Sin sandboxes. Crea uno con sandbox_create.");
				const lines = list.map(
					(s) =>
						`• ${s.name} — ${s.image} · ${s.state} · creado ${new Date(s.createdAt).toLocaleString("es-MX")}${s.name === activeSandbox ? " · ACTIVO en esta sesión" : ""}`,
				);
				return ok(lines.join("\n"));
			},
		});

		pi.registerTool({
			name: "sandbox_changes",
			label: "sandbox_changes",
			description:
				"Archivos modificados dentro del sandbox (git status --porcelain in-container). Úsalo antes de " +
				"sandbox_merge para revisar qué produced el agente en el container.",
			parameters: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Sandbox (default: el activo de la sesión)",
					},
				},
			},
			async execute(_a: string, args: { name?: string }): Promise<ToolResult> {
				const name = args?.name ?? activeSandbox;
				if (!name) return fail("No hay sandbox activo ni nombre dado.");
				try {
					const files = await manager.changes(name);
					return ok(
						files.length
							? `${files.length} archivo(s) modificados:\n${files.join("\n")}`
							: "Sin cambios en el sandbox (árbol limpio).",
					);
				} catch (e: any) {
					return fail(`sandbox_changes falló: ${e?.message ?? e}`);
				}
			},
		});

		pi.registerTool({
			name: "sandbox_merge",
			label: "sandbox_merge",
			description:
				"Trae archivos del sandbox de vuelta al proyecto local (docker cp archivo a archivo). Pide la " +
				"lista de archivos con sandbox_changes y mergea solo los que el usuario apruebe.",
			parameters: {
				type: "object",
				properties: {
					files: {
						type: "array",
						items: { type: "string" },
						description: "Rutas relativas al proyecto (ej. src/app.ts)",
					},
				},
				required: ["files"],
			},
			async execute(
				_a: string,
				args: { files?: string[] },
			): Promise<ToolResult> {
				const files = args?.files ?? [];
				if (!files.length) return fail("sandbox_merge: falta 'files'.");
				const name = activeSandbox;
				if (!name) return fail("No hay sandbox activo en esta sesión.");
				const merged: string[] = [];
				try {
					for (const f of files) merged.push(await manager.mergeFile(name, f));
				} catch (e: any) {
					return fail(
						`sandbox_merge falló en el archivo ${merged.length + 1}: ${e?.message ?? e}`,
					);
				}
				return ok(`Mergeados ${merged.length} archivo(s):\n${merged.join("\n")}`);
			},
		});

		pi.registerTool({
			name: "sandbox_destroy",
			label: "sandbox_destroy",
			description:
				"Destruye el sandbox (docker rm -f). Irreversible — pregunta al usuario antes si hay cambios sin mergear.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string", description: "Sandbox (default: activo)" },
				},
			},
			async execute(_a: string, args: { name?: string }): Promise<ToolResult> {
				const name = args?.name ?? activeSandbox;
				if (!name) return fail("No hay sandbox activo ni nombre dado.");
				try {
					const changes = await manager.changes(name).catch(() => [] as string[]);
					if (changes.length)
						return fail(
							`El sandbox '${name}' tiene ${changes.length} cambio(s) sin mergear. ` +
								"Mergea (sandbox_merge) o confirma destrucción con el usuario antes.",
						);
					await manager.destroy(name);
					if (activeSandbox === name) activeSandbox = null;
					return ok(`Sandbox '${name}' destruido.`);
				} catch (e: any) {
					return fail(`sandbox_destroy falló: ${e?.message ?? e}`);
				}
			},
		});

		// ── Comando /sandbox ──
		notifyState();

		pi.registerCommand(SANDBOXES_COMMAND, {
			description:
				"Gestiona sandboxes Docker (create/list/exec/changes/merge/destroy/pause/resume)",
			handler: async (args: string, ctx: any) => {
				const raw = (args ?? "").trim();
				const [sub, ...rest] = raw.split(/\s+/);
				const notify = (m: string) => {
					try {
						ctx.ui.notify(m, "info");
					} catch {
						onLog?.(`[sandboxes] ${m}`);
					}
				};
				try {
					switch (sub) {
						case "":
						case "list": {
							const cap = await probeDocker(client);
							const list = manager.list();
							const body = cap.available
								? list.length
									? list.map((s) => rowLine(s)).join("\n")
									: "Sin sandboxes. /sandbox create <nombre> para crear uno."
								: `📦 Sandboxes requiere Docker — ${cap.reason ?? "no detectado"}.\nInstálalo (macOS: Docker Desktop/OrbStack · Linux: docker.io) y reintenta con /sandbox.`;
							emitPanelOrNotify(
								opts.panel,
								manager,
								body,
								notify,
								cap,
								client,
							);
							return;
						}
						case "create": {
							const name = rest.find((a) => !a.startsWith("--"));
							const image = flagValue(rest, "--image");
							const cap = await probeDocker(client);
							if (!cap.available) {
								notify(
									`📦 Sandbox no disponible (${cap.reason ?? "Docker no detectado"}) — instala Docker y reintenta.`,
								);
								return;
							}
							const rec = await manager.create({
								name,
								image,
								projectDir: opts.cwd ?? ctx.cwd ?? process.cwd(),
								createdBy: "comando",
							});
							notify(
								`📦 Sandbox '${rec.name}' creado (imagen ${rec.image}). El agente lo usará con sandbox_create/sandbox_exec.`,
							);
							return;
						}
						case "pause":
						case "resume": {
							const name = rest[0];
							if (!name) {
								notify(`Uso: /sandbox ${sub} <nombre>`);
								return;
							}
							await (sub === "pause"
								? manager.pause(name)
								: manager.resume(name));
							notify(`Sandbox '${name}' ${sub === "pause" ? "pausado" : "reanudado"}.`);
							return;
						}
						case "destroy": {
							const name = rest.find((a) => !a.startsWith("--"));
							const force = rest.includes("--force");
							if (!name) {
								notify("Uso: /sandbox destroy <nombre> [--force]");
								return;
							}
							if (!force) {
								const changes = await manager.changes(name).catch(() => []);
								if (changes.length) {
									notify(
										`'${name}' tiene ${changes.length} cambio(s) sin mergear — /sandbox destroy ${name} --force para confirmar.`,
									);
									return;
								}
							}
							await manager.destroy(name);
							notify(`Sandbox '${name}' destruido.`);
							return;
						}
						case "probe": {
							resetProbeCache();
							const cap = await probeDocker(client, true);
							notify(
								cap.available
									? `✅ Docker disponible (daemon ${new Date(cap.checkedAt).toLocaleTimeString("es-MX")}).`
									: `❌ Docker no disponible: ${cap.reason}`,
							);
							return;
						}
						default:
							notify(
								"Subcomandos: create [nombre] [--image img] · list · pause/resume <n> · destroy <n> [--force] · probe",
							);
					}
				} catch (e: any) {
					notify(`[sandboxes] ${e?.message ?? e}`);
				}
			},
		});

		onLog?.("[sandboxes] extensión activa (gating: requiere Docker en el host).");
	};
}

// ── helpers ──

function fs_mkdir(dir: string): void {
	import("node:fs").then((fs) => fs.mkdirSync(dir, { recursive: true }));
}

function rowLine(s: SandboxRecord): string {
	return `• ${s.name} — ${s.image} · ${s.state}${s.lastSeen ? ` (docker: ${s.lastSeen})` : ""} · ${s.projectDir}`;
}

function flagValue(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
}

/** Single-quote POSIX (bash tool del host corre el wrapper vía shell). */
export function shQuote(cmd: string): string {
	return `'${cmd.replace(/'/g, `'\\''`)}'`;
}

/** Emite el panel webview (si hay sink) o cae a notify honesto. */
function emitPanelOrNotify(
	sink: SandboxPanelSink | undefined,
	manager: SandboxManager,
	body: string,
	notify: (m: string) => void,
	cap: { available: boolean; reason?: string },
	client: DockerClient,
	onTerminal?: (name: string) => Promise<void>,
): void {
	if (!sink) {
		notify(body);
		return;
	}
	emitSandboxPanel(sink, manager, cap, client, onTerminal);
}

/**
 * Emite el panel con id estable: las acciones re-emiten con el MISMO id
 * (el webview actualiza en sitio sin perder tab/foco — patrón /ccplugin).
 */
export function emitSandboxPanel(
	sink: SandboxPanelSink,
	manager: SandboxManager,
	cap: { available: boolean; reason?: string },
	client: DockerClient,
	onTerminal?: (name: string) => Promise<void>,
	id = `sbx-${Date.now()}`,
): void {
	const emit = () => {
		const active = manager.list();
		sink({
			id,
			title: `Sandboxes (${active.length})`,
			sandboxes: active.map((s) => ({
				name: s.name,
				image: s.image,
				state: s.state === "paused" ? "paused" : "active",
				createdAt: s.createdAt,
				projectDir: s.projectDir,
				createdBy: s.createdBy,
				lastSeen: s.lastSeen,
			})),
			docker: { available: cap.available, reason: cap.reason },
			actions: {
				refresh: async () => emit(),
				pause: (n) => manager.pause(n).then(() => `Sandbox '${n}' pausado.`),
				resume: (n) => manager.resume(n).then(() => `Sandbox '${n}' reanudado.`),
				destroy: (n) => manager.destroy(n).then(() => `Sandbox '${n}' destruido.`),
				changes: (n) => manager.changes(n),
				mergeFiles: async (n, files) => {
					const out: string[] = [];
					for (const f of files) out.push(await manager.mergeFile(n, f));
					return `Mergeados ${out.length} archivo(s): ${out.join(", ")}`;
				},
				...(onTerminal ? { terminal: onTerminal } : {}),
				reprobe: async () => {
					resetProbeCache();
					const fresh = await probeDocker(client, true);
					cap = fresh;
					emit();
				},
			},
		});
	};
	emit();
}
