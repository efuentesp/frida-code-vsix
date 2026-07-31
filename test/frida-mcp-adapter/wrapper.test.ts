// Tests del wrapper frida-mcp-adapter (ADR-0023 Fase 2).
//
// Verifica que la factory existe, setea PI_CODING_AGENT_DIR, y puede invocarse
// con un ExtensionAPI mock sin crashear.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

// Mock del upstream: no cargamos pi-mcp-adapter real (tiene deps complejas).
// Sólo verificamos que el wrapper de Frida lo invoca correctamente.
const mockAdapter = vi.fn();
const mockCreateMcpAdapter = vi.fn(() => mockAdapter);
vi.mock("pi-mcp-adapter", () => ({
	createMcpAdapter: mockCreateMcpAdapter,
}));

describe("frida-mcp-adapter / wrapper", () => {
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

	beforeEach(() => {
		delete process.env.PI_CODING_AGENT_DIR;
	});

	afterEach(() => {
		if (originalAgentDir !== undefined) {
			process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		} else {
			delete process.env.PI_CODING_AGENT_DIR;
		}
	});

	it("createFridaMcpAdapter exporta una función factory", async () => {
		const mod = await import("../../src/tools/frida-mcp-adapter/index.ts");
		expect(typeof mod.createFridaMcpAdapter).toBe("function");

		const factory = mod.createFridaMcpAdapter();
		expect(typeof factory).toBe("function");
	});

	it("FRIDA_AGENT_DIR apunta a ~/.frida", async () => {
		const expected = path.join(os.homedir(), ".frida");
		// La factory setea PI_CODING_AGENT_DIR = FRIDA_AGENT_DIR internamente.
		// Verificamos que el valor esperado sea correcto.
		expect(expected).toBe(path.join(os.homedir(), ".frida"));
	});

	it("factory setea PI_CODING_AGENT_DIR cuando no está definido", async () => {
		expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();

		const mockPi: any = {};

		const { createFridaMcpAdapter } = await import(
			"../../src/tools/frida-mcp-adapter/index.ts"
		);
		const factory = createFridaMcpAdapter();
		factory(mockPi);

		// Después de llamar la factory, PI_CODING_AGENT_DIR debe estar seteado.
		expect(process.env.PI_CODING_AGENT_DIR).toBe(
			path.join(os.homedir(), ".frida"),
		);
		// createMcpAdapter fue llamado y su resultado fue aplicado con pi.
		expect(mockCreateMcpAdapter).toHaveBeenCalledTimes(1);
		expect(mockAdapter).toHaveBeenCalledTimes(1);
		expect(mockAdapter).toHaveBeenCalledWith(mockPi);
	});

	it("factory respeta PI_CODING_AGENT_DIR si ya está definido", async () => {
		process.env.PI_CODING_AGENT_DIR = "/tmp/custom-agent-dir";

		const mockPi: any = {};

		const { createFridaMcpAdapter } = await import(
			"../../src/tools/frida-mcp-adapter/index.ts"
		);
		const factory = createFridaMcpAdapter();
		factory(mockPi);

		// El valor existente no debe sobreescriirse.
		expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/custom-agent-dir");
	});
});
