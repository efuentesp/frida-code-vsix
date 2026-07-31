// Tests de integración de frida-mcp-adapter (ADR-0023 Fase 5).
//
// Verifica que la configuración de build, el registro en pi-session.ts,
// la redirección de paths vía PI_CODING_AGENT_DIR, y los artefactos
// construidos son correctos.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(__dirname, "../..");

describe("frida-mcp-adapter / esbuild.js config", () => {
	const esbuildContent = fs.readFileSync(
		path.join(projectRoot, "esbuild.js"),
		"utf-8",
	);

	it("@napi-rs/keyring está en external (módulo nativo no bundleable)", () => {
		expect(esbuildContent).toContain('"@napi-rs/keyring"');
		expect(esbuildContent).toContain('"@napi-rs/keyring-*"');
	});

	it("plugin stubSamplingHandler está registrado", () => {
		expect(esbuildContent).toContain("stubSamplingHandler");
		expect(esbuildContent).toContain("stub-mcp-sampling-handler");
		expect(esbuildContent).toContain("sampling-handler");
	});

	it("shim import.meta.dirname está definido", () => {
		expect(esbuildContent).toContain("__import_meta_dirname");
		expect(esbuildContent).toContain('"import.meta.dirname"');
	});

	it("copy step de app-bridge.bundle.js existe", () => {
		expect(esbuildContent).toContain("app-bridge.bundle.js");
		expect(esbuildContent).toContain("copyFileSync");
	});
});

describe("frida-mcp-adapter / pi-session.ts", () => {
	const sessionContent = fs.readFileSync(
		path.join(projectRoot, "src/pi-session.ts"),
		"utf-8",
	);

	it("importa createFridaMcpAdapter", () => {
		expect(sessionContent).toContain("createFridaMcpAdapter");
		expect(sessionContent).toContain("frida-mcp-adapter");
	});

	it("registra el factory después de frida-subagents", () => {
		const subagentsIdx = sessionContent.indexOf('"frida-subagents"');
		const mcpIdx = sessionContent.indexOf('"frida-mcp-adapter"');
		expect(subagentsIdx).toBeGreaterThan(0);
		expect(mcpIdx).toBeGreaterThan(subagentsIdx);
	});

	it("comentario ADR-0023 en el registro", () => {
		expect(sessionContent).toContain("ADR-0023");
	});
});

describe("frida-mcp-adapter / config path redirect", () => {
	it("agent-dir.ts respeta PI_CODING_AGENT_DIR", () => {
		const agentDirSrc = fs.readFileSync(
			path.join(projectRoot, "node_modules/pi-mcp-adapter/agent-dir.ts"),
			"utf-8",
		);
		expect(agentDirSrc).toContain("PI_CODING_AGENT_DIR");
		expect(agentDirSrc).toContain('".pi", "agent"');
	});

	it("wrapper setea PI_CODING_AGENT_DIR antes de crear el adapter", () => {
		const wrapperSrc = fs.readFileSync(
			path.join(projectRoot, "src/tools/frida-mcp-adapter/index.ts"),
			"utf-8",
		);
		expect(wrapperSrc).toContain("PI_CODING_AGENT_DIR");
		expect(wrapperSrc).toContain('".frida"');
		// El set debe estar antes de createMcpAdapter()
		const setIdx = wrapperSrc.indexOf("PI_CODING_AGENT_DIR =");
		const createIdx = wrapperSrc.indexOf("createMcpAdapter()");
		expect(setIdx).toBeGreaterThan(0);
		expect(createIdx).toBeGreaterThan(setIdx);
	});

	it("config.ts usa getAgentPath de agent-dir para paths globales", () => {
		const configSrc = fs.readFileSync(
			path.join(projectRoot, "node_modules/pi-mcp-adapter/config.ts"),
			"utf-8",
		);
		expect(configSrc).toContain("getAgentPath");
		expect(configSrc).toContain("agent-dir");
	});
});

// Tests condicionales: sólo si dist/ existe (requiere build previo).
const distExists = fs.existsSync(path.join(projectRoot, "dist/extension.js"));

describe.skipIf(!distExists)("frida-mcp-adapter / build artifacts", () => {
	it("dist/extension.js contiene installMcpAdapter", () => {
		const code = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(code).toContain("installMcpAdapter");
	});

	it("dist/extension.js contiene transportes MCP (stdio + HTTP)", () => {
		const code = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(code).toContain("StdioClientTransport");
		expect(code).toContain("StreamableHTTPClientTransport");
	});

	it("dist/extension.js contiene createFridaMcpAdapter", () => {
		const code = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(code).toContain("createFridaMcpAdapter");
	});

	it("dist/extension.js contiene PI_CODING_AGENT_DIR", () => {
		const code = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(code).toContain("PI_CODING_AGENT_DIR");
	});

	it("dist/app-bridge.bundle.js existe", () => {
		expect(
			fs.existsSync(path.join(projectRoot, "dist/app-bridge.bundle.js")),
		).toBe(true);
	});
});

describe("frida-mcp-adapter / package.json", () => {
	it("@napi-rs/keyring está en dependencies (runtime)", () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
		);
		expect(pkg.dependencies["@napi-rs/keyring"]).toBeDefined();
	});

	it("pi-mcp-adapter está en devDependencies (build-time)", () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
		);
		expect(pkg.devDependencies["pi-mcp-adapter"]).toBeDefined();
	});
});
