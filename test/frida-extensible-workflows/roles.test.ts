// Fase 7 — roles: resolveRoleOverrides (pura) + parseRoleMarkdown (vendoreado).
import { describe, it, expect } from "vitest";
import { resolveRoleOverrides } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { parseRoleMarkdown } from "../../src/tools/frida-extensible-workflows/core/validation";
import type { AgentDefinition } from "../../src/tools/frida-extensible-workflows/core/types";

const ROLES: Record<string, AgentDefinition> = {
	reviewer: {
		prompt: "Eres un reviewer.",
		model: "anthropic/claude",
		thinking: "high",
		tools: ["read", "bash", "edit"],
	},
};

describe("frida-extensible-workflows · roles (Fase 7)", () => {
	it("resolveRoleOverrides: rol string aplica model/thinking/tools del rol", () => {
		const r = resolveRoleOverrides({ role: "reviewer" }, ROLES);
		expect(r.model).toBe("anthropic/claude");
		expect(r.thinking).toBe("high");
		expect(r.tools).toEqual(["read", "bash", "edit"]);
	});

	it("resolveRoleOverrides: objeto rol con overrides pisa al rol", () => {
		const r = resolveRoleOverrides(
			{ role: { name: "reviewer", thinking: "low" } },
			ROLES,
		);
		expect(r.model).toBe("anthropic/claude"); // heredado del rol
		expect(r.thinking).toBe("low"); // override explícito
		expect(r.tools).toEqual(["read", "bash", "edit"]); // heredado
	});

	it("resolveRoleOverrides: sin rol, usa options directas", () => {
		const r = resolveRoleOverrides(
			{ model: "openai/gpt", thinking: "medium", tools: ["read"] },
			ROLES,
		);
		expect(r.model).toBe("openai/gpt");
		expect(r.thinking).toBe("medium");
		expect(r.tools).toEqual(["read"]);
	});

	it("resolveRoleOverrides: rol inexistente no aplica overrides", () => {
		const r = resolveRoleOverrides({ role: "noexiste" }, ROLES);
		expect(r.model).toBeUndefined();
		expect(r.thinking).toBeUndefined();
		expect(r.tools).toBeUndefined();
	});

	it("parseRoleMarkdown: parsea frontmatter + body de un rol .md", () => {
		const md = [
			"---",
			'model: "anthropic/claude"',
			"thinking: high",
			'tools: ["read", "bash"]',
			"description: Reviewer rol",
			"---",
			"Eres un reviewer estricto.",
		].join("\n");
		const def = parseRoleMarkdown(md);
		expect(def.model).toBe("anthropic/claude");
		expect(def.thinking).toBe("high");
		expect(def.tools).toEqual(["read", "bash"]);
		expect(def.description).toBe("Reviewer rol");
		expect(def.prompt).toBe("Eres un reviewer estricto.");
	});
});
