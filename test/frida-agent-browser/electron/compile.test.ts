import { describe, it, expect } from "vitest";
import { compileElectron } from "../../../src/tools/frida-agent-browser/electron/compile";

describe("compileElectron — list", () => {
	it("list válido", () => {
		const r = compileElectron({
			action: "list",
			query: "code",
			maxResults: 5,
		})!;
		expect(r.compiled).toEqual({
			action: "list",
			query: "code",
			maxResults: 5,
		});
	});
	it("list no soporta campos ajenos", () => {
		expect(compileElectron({ action: "list", launchId: "x" })?.error).toMatch(
			/only supports query and maxResults/,
		);
	});
});

describe("compileElectron — launch", () => {
	it("requiere exactamente un target", () => {
		expect(compileElectron({ action: "launch" })?.error).toMatch(
			/exactly one of/,
		);
		expect(
			compileElectron({ action: "launch", appPath: "a", appName: "b" })?.error,
		).toMatch(/exactly one of/);
	});
	it("launch con appPath + defaults (handoff/targetType)", () => {
		const r = compileElectron({ action: "launch", appPath: "/x.app" })!;
		expect((r.compiled as { handoff: string }).handoff).toBe("snapshot");
		expect((r.compiled as { targetType: string }).targetType).toBe("page");
	});
	it("appArgs no puede incluir flags wrapper-owned", () => {
		expect(
			compileElectron({
				action: "launch",
				appPath: "/x",
				appArgs: ["--user-data-dir=/y"],
			})?.error,
		).toMatch(/wrapper-owned/);
	});
	it("campo no soportado", () => {
		expect(
			compileElectron({ action: "launch", appPath: "/x", query: "q" })?.error,
		).toMatch(/does not support/);
	});
});

describe("compileElectron — status/cleanup/probe", () => {
	it("status con launchId", () => {
		const r = compileElectron({ action: "status", launchId: "e-1" })!;
		expect((r.compiled as { launchId: string }).launchId).toBe("e-1");
	});
	it("status all", () => {
		expect(
			(
				compileElectron({ action: "status", all: true })!.compiled as {
					all: boolean;
				}
			).all,
		).toBe(true);
	});
	it("launchId y all mutuamente excluyentes", () => {
		expect(
			compileElectron({ action: "cleanup", launchId: "x", all: true })?.error,
		).toMatch(/not both/);
	});
	it("probe sólo launchId/timeoutMs", () => {
		expect(compileElectron({ action: "probe", query: "x" })?.error).toMatch(
			/only supports/,
		);
		const r = compileElectron({ action: "probe", launchId: "e-1" })!;
		expect((r.compiled as { launchId: string }).launchId).toBe("e-1");
	});
});

describe("compileElectron — validación transversal", () => {
	it("action inválida", () => {
		expect(compileElectron({ action: "nope" })?.error).toMatch(
			/action must be one of/,
		);
	});
	it("no es objeto", () => {
		expect(compileElectron("x")?.error).toMatch(/must be an object/);
	});
	it("handoff inválido", () => {
		expect(
			compileElectron({ action: "launch", appPath: "/x", handoff: "nope" })
				?.error,
		).toMatch(/handoff must be one of/);
	});
});
