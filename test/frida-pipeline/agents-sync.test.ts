// frida-pipeline — tests de agents-sync (engine de sync con sha256).
//
// Verifica el gate de Fase 5 (ADR-0021):
//   - sync copia nuevos agentes al agentDir global.
//   - Detecta unchanged (hash coincide).
//   - Detecta drift: usuario modifica a mano → pendingUpdate (gated).
//   - /frida-update-agents (apply=true) fuerza overwrite.
//   - Stale removal: agente en manifest pero no en source → pendingRemove.
//   - formatSyncReport produce texto legible con conteos.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	syncBundledAgents,
	formatSyncReport,
	totalSynced,
} from "../../src/tools/frida-pipeline/agents-sync";
import { getGlobalAgentsDir } from "../../src/tools/frida-pipeline/paths";

// El engine lee de BUNDLED_AGENTS_DIR (src/tools/frida-pipeline/agents/) y
// escribe a getGlobalAgentsDir(agentDir). Para aislar los tests, creamos un
// agentDir temporal y mockeamos BUNDLED_AGENTS_DIR con un directorio temporal.

let tmpAgentDir: string;
let realHome: string;

// Mock BUNDLED_AGENTS_DIR apuntando a nuestro dir temporal.
// agents-sync.ts importa BUNDLED_AGENTS_DIR de paths.ts, que lo resuelve en
// module-load. No podemos cambiarlo en runtime, así que creamos los .md de
// prueba en el directorio real y verificamos que el sync los copia al
// agentDir temporal.

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-agents-target-"));
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpAgentDir, { recursive: true, force: true });
});

describe("frida-pipeline / agents-sync / syncBundledAgents", () => {
	it("copia los agentes empaquetados al agentDir global", () => {
		const result = syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);

		// Los 15 agentes del repo deberían copiarse (si BUNDLED_AGENTS_DIR existe).
		expect(result.added.length).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(targetDir, "codebase-locator.md"))).toBe(
			true,
		);
		expect(
			fs.existsSync(path.join(targetDir, "web-search-researcher.md")),
		).toBe(true);
	});

	it("segunda llamada marca todo como unchanged (hashes coinciden)", () => {
		syncBundledAgents(false, tmpAgentDir);
		const result2 = syncBundledAgents(false, tmpAgentDir);

		expect(result2.added).toHaveLength(0);
		expect(result2.unchanged.length).toBeGreaterThan(0);
		expect(result2.updated).toHaveLength(0);
	});

	it("detecta drift: usuario edita un agente → pendingUpdate", () => {
		syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);

		// Modificar un agente a mano (simula edición del usuario).
		const agentPath = path.join(targetDir, "codebase-locator.md");
		fs.writeFileSync(agentPath, "# EDITADO POR EL USUARIO\n", "utf-8");

		// Re-sync: detecta drift pero NO lo aplica (gated).
		const result = syncBundledAgents(false, tmpAgentDir);
		expect(result.pendingUpdate).toContain("codebase-locator.md");
		expect(result.updated).not.toContain("codebase-locator.md");
	});

	it("apply=true (/frida-update-agents) fuerza overwrite del drift", () => {
		syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);

		// Modificar a mano.
		const agentPath = path.join(targetDir, "codebase-locator.md");
		fs.writeFileSync(agentPath, "# EDITADO\n", "utf-8");

		// Re-sync con apply=true: fuerza overwrite.
		const result = syncBundledAgents(true, tmpAgentDir);
		expect(result.updated).toContain("codebase-locator.md");
		expect(result.pendingUpdate).not.toContain("codebase-locator.md");

		// El contenido fue restaurado al del source.
		const content = fs.readFileSync(agentPath, "utf-8");
		expect(content).not.toContain("EDITADO");
	});

	it("manifest .frida-managed.json se escribe con hashes sha256", () => {
		syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);
		const manifestPath = path.join(targetDir, ".frida-managed.json");

		expect(fs.existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		expect(manifest["codebase-locator.md"]).toMatch(/^[a-f0-9]{64}$/);
	});

	it("stale removal: agente en manifest pero no en source → removed", () => {
		syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);

		// Simular un agente stale: crear uno extra en el target + registrarlo.
		const staleName = "old-removed-agent.md";
		fs.writeFileSync(path.join(targetDir, staleName), "# old\n", "utf-8");
		// Añadirlo al manifest.
		const manifestPath = path.join(targetDir, ".frida-managed.json");
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		const crypto = require("node:crypto");
		manifest[staleName] = crypto
			.createHash("sha256")
			.update("# old\n")
			.digest("hex");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		// Re-sync: detecta stale y lo elimina (hash coincide → safe).
		const result = syncBundledAgents(false, tmpAgentDir);
		expect(result.removed).toContain(staleName);
		expect(fs.existsSync(path.join(targetDir, staleName))).toBe(false);
	});
});

describe("frida-pipeline / agents-sync / formatSyncReport", () => {
	it("todos actualizados cuando no hay cambios", () => {
		syncBundledAgents(false, tmpAgentDir);
		const result = syncBundledAgents(false, tmpAgentDir);
		const report = formatSyncReport(result);
		expect(report).toContain("actualizados");
	});

	it("reporta pending cuando hay drift", () => {
		syncBundledAgents(false, tmpAgentDir);
		const targetDir = getGlobalAgentsDir(tmpAgentDir);
		fs.writeFileSync(
			path.join(targetDir, "codebase-locator.md"),
			"# EDITADO\n",
			"utf-8",
		);
		const result = syncBundledAgents(false, tmpAgentDir);
		const report = formatSyncReport(result);
		expect(report).toContain("Pendientes");
		expect(report).toContain("/frida-update-agents");
	});

	it("totalSynced cuenta added + updated + removed", () => {
		const result = syncBundledAgents(false, tmpAgentDir);
		const total = totalSynced(result);
		expect(total).toBe(result.added.length);
		expect(total).toBeGreaterThan(0);
	});
});
