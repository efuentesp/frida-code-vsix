import { describe, expect, it } from "vitest";
import {
	checkAgentBrowser,
	checkBash,
	checkDocker,
	checkEnvironment,
	checkGh,
	checkGit,
	checkNodeNpm,
	checkOllama,
	type ExecFn,
} from "../src/environment/doctor";

describe("environment/doctor · detección de dependencias", () => {
	it("checkGit detecta versión correctamente", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "git") {
				return { stdout: "git version 2.44.0.windows.1", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "not found", code: -1 };
		};

		const res = await checkGit(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toBe("2.44.0.windows.1");
		expect(res.category).toBe("core");
		expect(res.installGuides.win32.command).toContain("winget install");
	});

	it("checkGit reporta no instalado ante exit code no-cero", async () => {
		const mockExec: ExecFn = async () => ({
			stdout: "",
			stderr: "command not found: git",
			code: 127,
		});

		const res = await checkGit(mockExec);
		expect(res.installed).toBe(false);
		expect(res.version).toBeUndefined();
	});

	it("checkBash en Unix detecta bash estándar", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "bash") {
				return {
					stdout: "GNU bash, version 5.2.26(1)-release",
					stderr: "",
					code: 0,
				};
			}
			return { stdout: "", stderr: "not found", code: -1 };
		};

		const res = await checkBash(mockExec, "darwin");
		expect(res.installed).toBe(true);
		expect(res.version).toBe("5.2.26(1)-release");
		expect(res.category).toBe("core");
	});

	it("checkBash en Windows rechaza bash de WSL System32", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "where" && args[0] === "bash.exe") {
				return {
					stdout: "C:\\Windows\\System32\\bash.exe",
					stderr: "",
					code: 0,
				};
			}
			return { stdout: "", stderr: "not found", code: -1 };
		};

		const res = await checkBash(mockExec, "win32");
		expect(res.installed).toBe(false);
		expect(res.notes).toContain("WSL bash no es compatible");
	});

	it("checkNodeNpm detecta Node y npm juntos", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "node") return { stdout: "v20.11.0", stderr: "", code: 0 };
			if (cmd === "npm") return { stdout: "10.2.4", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: -1 };
		};

		const res = await checkNodeNpm(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toContain("Node v20.11.0 / npm v10.2.4");
		expect(res.category).toBe("extension");
	});

	it("checkNodeNpm falla si npm falta aunque node esté", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "node") return { stdout: "v20.11.0", stderr: "", code: 0 };
			return { stdout: "", stderr: "not found", code: 127 };
		};

		const res = await checkNodeNpm(mockExec);
		expect(res.installed).toBe(false);
		expect(res.version).toContain("npm no encontrado");
	});

	it("checkGh detecta versión y autenticación", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "gh" && args[0] === "--version") {
				return { stdout: "gh version 2.45.0 (2024-03-04)", stderr: "", code: 0 };
			}
			if (cmd === "gh" && args[0] === "auth") {
				return {
					stdout: "Logged in to github.com as testuser",
					stderr: "",
					code: 0,
				};
			}
			return { stdout: "", stderr: "", code: -1 };
		};

		const res = await checkGh(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toBe("v2.45.0");
		expect(res.notes).toContain("Autenticado");
	});

	it("checkAgentBrowser detecta binario opt-in", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "agent-browser") {
				return { stdout: "agent-browser 0.1.0", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 127 };
		};

		const res = await checkAgentBrowser(mockExec);
		expect(res.installed).toBe(true);
		expect(res.category).toBe("optional");
	});

	it("checkDocker detecta daemon activo", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "docker" && args[0] === "--version") {
				return {
					stdout: "Docker version 26.0.0, build 2ae903e",
					stderr: "",
					code: 0,
				};
			}
			if (cmd === "docker" && args[0] === "info") {
				return { stdout: "Containers: 2\n Running: 1", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: -1 };
		};

		const res = await checkDocker(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toBe("v26.0.0");
		expect(res.notes).toContain("Daemon activo");
	});

	it("checkEnvironment agrega el reporte global correctamente", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "git")
				return { stdout: "git version 2.44.0", stderr: "", code: 0 };
			if (cmd === "where" && args[0] === "bash.exe") {
				return {
					stdout: "C:\\Program Files\\Git\\bin\\bash.exe",
					stderr: "",
					code: 0,
				};
			}
			if (cmd === "C:\\Program Files\\Git\\bin\\bash.exe") {
				return { stdout: "GNU bash, version 5.2.0", stderr: "", code: 0 };
			}
			if (cmd === "bash") return { stdout: "version 5.2.0", stderr: "", code: 0 };
			if (cmd === "node") return { stdout: "v20.10.0", stderr: "", code: 0 };
			if (cmd === "npm") return { stdout: "10.1.0", stderr: "", code: 0 };
			if (cmd === "gh")
				return { stdout: "gh version 2.40.0", stderr: "", code: 0 };
			return { stdout: "", stderr: "not found", code: 127 };
		};

		const report = await checkEnvironment({
			exec: mockExec,
			platform: "win32",
			arch: "x64",
		});

		expect(report.platform).toBe("win32");
		expect(report.platformLabel).toBe("Windows");
		expect(report.arch).toBe("x64");
		expect(report.totalCount).toBe(7);
		expect(report.readyCount).toBe(4);
		expect(report.coreReady).toBe(true);
	});

	it("#110 — checkOllama: instalado con daemon activo", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "ollama" && args[0] === "--version") {
				return {
					stdout:
						"Warning: could not connect to a running Ollama instance\nWarning: client version is 0.30.10",
					stderr: "",
					code: 0,
				};
			}
			if (cmd === "ollama" && args[0] === "list") {
				return { stdout: "NAME  ID  SIZE\nnomic-embed-text  abc123  274 MB", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 127 };
		};

		const res = await checkOllama(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toBe("v0.30.10");
		expect(res.category).toBe("optional");
		expect(res.notes).toContain("Daemon activo");
		expect(res.notes).toContain("nomic-embed-text");
	});

	it("#110 — checkOllama: instalado sin daemon", async () => {
		const mockExec: ExecFn = async (cmd, args) => {
			if (cmd === "ollama" && args[0] === "--version") {
				return { stdout: "ollama is version 0.12.6", stderr: "", code: 0 };
			}
			if (cmd === "ollama" && args[0] === "list") {
				return {
					stdout: "",
					stderr: "could not connect to a running Ollama server",
					code: 1,
				};
			}
			return { stdout: "", stderr: "", code: 127 };
		};

		const res = await checkOllama(mockExec);
		expect(res.installed).toBe(true);
		expect(res.version).toBe("v0.12.6");
		expect(res.notes).toContain("Daemon detenido");
	});

	it("#110 — checkOllama: no instalado", async () => {
		const mockExec: ExecFn = async () => ({
			stdout: "",
			stderr: "not found",
			code: 127,
		});

		const res = await checkOllama(mockExec);
		expect(res.installed).toBe(false);
		expect(res.notes).toContain("Opcional");
	});

	it("#110 — checkEnvironment incluye ollama (7 deps)", async () => {
		const mockExec: ExecFn = async (cmd) => {
			if (cmd === "git") return { stdout: "git version 2.44.0", stderr: "", code: 0 };
			if (cmd === "bash") return { stdout: "version 5.2.0", stderr: "", code: 0 };
			return { stdout: "", stderr: "not found", code: 127 };
		};
		const report = await checkEnvironment({
			exec: mockExec,
			platform: "darwin",
			arch: "arm64",
		});
		expect(report.totalCount).toBe(7);
		expect(report.dependencies.some((d) => d.id === "ollama")).toBe(true);
	});
});
