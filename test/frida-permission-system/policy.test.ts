import { describe, it, expect } from "vitest";
import {
	evaluate,
	computeDeniedTools,
} from "../../src/tools/frida-permission-system/policy";
import { DEFAULT_POLICY } from "../../src/tools/frida-permission-system/config";
import type { PermissionPolicy } from "../../src/tools/frida-permission-system/types";

// CWD canónico (POSIX) para los tests de external_path.
const CWD = "/Users/dev/proyecto";

// Patterns vacío inline (evita importar src/settings, que arrastra el módulo
// `vscode` no disponible en vitest). Equivalente a EMPTY_GATE_PATTERNS.
const NO_PATTERNS = {
	sensitiveExtensions: [],
	sensitiveBasenames: [],
	sensitiveAllowBasenames: [],
	dangerousCommandSubstrings: [],
};

function ev(tool: string, input: Record<string, unknown> = {}) {
	return evaluate({
		tool,
		inputPath: input.path as string | undefined,
		command: input.command as string | undefined,
		cwd: CWD,
		policy: DEFAULT_POLICY,
		patterns: NO_PATTERNS,
	});
}

/** Como ev() pero con una policy custom (para tests de path/bash declarativos). */
function evp(
	policy: PermissionPolicy,
	tool: string,
	input: Record<string, unknown> = {},
) {
	return evaluate({
		tool,
		inputPath: input.path as string | undefined,
		command: input.command as string | undefined,
		cwd: CWD,
		policy,
		patterns: NO_PATTERNS,
	});
}

describe("evaluate — superficie tool (baseline declarativa)", () => {
	it("FREE_TOOLS pasan (allow): read/grep/find/ls/todo/ask_user_question", () => {
		for (const t of [
			"read",
			"grep",
			"find",
			"ls",
			"todo",
			"ask_user_question",
		]) {
			const d = ev(t, { path: "src/app.ts" });
			expect(d.state, `${t} debería ser allow`).toBe("allow");
			expect(d.forceAsk).toBe(false);
		}
	});

	it("edit/write piden (ask)", () => {
		expect(ev("edit", { path: "src/app.ts" }).state).toBe("ask");
		expect(ev("write", { path: "src/app.ts" }).state).toBe("ask");
	});

	it("bash pide (ask)", () => {
		expect(ev("bash", { command: "git status" }).state).toBe("ask");
	});

	it("desconocido pide (ask) — MCP/extensión de terceros no se cuela", () => {
		expect(ev("mcp_tool_x").state).toBe("ask");
	});
});

describe("evaluate — deny por policy (absoluto, sobrevive al modo)", () => {
	it("path sensible → deny (sensitive_path) incluso en tools libres (read)", () => {
		const d = ev("read", { path: ".env" });
		expect(d.state).toBe("deny");
		expect(d.source).toBe("sensitive_path");
		expect(d.reason).toBeTruthy();
	});

	it("clave SSH → deny", () => {
		expect(ev("read", { path: "~/.ssh/id_rsa" }).state).toBe("deny");
	});

	it("comando destructivo → deny (dangerous_command)", () => {
		const d = ev("bash", { command: "rm -rf /" });
		expect(d.state).toBe("deny");
		expect(d.source).toBe("dangerous_command");
	});

	it("fork bomb → deny", () => {
		expect(ev("bash", { command: ":(){ :|:& };:" }).state).toBe("deny");
	});
});

describe("evaluate — force-ask (disuasivo, sobrevive al modo auto)", () => {
	it("bash compuesto → force-ask con flag compound_command", () => {
		const d = ev("bash", { command: "git status && rm -rf dist" });
		expect(d.forceAsk).toBe(true);
		expect(d.flags).toContain("compound_command");
	});

	it("bash con wrapper (sudo) → force-ask", () => {
		const d = ev("bash", { command: "sudo apt update" });
		expect(d.forceAsk).toBe(true);
		expect(d.flags).toContain("compound_command");
	});

	it("path externo (absoluto fuera de cwd) → force-ask con flag external_path", () => {
		const d = ev("read", { path: "/etc/passwd" });
		expect(d.forceAsk).toBe(true);
		expect(d.flags).toContain("external_path");
	});

	it("force-ask promueve allow → ask (FREE_TOOL con path externo)", () => {
		// read es allow por policy, pero path externo fuerza ask (no se cuela en auto).
		const d = ev("read", { path: "/etc/passwd" });
		expect(d.state).toBe("ask");
		expect(d.forceAsk).toBe(true);
	});

	it("path interno NO dispara force-ask", () => {
		const d = ev("read", { path: "src/app.ts" });
		expect(d.forceAsk).toBe(false);
		expect(d.flags).toBeUndefined();
	});
});

describe("computeDeniedTools (hide-tools, Fase 7)", () => {
	it("policy sin deny explícito → vacío", () => {
		expect(computeDeniedTools(DEFAULT_POLICY).size).toBe(0);
	});

	it("bash: deny → { bash }", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			tool: { ...DEFAULT_POLICY.tool, bash: "deny" },
		};
		expect(computeDeniedTools(p)).toEqual(new Set(["bash"]));
	});

	it("edit + write deny → ambos", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			tool: { ...DEFAULT_POLICY.tool, edit: "deny", write: "deny" },
		};
		expect(computeDeniedTools(p)).toEqual(new Set(["edit", "write"]));
	});

	it("excluye el wildcard '*' (un *: deny NO oculta todo)", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			tool: { "*": "deny" },
		};
		expect(computeDeniedTools(p).size).toBe(0);
	});

	it("mixto: deny explícitos sí; allow y * no", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			tool: { read: "allow", edit: "deny", bash: "deny", "*": "deny" },
		};
		expect(computeDeniedTools(p)).toEqual(new Set(["edit", "bash"]));
	});
});

describe("evaluate — policy.path / policy.bash declarativos (Fase 5b)", () => {
	it("policy.path deny bloquea un path custom (source policy_path)", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			path: { "*": "allow", "secrets/*": "deny" },
		};
		const d = evp(p, "read", { path: "secrets/key.txt" });
		expect(d.state).toBe("deny");
		expect(d.source).toBe("policy_path");
	});

	it("policy.bash deny bloquea un comando custom (source policy_bash)", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			bash: { "*": "ask", "git push *": "deny" },
		};
		const d = evp(p, "bash", { command: "git push origin main" });
		expect(d.state).toBe("deny");
		expect(d.source).toBe("policy_bash");
	});

	it("policy.path allow NO anula un deny específico (most-restrictive-wins)", () => {
		// Orden invertido (deny antes que *) → igual deny.
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			path: { "secrets/*": "deny", "*": "allow" },
		};
		expect(evp(p, "read", { path: "secrets/x" }).state).toBe("deny");
	});

	it("DEFAULT_POLICY: read interno sigue allow (path '*' allow + tool allow)", () => {
		expect(ev("read", { path: "src/app.ts" }).state).toBe("allow");
	});

	it("policy.bash ask eleva un allow de tool a ask (most-restrictive)", () => {
		const p: PermissionPolicy = {
			...DEFAULT_POLICY,
			bash: { "*": "ask" },
			tool: { ...DEFAULT_POLICY.tool, bash: "allow" },
		};
		expect(evp(p, "bash", { command: "ls" }).state).toBe("ask");
	});
});
