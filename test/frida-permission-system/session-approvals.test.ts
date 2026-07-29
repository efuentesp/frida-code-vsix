import { describe, it, expect } from "vitest";
import {
	SessionApprovals,
	matchesWildcard,
	suggestPattern,
} from "../../src/tools/frida-permission-system/session-approvals";

describe("matchesWildcard", () => {
	it("'*' matchea cualquier cosa", () => {
		expect(matchesWildcard("*", "lo que sea")).toBe(true);
		expect(matchesWildcard("*", "")).toBe(true);
	});

	it("'npm *' matchea comandos con prefijo npm", () => {
		expect(matchesWildcard("npm *", "npm run build")).toBe(true);
		expect(matchesWildcard("npm *", "npm install")).toBe(true);
	});

	it("'npm *' NO matchea otros comandos", () => {
		expect(matchesWildcard("npm *", "git status")).toBe(false);
		expect(matchesWildcard("npm *", "pnpm install")).toBe(false);
	});

	it("'src/*' matchea paths en ese directorio", () => {
		expect(matchesWildcard("src/*", "src/app.ts")).toBe(true);
		expect(matchesWildcard("src/*", "src/")).toBe(true);
	});

	it("escapa caracteres regex especiales del patrón", () => {
		// Un punto literal en el patrón NO actúa como comodín regex.
		expect(matchesWildcard("a.b", "axb")).toBe(false);
		expect(matchesWildcard("a.b", "a.b")).toBe(true);
	});
});

describe("suggestPattern", () => {
	it("bash → primer token + ' *'", () => {
		expect(suggestPattern("bash", { command: "npm run build" })).toBe("npm *");
		expect(suggestPattern("bash", { command: "git status" })).toBe("git *");
	});

	it("diff → directorio del path + '/*'", () => {
		expect(suggestPattern("diff", { path: "src/app.ts" })).toBe("src/*");
		expect(suggestPattern("diff", { path: "webview/components/Foo.tsx" })).toBe(
			"webview/components/*",
		);
	});

	it("diff sin directorio → undefined (no sugerimos '*' tan amplio)", () => {
		expect(suggestPattern("diff", { path: "app.ts" })).toBeUndefined();
	});

	it("tool (desconocido) → undefined (no sugerimos a ciegas)", () => {
		expect(suggestPattern("tool", {})).toBeUndefined();
	});

	it("input vacío → undefined", () => {
		expect(suggestPattern("bash", {})).toBeUndefined();
		expect(suggestPattern("diff", {})).toBeUndefined();
	});
});

describe("SessionApprovals", () => {
	it("add + matches: un patrón aprobado matchea próximas llamadas", () => {
		const s = new SessionApprovals();
		expect(s.matches("bash", "npm run build")).toBe(false);
		s.add("bash", "npm *");
		expect(s.matches("bash", "npm run build")).toBe(true);
		expect(s.matches("bash", "npm test")).toBe(true);
	});

	it("matches es específico por kind (bash ≠ diff)", () => {
		const s = new SessionApprovals();
		s.add("bash", "npm *");
		expect(s.matches("bash", "npm run build")).toBe(true);
		expect(s.matches("diff", "npm run build")).toBe(false);
	});

	it("add ignora duplicados y vacíos", () => {
		const s = new SessionApprovals();
		s.add("bash", "npm *");
		s.add("bash", "npm *"); // duplicado → no duplica
		s.add("bash", "  "); // vacío → ignora
		// No hay forma directa de contar, pero el comportamiento (match) es idéntico.
		expect(s.matches("bash", "npm test")).toBe(true);
	});

	it("clear olvida los patrones", () => {
		const s = new SessionApprovals();
		s.add("bash", "npm *");
		expect(s.matches("bash", "npm test")).toBe(true);
		s.clear();
		expect(s.matches("bash", "npm test")).toBe(false);
	});
});
