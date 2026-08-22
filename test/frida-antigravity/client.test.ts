/**
 * frida-antigravity (#97) — cliente: credenciales y discovery.
 *
 * Contratos: parseApiKey (el getApiKey del OAuth serializa {token, projectId}
 * en JSON — el streamer lo parsea), stableProjectId (UUID-shaped estable) y
 * extractProjectId (formas anidadas de la respuesta de loadCodeAssist).
 */
import { describe, expect, it } from "vitest";
import {
	defaultProjectId,
	extractProjectId,
	parseApiKey,
	stableProjectId,
} from "../../src/providers/frida-antigravity/client/client";

describe("frida-antigravity · parseApiKey", () => {
	it("parsea el JSON {token, projectId} que produce getApiKey del OAuth", () => {
		const creds = parseApiKey(
			JSON.stringify({ token: "ya29.access", projectId: "proj-1" }),
		);
		expect(creds.token).toBe("ya29.access");
		expect(creds.projectId).toBe("proj-1");
	});

	it("sin credenciales → error accionable (run /login)", () => {
		expect(() => parseApiKey(undefined)).toThrow(
			/No Antigravity OAuth credentials/,
		);
	});

	it("JSON inválido o incompleto → error con causa", () => {
		expect(() => parseApiKey("no-json")).toThrow(
			/Invalid Antigravity credentials/,
		);
		expect(() => parseApiKey('{"token":"t"}')).toThrow(/Invalid/);
		expect(() => parseApiKey('{"projectId":"p"}')).toThrow(/Invalid/);
	});
});

describe("frida-antigravity · stableProjectId", () => {
	it("genera UUID-shaped (8-4-4-4-12) estable por semilla", () => {
		const a = stableProjectId("user@example.com");
		const b = stableProjectId("user@example.com");
		expect(a).toBe(b);
		expect(a).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("semillas distintas → ids distintos", () => {
		expect(stableProjectId("a@x.com")).not.toBe(stableProjectId("b@x.com"));
	});

	it("defaultProjectId respeta ANTIGRAVITY_PROJECT_ID cuando está seteado", () => {
		process.env.ANTIGRAVITY_PROJECT_ID = "my-explicit-project";
		try {
			expect(defaultProjectId("seed-ignorado")).toBe("my-explicit-project");
		} finally {
			delete process.env.ANTIGRAVITY_PROJECT_ID;
		}
	});

	it("defaultProjectId sin env → derivado estable de la semilla", () => {
		expect(defaultProjectId("seed-x")).toBe(stableProjectId("seed-x"));
	});
});

describe("frida-antigravity · extractProjectId (formas del backend)", () => {
	it("campo directo projectId", () => {
		expect(extractProjectId({ projectId: "p1" })).toBe("p1");
	});

	it("alias conocidos (antigravityProjectId, cloudaicompanionProject…)", () => {
		expect(extractProjectId({ antigravityProjectId: "p2" })).toBe("p2");
		expect(extractProjectId({ userDefinedCloudaicompanionProject: "p3" })).toBe(
			"p3",
		);
	});

	it("objeto anidado con .id", () => {
		expect(extractProjectId({ project: { id: "p4" } })).toBe("p4");
	});

	it("listas (projects/cloudaicompanionProjects)", () => {
		expect(extractProjectId({ cloudaicompanionProjects: ["p5"] })).toBe("p5");
		expect(extractProjectId({ projects: [{ projectId: "p6" }] })).toBe("p6");
	});

	it("sin projectId → undefined", () => {
		expect(extractProjectId({ other: 1 })).toBeUndefined();
		expect(extractProjectId("string")).toBeUndefined();
	});
});
