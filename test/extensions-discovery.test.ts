// Test de descubrimiento de extensiones externas (Opción B).
//
// Verifica que el cableo de Frida (src/pi-session.ts) hace lo correcto:
//   - GLOBAL:  ~/.frida/extensions/*.ts se descubre vía agentDir (heredado de Pi).
//   - PROYECTO: .frida/extensions/*.ts y subdir/index.ts se descubren vía
//     additionalExtensionPaths, PERO como el loader trata un dir como package source
//     y no expande .ts sueltos, Frida enumera los archivos con
//     listProjectExtensionFiles (loose .ts + subdir/index.ts).
//   - SKILLS de proyecto: .frida/skills/ (directorio) sí funciona directo (loadSkills recursa).
//
// Usa un agentDir TEMPORAL para no tocar el ~/.frida real del usuario.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DefaultResourceLoader,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { listProjectExtensionFiles } from "../src/extension-paths";

// Extensión mínima pero funcional: registra un tool. Si el loader la carga (virtual
// modules + factory) y aparece en getExtensions(), descubrimiento + carga funcionan.
const EXT_SRC = `
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function (pi) {
  pi.registerTool(defineTool({
    name: "ping",
    description: "ping",
    parameters: Type.Object({}),
    async execute() { return { content: [{ type: "text", text: "pong" }] }; },
  }));
}
`;

let tmp: string;
let agentDir: string;
let cwd: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ext-test-"));
	agentDir = path.join(tmp, "frida");
	cwd = path.join(tmp, "proj");
	fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".frida", "extensions"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".frida", "skills"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

function buildLoader() {
	const sm = SettingsManager.create(cwd, agentDir);
	return new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: sm,
		// Mismo cableo que src/pi-session.ts:
		additionalExtensionPaths: listProjectExtensionFiles(
			path.join(cwd, ".frida", "extensions"),
		),
		additionalSkillPaths: [path.join(cwd, ".frida", "skills")],
	});
}

describe("listProjectExtensionFiles (enumeración de Frida)", () => {
	it("lista loose .ts + subdir/index.ts, ignorando otra extensión", () => {
		const dir = path.join(cwd, ".frida", "extensions");
		fs.writeFileSync(path.join(dir, "a.ts"), EXT_SRC);
		fs.writeFileSync(path.join(dir, "b.ts"), EXT_SRC);
		fs.writeFileSync(path.join(dir, "readme.md"), "# no");
		fs.mkdirSync(path.join(dir, "multi"), { recursive: true });
		fs.writeFileSync(path.join(dir, "multi", "index.ts"), EXT_SRC);
		const files = listProjectExtensionFiles(dir).map((f) => path.basename(f));
		expect(files.sort()).toEqual(["a.ts", "b.ts", "index.ts"]);
	});
});

describe("DefaultResourceLoader — descubrimiento (cableo Frida)", () => {
	it("GLOBAL: ~/.frida/extensions/*.ts vía agentDir", async () => {
		fs.writeFileSync(path.join(agentDir, "extensions", "global.ts"), EXT_SRC);
		const loader = buildLoader();
		await loader.reload();
		const paths = loader.getExtensions().extensions.map((e: any) => e.path);
		expect(paths.some((p: string) => p.endsWith("global.ts"))).toBe(true);
	});

	it("PROYECTO: .frida/extensions/*.ts (loose) vía additionalExtensionPaths", async () => {
		fs.writeFileSync(
			path.join(cwd, ".frida", "extensions", "proj.ts"),
			EXT_SRC,
		);
		const loader = buildLoader();
		await loader.reload();
		const paths = loader.getExtensions().extensions.map((e: any) => e.path);
		expect(paths.some((p: string) => p.endsWith("proj.ts"))).toBe(true);
	});

	it("PROYECTO: .frida/extensions/<dir>/index.ts (subdir)", async () => {
		fs.mkdirSync(path.join(cwd, ".frida", "extensions", "bundled"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(cwd, ".frida", "extensions", "bundled", "index.ts"),
			EXT_SRC,
		);
		const loader = buildLoader();
		await loader.reload();
		const paths = loader.getExtensions().extensions.map((e: any) => e.path);
		expect(paths.some((p: string) => p.includes("bundled"))).toBe(true);
	});

	it("PROYECTO skills: .frida/skills/<name>/SKILL.md (directorio) funciona directo", async () => {
		fs.mkdirSync(path.join(cwd, ".frida", "skills", "demo"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(cwd, ".frida", "skills", "demo", "SKILL.md"),
			"---\ndescription: demo skill\n---\n# demo\n",
		);
		const loader = buildLoader();
		await loader.reload();
		const names = loader.getSkills().skills.map((s: any) => s.name);
		expect(names).toContain("demo");
	});

	it("dir de extensiones inexistente: no falla (helper retorna [])", async () => {
		fs.rmSync(path.join(cwd, ".frida", "extensions"), { recursive: true });
		const loader = buildLoader();
		await expect(loader.reload()).resolves.toBeUndefined();
		expect(loader.getExtensions().extensions.map((e: any) => e.path)).toEqual(
			[],
		);
	});
});
