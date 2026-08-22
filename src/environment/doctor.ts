import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	DependencyStatus,
	EnvironmentReport,
	SupportedPlatform,
} from "./types";

export type ExecResult = {
	stdout: string;
	stderr: string;
	code: number;
};

export type ExecFn = (
	cmd: string,
	args: string[],
	timeoutMs?: number,
) => Promise<ExecResult>;

export const defaultExec: ExecFn = (
	cmd: string,
	args: string[],
	timeoutMs = 4000,
): Promise<ExecResult> => {
	return new Promise((resolve) => {
		try {
			const child = spawn(cmd, args, {
				stdio: ["ignore", "pipe", "pipe"],
				timeout: timeoutMs,
				windowsHide: true,
			});

			let stdout = "";
			let stderr = "";

			child.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d) => {
				stderr += d.toString();
			});

			child.on("error", (err) => {
				resolve({
					stdout: "",
					stderr: err.message,
					code: -1,
				});
			});

			child.on("close", (code) => {
				resolve({
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					code: code ?? 0,
				});
			});
		} catch (err: any) {
			resolve({
				stdout: "",
				stderr: String(err?.message ?? err),
				code: -1,
			});
		}
	});
};

function normalizePlatform(p: NodeJS.Platform): SupportedPlatform {
	if (p === "win32") return "win32";
	if (p === "darwin") return "darwin";
	return "linux";
}

function getPlatformLabel(p: NodeJS.Platform): string {
	if (p === "win32") return "Windows";
	if (p === "darwin") return "macOS";
	return "Linux";
}

export async function checkGit(exec: ExecFn): Promise<DependencyStatus> {
	const res = await exec("git", ["--version"]);
	const installed =
		res.code === 0 && res.stdout.toLowerCase().includes("git version");
	const versionMatch = res.stdout.match(/git version\s+([^\s]+)/i);
	const version = versionMatch
		? versionMatch[1]
		: installed
			? res.stdout
			: undefined;

	return {
		id: "git",
		name: "Git",
		category: "core",
		installed,
		version,
		description:
			"Control de versiones, worktrees, respaldo automático y gestión de código.",
		usedBy: "Core, Worktrees, Git Sync, Pipeline AIDD, cc-plugins",
		installGuides: {
			win32: {
				command: "winget install --id Git.Git -e --source winget",
				guide:
					"Selecciona 'Git from the command line and 3rd-party software' durante el instalador.",
				url: "https://git-scm.com/download/win",
			},
			darwin: {
				command: "brew install git",
				guide:
					"O ejecuta 'xcode-select --install' para las herramientas de desarrollo de Apple.",
				url: "https://git-scm.com/download/mac",
			},
			linux: {
				command: "sudo apt update && sudo apt install -y git",
				guide:
					"En Fedora/RHEL usa 'sudo dnf install git'; en Arch usa 'sudo pacman -S git'.",
				url: "https://git-scm.com/download/linux",
			},
		},
	};
}

export async function checkBash(
	exec: ExecFn,
	platform: NodeJS.Platform = process.platform,
): Promise<DependencyStatus> {
	let installed = false;
	let version: string | undefined;
	let foundPath: string | undefined;
	let notes: string | undefined;

	if (platform === "win32") {
		// En Windows: preferir Git Bash en rutas estándar
		const candidates = [
			path.join(
				process.env.ProgramFiles || "C:\\Program Files",
				"Git",
				"bin",
				"bash.exe",
			),
			path.join(
				process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
				"Git",
				"bin",
				"bash.exe",
			),
			path.join(
				process.env.LocalAppData || "",
				"Programs",
				"Git",
				"bin",
				"bash.exe",
			),
		];

		for (const cand of candidates) {
			if (cand && fs.existsSync(cand)) {
				foundPath = cand;
				break;
			}
		}

		if (!foundPath) {
			const whereRes = await exec("where", ["bash.exe"]);
			if (whereRes.code === 0 && whereRes.stdout) {
				const lines = whereRes.stdout.split(/\r?\n/).map((l) => l.trim());
				for (const line of lines) {
					const norm = line.toLowerCase();
					// Excluir WSL bash de System32 (incompatible con el agente)
					if (/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(norm)) {
						continue;
					}
					foundPath = line;
					break;
				}
			}
		}

		if (foundPath) {
			const vRes = await exec(foundPath, ["--version"]);
			if (vRes.code === 0) {
				installed = true;
				const vMatch = vRes.stdout.match(/version\s+([^\s]+)/i);
				version = vMatch ? vMatch[1] : "Git Bash detectado";
				notes = `Ruta: ${foundPath}`;
			}
		} else {
			notes = "WSL bash no es compatible. Se requiere Git Bash.";
		}
	} else {
		// Unix / macOS
		const res = await exec("bash", ["--version"]);
		if (res.code === 0) {
			installed = true;
			const vMatch = res.stdout.match(/version\s+([^\s]+)/i);
			version = vMatch ? vMatch[1] : "Bash estándar";
		}
	}

	return {
		id: "bash",
		name: "Git Bash Shell",
		category: "core",
		installed,
		version,
		path: foundPath,
		notes,
		description: "Intérprete de comandos y ejecución de herramientas del agente.",
		usedBy: "Core (Tool bash, Subagents)",
		installGuides: {
			win32: {
				command: "winget install --id Git.Git -e --source winget",
				guide:
					"Git for Windows incluye Git Bash. El bash de WSL está descartado por diseño.",
				url: "https://gitforwindows.org/",
			},
			darwin: {
				command: "# Ya incluido en macOS (/bin/bash)",
				guide: "macOS incluye bash por defecto en /bin/bash.",
			},
			linux: {
				command: "sudo apt install -y bash",
				guide:
					"Prácticamente todas las distribuciones Linux incluyen bash por defecto.",
			},
		},
	};
}

export async function checkNodeNpm(exec: ExecFn): Promise<DependencyStatus> {
	const [nodeRes, npmRes] = await Promise.all([
		exec("node", ["-v"]),
		exec("npm", ["-v"]),
	]);

	const nodeOk = nodeRes.code === 0 && /^v\d+/i.test(nodeRes.stdout);
	const npmOk = npmRes.code === 0 && /\d+\.\d+/i.test(npmRes.stdout);
	const installed = nodeOk && npmOk;

	let version: string | undefined;
	if (installed) {
		version = `Node ${nodeRes.stdout} / npm v${npmRes.stdout}`;
	} else if (nodeOk) {
		version = `Node ${nodeRes.stdout} (npm no encontrado)`;
	} else if (npmOk) {
		version = `npm v${npmRes.stdout} (node no encontrado)`;
	}

	return {
		id: "node_npm",
		name: "Node.js & npm",
		category: "extension",
		installed,
		version,
		description:
			"Motor JavaScript y gestor de paquetes para instalar módulos bajo demanda.",
		usedBy: "Tab Index (búsqueda semántica) y Base de Conocimiento (frida-learn)",
		notes: installed
			? undefined
			: "Requerido si usas el Tab Index para indexación semántica local.",
		installGuides: {
			win32: {
				command: "winget install OpenJS.NodeJS.LTS",
				guide: "Instala Node.js LTS que incluye automáticamente el comando npm.",
				url: "https://nodejs.org/en/download/",
			},
			darwin: {
				command: "brew install node",
				guide: "Instala Node.js LTS vía Homebrew o mediante nvm.",
				url: "https://nodejs.org/en/download/",
			},
			linux: {
				command: "sudo apt update && sudo apt install -y nodejs npm",
				guide:
					"O bien instala la versión LTS recomendada usando NVM: 'nvm install --lts'.",
				url: "https://nodejs.org/en/download/",
			},
		},
	};
}

export async function checkGh(exec: ExecFn): Promise<DependencyStatus> {
	const res = await exec("gh", ["--version"]);
	const installed =
		res.code === 0 && res.stdout.toLowerCase().includes("gh version");
	const vMatch = res.stdout.match(/gh version\s+([^\s]+)/i);
	const version = vMatch ? `v${vMatch[1]}` : installed ? "Instalado" : undefined;
	let notes: string | undefined;

	if (installed) {
		const authRes = await exec("gh", ["auth", "status"]);
		const isAuthed =
			authRes.code === 0 || authRes.stdout.includes("Logged in to");
		if (isAuthed) {
			notes = "Autenticado en GitHub";
		} else {
			notes = "No autenticado (ejecuta 'gh auth login' para vincular tu cuenta)";
		}
	}

	return {
		id: "gh",
		name: "GitHub CLI (gh)",
		category: "extension",
		installed,
		version,
		notes,
		description:
			"Gestión de issues, pull requests y sincronización de tareas AIDD.",
		usedBy: "Gestión de issues (AGENTS.md), Flujos AIDD, supi-web",
		installGuides: {
			win32: {
				command: "winget install --id GitHub.cli",
				guide: "Tras instalar, ejecuta 'gh auth login' en tu terminal.",
				url: "https://cli.github.com/",
			},
			darwin: {
				command: "brew install gh",
				guide: "Tras instalar, ejecuta 'gh auth login' en tu terminal.",
				url: "https://cli.github.com/",
			},
			linux: {
				command: "sudo apt install -y gh",
				guide:
					"En Fedora: 'sudo dnf install gh'; en Arch: 'sudo pacman -S github-cli'.",
				url: "https://cli.github.com/",
			},
		},
	};
}

export async function checkAgentBrowser(
	exec: ExecFn,
): Promise<DependencyStatus> {
	const res = await exec("agent-browser", ["--version"]);
	const installed =
		res.code === 0 &&
		(/\d+\.\d+/i.test(res.stdout) || res.stdout.includes("agent-browser"));
	const version = installed ? res.stdout : undefined;

	return {
		id: "agent_browser",
		name: "agent-browser (Vercel Labs)",
		category: "optional",
		installed,
		version,
		description:
			"Automatización de navegador real para interacción web, lectura y screenshots.",
		usedBy: "Tool agent_browser (Automatización de navegador opt-in)",
		notes: installed
			? undefined
			: "Opcional: solo se requiere si habilitas la tool 'agent_browser'.",
		installGuides: {
			win32: {
				command: "npm install -g agent-browser",
				guide: "Requiere Node.js previo. Instala el CLI de navegador globalmente.",
				url: "https://www.npmjs.com/package/agent-browser",
			},
			darwin: {
				command: "npm install -g agent-browser",
				guide: "Requiere Node.js previo. Instala el CLI de navegador globalmente.",
				url: "https://www.npmjs.com/package/agent-browser",
			},
			linux: {
				command: "npm install -g agent-browser",
				guide: "Requiere Node.js previo. Instala el CLI de navegador globalmente.",
				url: "https://www.npmjs.com/package/agent-browser",
			},
		},
	};
}

export async function checkDocker(exec: ExecFn): Promise<DependencyStatus> {
	const res = await exec("docker", ["--version"]);
	const installed =
		res.code === 0 && res.stdout.toLowerCase().includes("docker version");
	const vMatch = res.stdout.match(/Docker version\s+([^\s,]+)/i);
	const version = vMatch ? `v${vMatch[1]}` : installed ? res.stdout : undefined;
	let notes: string | undefined;

	if (installed) {
		const infoRes = await exec("docker", ["info"]);
		if (infoRes.code === 0) {
			notes = "Daemon activo y listo";
		} else {
			notes = "Daemon detenido (inicia Docker Desktop)";
		}
	} else {
		notes = "Opcional: solo se requiere si ejecutas sandboxes aislados.";
	}

	return {
		id: "docker",
		name: "Docker Desktop / Engine",
		category: "optional",
		installed,
		version,
		notes,
		description:
			"Contenedores para ejecución aislada y segura de comandos del agente.",
		usedBy: "Sandboxes aislados (frida-sandboxes)",
		installGuides: {
			win32: {
				command: "winget install Docker.DockerDesktop",
				guide: "Requiere soporte para WSL2 o Hyper-V en Windows.",
				url: "https://www.docker.com/products/docker-desktop/",
			},
			darwin: {
				command: "brew install --cask docker",
				guide:
					"O descarga el instalador de Docker Desktop para Apple Silicon / Intel.",
				url: "https://www.docker.com/products/docker-desktop/",
			},
			linux: {
				command:
					"sudo apt update && sudo apt install -y docker.io && sudo systemctl enable --now docker",
				guide:
					"Asegúrate de agregar tu usuario al grupo docker: 'sudo usermod -aG docker $USER'.",
				url: "https://docs.docker.com/engine/install/",
			},
		},
	};
}

export async function checkOllama(exec: ExecFn): Promise<DependencyStatus> {
	// `ollama --version` imprime warnings al stderr/stdout si el daemon está
	// caído pero el CLI existe — la versión aparece como "version is X" o
	// "ollama is version X" según la versión del CLI.
	const res = await exec("ollama", ["--version"]);
	const out = `${res.stdout}\n${res.stderr}`;
	const installed = res.code === 0 && /ollama|version/i.test(out);
	const vMatch =
		out.match(/version is\s+([^\s]+)/i) ?? out.match(/is version\s+([^\s]+)/i);
	const version = vMatch ? `v${vMatch[1]}` : undefined;

	let notes: string | undefined;
	if (installed) {
		const list = await exec("ollama", ["list"]);
		if (list.code === 0) {
			const models = list.stdout
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l && !/^name(\s|$)/i.test(l))
				.map((l) => l.split(/\s{2,}|\t/)[0]);
			// Catálogo de modelos de embedding Ollama que acepta el upstream
			// (EMBEDDING_MODELS.ollama de open-codebase-index): default
			// nomic-embed-text. Coincidencia exacta o con tag (:latest).
			const EMBED_MODELS = ["nomic-embed-text", "mxbai-embed-large"];
			const stripTag = (m: string) => m.replace(/:latest$/, "");
			const embed = models.find((m) => EMBED_MODELS.includes(stripTag(m)));
			if (embed) {
				notes = `Daemon activo y listo (${models.length} ${models.length === 1 ? "modelo" : "modelos"}, incluye ${embed})`;
			} else {
				// Daemon arriba pero sin modelo de embeddings: la indexación con
				// motor Ollama fallará al vectorizar — advertencia accionable.
				notes = `Daemon activo pero falta el modelo de embeddings: ejecuta 'ollama pull nomic-embed-text' (${models.length} ${models.length === 1 ? "modelo" : "modelos"} instalados, ninguno de embeddings)`;
			}
		} else {
			notes = "Daemon detenido (inicia la app de Ollama o ejecuta 'ollama serve')";
		}
	} else {
		notes =
			"Opcional: embeddings 100% locales para el índice de código; sin Ollama el motor Auto usa proveedores en la nube (Copilot/OpenAI).";
	}

	return {
		id: "ollama",
		name: "Ollama",
		category: "optional",
		installed,
		version,
		notes,
		description:
			"Servidor local de modelos: embeddings locales (privados) para el índice de código.",
		usedBy: "Índice de código — motor de embeddings local (nomic-embed-text)",
		installGuides: {
			win32: {
				command: "winget install Ollama.Ollama",
				guide:
					"Tras instalar, ejecuta 'ollama pull nomic-embed-text' para el modelo de embeddings.",
				url: "https://ollama.com/download",
			},
			darwin: {
				command: "brew install --cask ollama",
				guide:
					"O descarga la app desde ollama.com; luego 'ollama pull nomic-embed-text'.",
				url: "https://ollama.com/download",
			},
			linux: {
				command: "curl -fsSL https://ollama.com/install.sh | sh",
				guide:
					"Tras instalar, habilita el servicio y ejecuta 'ollama pull nomic-embed-text'.",
				url: "https://ollama.com/download",
			},
		},
	};
}

export async function checkEnvironment(deps?: {
	exec?: ExecFn;
	platform?: NodeJS.Platform;
	arch?: string;
}): Promise<EnvironmentReport> {
	const exec = deps?.exec ?? defaultExec;
	const platform = deps?.platform ?? process.platform;
	const arch = deps?.arch ?? os.arch();

	const [git, bash, nodeNpm, gh, agentBrowser, docker, ollama] =
		await Promise.all([
			checkGit(exec),
			checkBash(exec, platform),
			checkNodeNpm(exec),
			checkGh(exec),
			checkAgentBrowser(exec),
			checkDocker(exec),
			checkOllama(exec),
		]);

	const dependencies = [git, bash, nodeNpm, gh, agentBrowser, docker, ollama];
	const readyCount = dependencies.filter((d) => d.installed).length;
	const coreReady = git.installed && bash.installed;

	return {
		platform: normalizePlatform(platform),
		platformLabel: getPlatformLabel(platform),
		arch,
		checkedAt: Date.now(),
		readyCount,
		totalCount: dependencies.length,
		coreReady,
		dependencies,
	};
}
