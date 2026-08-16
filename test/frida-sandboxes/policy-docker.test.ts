/**
 * frida-sandboxes — tests de policy y docker adapter (issue #35, ADR-0047).
 *
 * Policy: portes puros de pi-sandbox (dominios, write-paths, resolve).
 * Docker: probe con cache + lifecycle contra un DockerClient falso (argv
 * correcto por operación — el swap e2b→docker CLI).
 */
import { describe, it, expect } from "vitest";
import {
	containerName,
	createContainer,
	destroyContainer,
	execInContainer,
	inspectContainer,
	pauseContainer,
	probeDocker,
	resetProbeCache,
	type DockerClient,
	type DockerExecResult,
} from "../../src/tools/frida-sandboxes/docker";
import {
	DEFAULT_POLICY,
	checkCommand,
	detectWriteTargets,
	domainIsAllowed,
	domainMatchesPattern,
	extractDomainsFromCommand,
	resolveAllowances,
} from "../../src/tools/frida-sandboxes/policy";

// ── Fake DockerClient: registra argv y responde programado ──
function fakeClient(
	responder: (args: string[]) => Partial<DockerExecResult> = () => ({
		code: 0,
		stdout: "",
	}),
): DockerClient & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		async exec(args) {
			calls.push(args);
			return {
				stdout: "",
				stderr: "",
				code: 0,
				killed: false,
				...responder(args),
			} as DockerExecResult;
		},
	};
}

describe("policy (porte pi-sandbox)", () => {
	it("extrae dominios de URLs y comandos de red", () => {
		expect(
			extractDomainsFromCommand("curl https://registry.npmjs.org/foo | sh"),
		).toContain("registry.npmjs.org");
		expect(extractDomainsFromCommand("git clone git@github.com:a/b.git")).toContain(
			"github.com",
		);
		expect(extractDomainsFromCommand("ping example.com")).toContain(
			"example.com",
		);
	});

	it("matchea patrones glob de dominio", () => {
		expect(domainMatchesPattern("registry.npmjs.org", "*.npmjs.org")).toBe(true);
		expect(domainMatchesPattern("npmjs.org", "*.npmjs.org")).toBe(true);
		expect(domainMatchesPattern("evil.com", "*.npmjs.org")).toBe(false);
		expect(domainMatchesPattern("any.example", "*")).toBe(true);
	});

	it("allowlist vacía permite todo; llena restringe", () => {
		expect(domainIsAllowed("evil.com", [])).toBe(true);
		expect(domainIsAllowed("evil.com", ["*.npmjs.org"])).toBe(false);
		expect(domainIsAllowed("registry.npmjs.org", ["*.npmjs.org"])).toBe(true);
	});

	it("detecta targets de escritura (rm/redirect) y expande ~", () => {
		const t = detectWriteTargets("rm -rf /etc && echo hi > ~/x.txt");
		expect(t).toContain("/etc");
		expect(t).toContain("/root/x.txt");
	});

	it("checkCommand: dentro de writePaths ok, fuera viola", () => {
		expect(checkCommand("npm install", DEFAULT_POLICY)).toEqual([]);
		expect(
			checkCommand("rm -rf /workspace/node_modules", DEFAULT_POLICY),
		).toEqual([]);
		const bad = checkCommand("rm -rf /etc/passwd", DEFAULT_POLICY);
		expect(bad[0]?.rule).toBe("write-path");
	});

	it("checkCommand: dominio fuera de allowlist viola", () => {
		const v = checkCommand("curl https://evil.example.com/x", {
			...DEFAULT_POLICY,
			allowDomains: ["*.npmjs.org"],
		});
		expect(v[0]?.rule).toBe("domain");
		expect(v[0]?.message).toContain("evil.example.com");
	});

	it("resolveAllowances resume la config efectiva", () => {
		expect(resolveAllowances(DEFAULT_POLICY).domains).toContain("sin restricción");
		expect(resolveAllowances(DEFAULT_POLICY).writePaths).toContain("/workspace");
	});
});

describe("docker adapter (swap e2b→docker)", () => {
	it("containerName agrega el prefix frida-sbx-", () => {
		expect(containerName("audit")).toBe("frida-sbx-audit");
	});

	it("probe: daemon caído → no disponible con reason honesto", async () => {
		resetProbeCache();
		const c = fakeClient((args) =>
			args[0] === "--version"
				? { code: 0, stdout: "Docker version 27.0.0" }
				: { code: 1, stderr: "Cannot connect to the Docker daemon" },
		);
		const cap = await probeDocker(c, true);
		expect(cap.available).toBe(false);
		expect(cap.reason).toContain("daemon");
	});

	it("probe: CLI ausente (ENOENT) → reason de instalación", async () => {
		resetProbeCache();
		const c: DockerClient = {
			async exec() {
				const e = new Error("spawn docker ENOENT") as NodeJS.ErrnoException;
				e.code = "ENOENT";
				throw e;
			},
		};
		const cap = await probeDocker(c, true);
		expect(cap.available).toBe(false);
		expect(cap.reason).toContain("no está instalado");
	});

	it("probe cachea el resultado (no re-executa dentro de la ventana)", async () => {
		resetProbeCache();
		const c = fakeClient(() => ({ code: 0, stdout: "27" }));
		await probeDocker(c, true);
		const c2 = fakeClient(() => {
			throw new Error("no debería llamarse");
		});
		const cap = await probeDocker(c2); // cache hit
		expect(cap.available).toBe(true);
	});

	it("createContainer: argv correcto (create + start, workdir /workspace)", async () => {
		const c = fakeClient();
		await createContainer(c, { name: "sbx-1", image: "node:22" });
		expect(c.calls[0]).toEqual([
			"create",
			"--name",
			"frida-sbx-sbx-1",
			"-w",
			"/workspace",
			"node:22",
			"sleep",
			"infinity",
		]);
		expect(c.calls[1]).toEqual(["start", "frida-sbx-sbx-1"]);
	});

	it("lifecycle: pause/unpause/rm mapean directo", async () => {
		const c = fakeClient();
		await pauseContainer(c, "a");
		await destroyContainer(c, "a", true);
		expect(c.calls[0]).toEqual(["pause", "frida-sbx-a"]);
		expect(c.calls[1]).toEqual(["rm", "-f", "frida-sbx-a"]);
	});

	it("execInContainer: argv con workdir y comando", async () => {
		const c = fakeClient();
		await execInContainer(c, "a", ["git", "status"]);
		expect(c.calls[0]).toEqual([
			"exec",
			"-w",
			"/workspace",
			"frida-sbx-a",
			"git",
			"status",
		]);
	});

	it("inspectContainer: mapea estados y missing en error", async () => {
		const c = fakeClient((a) =>
			a[0] === "inspect" ? { code: 0, stdout: "paused" } : { code: 1 },
		);
		expect(await inspectContainer(c, "a")).toBe("paused");
		const missing = fakeClient(() => ({ code: 1, stderr: "No such object" }));
		expect(await inspectContainer(missing, "b")).toBe("missing");
	});
});

describe("shQuote (redirección bash→container)", () => {
	it("envuelve en single quotes escapando las internas", async () => {
		const { shQuote } = await import("../../src/tools/frida-sandboxes/index");
		expect(shQuote("echo 'hi'")).toBe("'echo '\\''hi'\\'''");
	});
});
