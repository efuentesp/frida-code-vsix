// Tests del wrapper frida-hermes-memory: factory passthrough contra un
// paquete upstream FAKE materializado en un agentDir temporal y cargado con
// jiti REAL (mismo mecanismo que producción). Cubre:
//   - PI_CODING_AGENT_DIR se setea ANTES de cargar el módulo (AGENT_ROOT es
//     const de módulo en el upstream).
//   - La factory del fake corre contra el ExtensionAPI real del wrapper:
//     registerTool/registerCommand/on fluyen (passthrough, no captura).
//   - El mecanismo de aliases de peer-deps resuelve pi-ai REAL (nested del
//     repo) desde el entry fake (StringEnum ejecutable).
//   - Paquete ausente: tool guía + instalación background inyectada +
//     onStateChange (installing → installed / error).
//   - Entry corrupto (sin factory): degradación con tool guía, sin crash.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createFridaHermesMemory,
	type HermesMemoryState,
} from "../../src/tools/frida-hermes-memory/index";
import { HERMES_MEMORY_PIN } from "../../src/tools/frida-hermes-memory/constants";

let agentDir: string;
let prevAgentDirEnv: string | undefined;

/** Stub parcial del ExtensionAPI: solo lo que el wrapper y el upstream fake
 *  usan. Se castea al tipo real en los call sites (el SDK exige ~22 miembros
 *  más que aquí no aplican). */
function fakePi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any>();
	return {
		tools,
		commands,
		events,
		registerTool: (t: any) => tools.set(t.name, t),
		registerCommand: (c: any) => commands.set(c.name, c),
		on: (event: string, h: any) => {
			events.set(event, h);
			return () => events.delete(event);
		},
	};
}

/** Cast del stub al tipo del parámetro de la factory. */
function asApi(pi: ReturnType<typeof fakePi>): ExtensionAPI {
	return pi as unknown as ExtensionAPI;
}

/** Materializa un paquete pi-hermes-memory fake al pin en <agentDir>/npm.
 *  `imports` permite encabezado de imports ESTÁTICOS (los que jiti resuelve
 *  con alias — el mecanismo que usa el upstream real). */
function writeFakeUpstream(factoryBody: string, imports = ""): void {
	const pkgRoot = path.join(agentDir, "npm", "node_modules", "pi-hermes-memory");
	fs.mkdirSync(path.join(pkgRoot, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		JSON.stringify({ name: "pi-hermes-memory", version: HERMES_MEMORY_PIN }),
	);
	fs.writeFileSync(
		path.join(pkgRoot, "src", "index.ts"),
		`${imports}\nexport default function (pi: any) {\n${factoryBody}\n}\n`,
	);
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-hmw-"));
	prevAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
	delete process.env.PI_CODING_AGENT_DIR;
});
afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
	if (prevAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = prevAgentDirEnv;
});

describe("frida-hermes-memory wrapper", () => {
	it("paquete instalado: corre la factory upstream vía jiti (passthrough completo)", async () => {
		writeFakeUpstream(`
  pi.registerTool({ name: "memory_write", execute: async () => "ok" });
  pi.registerCommand({ name: "memory-insights", handler: () => {} });
  pi.on("before_agent_start", async () => ({ context: "MEM" }));
  (globalThis as any).__hermesEnv = process.env.PI_CODING_AGENT_DIR;
`);
		const pi = fakePi();
		await createFridaHermesMemory({ agentDir, distDir: "/nonexistent/dist" })(
			asApi(pi),
		);
		expect([...pi.tools.keys()]).toContain("memory_write");
		expect([...pi.commands.keys()]).toContain("memory-insights");
		expect(pi.events.has("before_agent_start")).toBe(true);
		// El env se seteó ANTES de que el módulo del fake se evaluara.
		expect((globalThis as any).__hermesEnv).toBe(path.resolve(agentDir));
		delete (globalThis as any).__hermesEnv;
		// La inyección de contexto (Paso 0) fluye por el passthrough.
		await expect(pi.events.get("before_agent_start")()).resolves.toEqual({
			context: "MEM",
		});
	});

	it("los aliases resuelven pi-ai real (peer-dep) desde el entry del fake", async () => {
		// Import ESTÁTICO — como el upstream real (jiti aplica alias aquí; el
		// import() dinámico NO pasa por el alias map del jiti padre).
		writeFakeUpstream(
			`\n  pi.registerTool({\n    name: "memory_peer_probe",\n    execute: async () => (typeof StringEnum === "function" ? "peer-ok" : "peer-bad"),\n  });`,
			'import { StringEnum } from "@earendil-works/pi-ai";',
		);
		const pi = fakePi();
		// distDir dentro del repo → aliases apuntan al node_modules real (nested).
		await createFridaHermesMemory({ agentDir, distDir: path.resolve("dist") })(
			asApi(pi),
		);
		await expect(pi.tools.get("memory_peer_probe").execute()).resolves.toBe(
			"peer-ok",
		);
	});

	it("paquete ausente: tool guía + instalación background + estados", async () => {
		const states: HermesMemoryState[] = [];
		let installCalls = 0;
		const pi = fakePi();
		await createFridaHermesMemory({
			agentDir,
			distDir: "/nonexistent/dist",
			onStateChange: (s) => states.push(s),
			deps: {
				ensureInstalled: async () => {
					installCalls++;
					return { alreadyInstalled: false };
				},
			},
		})(asApi(pi));
		// Tool guía registrada con la guía de instalación.
		const guide = pi.tools.get("memory");
		expect(guide).toBeTruthy();
		const res = await guide.execute();
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("npm install");
		expect(res.content[0].text).toContain(HERMES_MEMORY_PIN);
		// Instalación disparada en background (fire-and-forget → await microtask).
		await new Promise((r) => setTimeout(r, 10));
		expect(installCalls).toBe(1);
		expect(states.at(-1)).toEqual({
			installed: true,
			version: HERMES_MEMORY_PIN,
		});
		expect(states[0]).toEqual({ installed: false, installing: true });
	});

	it("instalación background fallida: estado error sin tumba la sesión", async () => {
		const states: HermesMemoryState[] = [];
		const pi = fakePi();
		await createFridaHermesMemory({
			agentDir,
			distDir: "/nonexistent/dist",
			onStateChange: (s) => states.push(s),
			deps: {
				ensureInstalled: async () => {
					throw new Error("npm no está disponible");
				},
			},
		})(asApi(pi));
		await new Promise((r) => setTimeout(r, 10));
		expect(states.at(-1)?.installed).toBe(false);
		expect(states.at(-1)?.error).toContain("npm no está disponible");
		// La tool guía sigue registrada (degradación D6).
		expect(pi.tools.get("memory")).toBeTruthy();
	});

	it("entry sin factory: degradación con tool guía de reparación, sin crash", async () => {
		const pkgRoot = path.join(
			agentDir,
			"npm",
			"node_modules",
			"pi-hermes-memory",
		);
		fs.mkdirSync(path.join(pkgRoot, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(pkgRoot, "package.json"),
			JSON.stringify({ name: "pi-hermes-memory", version: HERMES_MEMORY_PIN }),
		);
		fs.writeFileSync(
			path.join(pkgRoot, "src", "index.ts"),
			"export const x = 1;\n",
		);
		const pi = fakePi();
		const states: HermesMemoryState[] = [];
		await createFridaHermesMemory({
			agentDir,
			distDir: "/nonexistent/dist",
			onStateChange: (s) => states.push(s),
		})(asApi(pi));
		// Tool guía de reparación registrada (no la de install — otra guía).
		const guide = pi.tools.get("memory");
		expect(guide).toBeTruthy();
		const res = await guide.execute();
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("no se pudo cargar");
		expect(states.at(-1)?.error).toBeTruthy();
	});
});
