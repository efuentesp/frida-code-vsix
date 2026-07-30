import { describe, it, expect } from "vitest";
import {
	firstPositional,
	isPlainTextInspection,
	isSessionlessCommand,
	needsManagedSession,
} from "../../src/tools/frida-agent-browser/command-policy";

describe("command-policy — firstPositional", () => {
	it("salta --session <val> y flags", () => {
		expect(firstPositional(["--session", "s", "open", "https://x"])).toBe(
			"open",
		);
		expect(firstPositional(["snapshot", "-i"])).toBe("snapshot");
		expect(firstPositional(["--help"])).toBeUndefined();
	});
});

describe("command-policy — isSessionlessCommand / needsManagedSession", () => {
	const S = (args: string[]) =>
		isSessionlessCommand(firstPositional(args), args);
	const M = (args: string[]) =>
		needsManagedSession(firstPositional(args), args);

	it("sessionless: skills/auth/plugin/mcp/dashboard/device/doctor/install/profiles/upgrade/session/state", () => {
		expect(S(["skills", "list"])).toBe(true);
		expect(S(["skills", "get", "core", "--full"])).toBe(true);
		expect(S(["auth", "save", "name", "--password-stdin"])).toBe(true);
		expect(S(["auth", "list"])).toBe(true);
		expect(S(["mcp"])).toBe(true);
		expect(S(["dashboard", "start"])).toBe(true);
		expect(S(["device", "list"])).toBe(true);
		expect(S(["doctor"])).toBe(true);
		expect(S(["profiles"])).toBe(true);
		expect(S(["upgrade"])).toBe(true);
		expect(S(["session", "list"])).toBe(true);
		expect(S(["state", "list"])).toBe(true);
		expect(S(["state", "clear", "--all"])).toBe(true);
	});

	it("NO sessionless: comandos browser-backed", () => {
		expect(S(["open", "https://x"])).toBe(false);
		expect(S(["snapshot", "-i"])).toBe(false);
		expect(S(["click", "@e1"])).toBe(false);
		expect(S(["auth", "login"])).toBe(false); // login es browser-backed
		expect(S(["state", "save", "x"])).toBe(false); // save es browser-backed
	});

	it("skills/state requieren subcomando; auth/plugin/dashboard solos sí", () => {
		expect(S(["skills"])).toBe(false); // skills requiere sub
		expect(S(["state"])).toBe(false);
		expect(S(["auth"])).toBe(true); // auth solo (status)
		expect(S(["plugin"])).toBe(true);
		expect(S(["dashboard"])).toBe(true);
	});

	it("needsManagedSession es la inversa", () => {
		expect(M(["open", "https://x"])).toBe(true);
		expect(M(["skills", "list"])).toBe(false);
	});
});

describe("command-policy — isPlainTextInspection", () => {
	it("--help/-h/--version/-V global sin comando → true", () => {
		expect(isPlainTextInspection(["--help"])).toBe(true);
		expect(isPlainTextInspection(["-h"])).toBe(true);
		expect(isPlainTextInspection(["--version"])).toBe(true);
		expect(isPlainTextInspection(["-V"])).toBe(true);
	});
	it("con comando → false (el comando define el formato)", () => {
		expect(isPlainTextInspection(["open", "--help"])).toBe(false);
		expect(isPlainTextInspection(["snapshot", "-i"])).toBe(false);
	});
	it("sin help → false", () => {
		expect(isPlainTextInspection([])).toBe(false);
	});
});
