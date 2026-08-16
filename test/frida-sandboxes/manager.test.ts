/**
 * frida-sandboxes — tests del SandboxManager (issue #35, ADR-0047).
 *
 * Orquestación contra un DockerClient falso: create (create+start+cp del
 * proyecto), exec/pause/resume/destroy, changes vía git status
 * in-container, mergeFile (docker cp OUT con guard de ruta), persistencia
 * del registry y auto-nombres.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DockerClient, DockerExecResult } from "../../src/tools/frida-sandboxes/docker";
import { SandboxManager, loadRegistry } from "../../src/tools/frida-sandboxes/manager";

let agentDir: string;
let projectDir: string;

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sbx-agent-"));
	projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sbx-proj-"));
	fs.writeFileSync(path.join(projectDir, "a.txt"), "hola");
});

afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
	fs.rmSync(projectDir, { recursive: true, force: true });
});

/** Fake: git status devuelve 2 archivos modificados. */
function fakeClient(): DockerClient & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		async exec(args) {
			calls.push(args);
			if (args[0] === "exec" && args.includes("status")) {
				return {
					stdout: " M src/app.ts\n?? new.ts\n",
					stderr: "",
					code: 0,
					killed: false,
				} satisfies DockerExecResult;
			}
			return {
				stdout: "",
				stderr: "",
				code: 0,
				killed: false,
			} satisfies DockerExecResult;
		},
	};
}

function make(client: DockerClient): SandboxManager {
	return new SandboxManager(client, agentDir);
}

describe("SandboxManager", () => {
	it("create: docker create+start+cp del proyecto y persiste el registro", async () => {
		const client = fakeClient();
		const m = make(client);
		const rec = await m.create({
			projectDir,
			createdBy: "test",
		});
		expect(rec.name).toBe("sbx-1");
		expect(rec.state).toBe("active");
		// argv: create → start → cp
		expect(client.calls[0][0]).toBe("create");
		expect(client.calls[1]).toEqual(["start", "frida-sbx-sbx-1"]);
		expect(client.calls[2][0]).toBe("cp");
		// persistido
		const reg = loadRegistry(agentDir);
		expect(reg.sandboxes).toHaveLength(1);
		expect(reg.sandboxes[0].name).toBe("sbx-1");
	});

	it("autoName avanza sin reusar índices", async () => {
		const m = make(fakeClient());
		await m.create({ projectDir, createdBy: "t" });
		await m.create({ projectDir, createdBy: "t" });
		expect(m.list().map((s) => s.name)).toEqual(["sbx-1", "sbx-2"]);
	});

	it("create con nombre duplicado → error", async () => {
		const m = make(fakeClient());
		await m.create({ name: "audit", projectDir, createdBy: "t" });
		await expect(
			m.create({ name: "audit", projectDir, createdBy: "t" }),
		).rejects.toThrow("Ya existe");
	});

	it("pause/resume marcan estado y guardan", async () => {
		const m = make(fakeClient());
		await m.create({ projectDir, createdBy: "t" });
		await m.pause("sbx-1");
		expect(m.get("sbx-1")?.state).toBe("paused");
		// exec en pausado → error honesto
		await expect(m.exec("sbx-1", ["ls"])).rejects.toThrow("pausado");
		await m.resume("sbx-1");
		expect(m.get("sbx-1")?.state).toBe("active");
	});

	it("destroy quita del listado activo", async () => {
		const m = make(fakeClient());
		await m.create({ projectDir, createdBy: "t" });
		await m.destroy("sbx-1");
		expect(m.list()).toHaveLength(0);
	});

	it("changes: parsea git status --porcelain", async () => {
		const m = make(fakeClient());
		await m.create({ projectDir, createdBy: "t" });
		const files = await m.changes("sbx-1");
		expect(files).toEqual(["M src/app.ts", "?? new.ts"]);
	});

	it("mergeFile: cp OUT con cp del container y ruta host correcta", async () => {
		const client = fakeClient();
		const m = make(client);
		await m.create({ projectDir, createdBy: "t" });
		const dest = await m.mergeFile("sbx-1", "src/app.ts");
		expect(dest).toBe(path.join(projectDir, "src/app.ts"));
		const last = client.calls.at(-1)!;
		expect(last[0]).toBe("cp");
		expect(last[1]).toBe("frida-sbx-sbx-1:/workspace/src/app.ts");
	});

	it("mergeFile: rechaza rutas que escapan del workdir (../, absolutas)", async () => {
		const m = make(fakeClient());
		await m.create({ projectDir, createdBy: "t" });
		await expect(m.mergeFile("sbx-1", "../etc/passwd")).rejects.toThrow(
			"inválida",
		);
		await expect(m.mergeFile("sbx-1", "/etc/passwd")).rejects.toThrow(
			"inválida",
		);
	});

	it("sandbox inexistente → error honesto", async () => {
		const m = make(fakeClient());
		await expect(m.exec("nada", ["ls"])).rejects.toThrow("no existe");
		await expect(m.destroy("nada")).rejects.toThrow("no existe");
	});
});
