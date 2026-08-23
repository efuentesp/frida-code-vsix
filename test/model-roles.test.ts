import { describe, expect, it } from "vitest";
import {
	MODEL_ROLES,
	ROLE_META,
	pickChildModel,
	pickStartupFallback,
	resolveModelRoles,
	roleTag,
	type ModelRolesConfig,
	type ResolveInput,
} from "../src/model-roles";

function input(
	config: ModelRolesConfig,
	authedCatalog: Record<string, string[]>,
): ResolveInput {
	return { config, authedCatalog };
}

const CATALOG = {
	"frida-enterprise": ["claude-sonnet-4-5", "claude-opus-4-5"],
	ollama: ["llama3.2", "qwen2.5-coder"],
};

describe("#121 — resolvedor de roles de modelo", () => {
	it("expone los 3 roles con meta completa", () => {
		expect([...MODEL_ROLES]).toEqual(["default", "smol", "commit"]);
		for (const r of MODEL_ROLES) {
			expect(ROLE_META[r].label).toBeTruthy();
			expect(ROLE_META[r].hint).toBeTruthy();
			expect(ROLE_META[r].icon).toBeTruthy();
		}
	});

	it("rol sin configurar hereda default; default explícito se respeta", () => {
		const r = resolveModelRoles(
			input(
				{ default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" } },
				CATALOG,
			),
		);
		expect(r.default.effective).toEqual({
			provider: "frida-enterprise",
			modelId: "claude-sonnet-4-5",
		});
		expect(r.default.origin).toBe("explicit");
		// smol y commit heredan
		expect(r.smol.effective).toEqual(r.default.effective);
		expect(r.smol.origin).toBe("inherit");
		expect(r.commit.effective).toEqual(r.default.effective);
		expect(r.commit.origin).toBe("inherit");
	});

	it("smol explícito a Ollama resuelve independiente (caso de uso central)", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					smol: { provider: "ollama", modelId: "llama3.2" },
				},
				CATALOG,
			),
		);
		expect(r.smol.effective).toEqual({ provider: "ollama", modelId: "llama3.2" });
		expect(r.smol.origin).toBe("explicit");
		// default no cambia
		expect(r.default.effective?.provider).toBe("frida-enterprise");
	});

	it("rol con provider sin auth → hereda default (nunca asigna un provider muerto)", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					smol: { provider: "openai", modelId: "gpt-5.2" }, // openai no está authed
				},
				CATALOG,
			),
		);
		expect(r.smol.effective).toEqual(r.default.effective);
		expect(r.smol.origin).toBe("inherit");
	});

	it("rol con modelo fuera de catálogo → hereda default", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					commit: { provider: "ollama", modelId: "inexistente" },
				},
				CATALOG,
			),
		);
		expect(r.commit.effective).toEqual(r.default.effective);
	});

	it("default mismo sin auth → cae al primer provider authed (orden estable)", () => {
		const r = resolveModelRoles(
			input({ default: { provider: "openai", modelId: "gpt-5.2" } }, CATALOG),
		);
		expect(r.default.effective?.provider).toBe("frida-enterprise"); // primer authed alfabético
		expect(r.default.origin).toBe("inherit");
		// smol hereda esa caída
		expect(r.smol.effective).toEqual(r.default.effective);
	});

	it("sin nada authed → todo null y cadenas vacías (no adivina)", () => {
		const r = resolveModelRoles(
			input({ default: { provider: "x", modelId: "y" } }, {}),
		);
		expect(r.default.effective).toBeNull();
		expect(r.smol.effective).toBeNull();
		expect(r.commit.chain).toEqual([]);
	});

	it("fallback OFF (ausente) → cadena de 1", () => {
		const r = resolveModelRoles(
			input(
				{ default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" } },
				CATALOG,
			),
		);
		expect(r.default.chain).toHaveLength(1);
	});

	it("fallback [] = AUTO: cadena agrega otros authed sin lista explícita", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					fallback: [],
				},
				CATALOG,
			),
		);
		expect(r.default.chain.map((c) => c.provider)).toEqual([
			"frida-enterprise",
			"ollama",
		]);
	});

	it("fallback ON → cadena = efectivo + respaldo explícito + otros authed (tope 3)", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					fallback: ["ollama"],
				},
				CATALOG,
			),
		);
		expect(r.default.chain).toEqual([
			{ provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
			{ provider: "ollama", modelId: "qwen2.5-coder" }, // explícito; último modelo del catálogo
		]);
		// con 3 providers authed el tope es 3
		const r3 = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					fallback: ["ollama"],
				},
				{ ...CATALOG, openai: ["gpt-5.2"] },
			),
		);
		expect(r3.default.chain).toHaveLength(3);
		expect(r3.default.chain.at(-1)?.provider).toBe("openai");
	});

	it("fallback no duplica al provider del efectivo ni providers sin modelos", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "ollama", modelId: "llama3.2" },
					fallback: ["ollama", "openai"],
				},
				CATALOG,
			),
		);
		const providers = r.default.chain.map((c) => c.provider);
		expect(providers).toEqual(["ollama", "frida-enterprise"]); // openai no authed, ollama no se repite
	});

	it("smol con cadena propia (fallback aplica por rol)", () => {
		const r = resolveModelRoles(
			input(
				{
					default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
					smol: { provider: "ollama", modelId: "llama3.2" },
					fallback: ["frida-enterprise"],
				},
				CATALOG,
			),
		);
		expect(r.smol.chain[0]).toEqual({ provider: "ollama", modelId: "llama3.2" });
		expect(r.smol.chain[1]?.provider).toBe("frida-enterprise");
	});

	describe("switch maestro (#121): OFF = modo clásico, una sola acción", () => {
		it("todo resuelve al modelo activo aunque haya roles/fallback configurados", () => {
			const r = resolveModelRoles(
				input(
					{
						enabled: false,
						default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
						smol: { provider: "ollama", modelId: "llama3.2" },
						fallback: [],
					},
					CATALOG,
				),
			);
			// Todos al modelo activo, cadena de 1, nada de routing.
			expect(r.smol.effective).toEqual(r.default.effective);
			expect(r.commit.effective).toEqual(r.default.effective);
			expect(r.default.chain).toHaveLength(1);
			expect(r.smol.chain).toHaveLength(1);
		});

		it("OFF con modelo activo muerto → misma caída de emergencia que siempre", () => {
			const r = resolveModelRoles(
				input(
					{
						enabled: false,
						default: { provider: "openai", modelId: "gpt-5.2" },
					},
					CATALOG,
				),
			);
			expect(r.default.effective?.provider).toBe("frida-enterprise");
		});

		it("ON (o ausente para compat) → routing normal", () => {
			const base = {
				default: {
					provider: "frida-enterprise",
					modelId: "claude-sonnet-4-5",
				} as const,
				smol: { provider: "ollama", modelId: "llama3.2" } as const,
			};
			const on = resolveModelRoles(input({ ...base, enabled: true }, CATALOG));
			expect(on.smol.effective?.provider).toBe("ollama");
			// ausente = como ON (el default del setting es false, pero el resolvedor
			// solo entra a modo clásico con false explícito)
			const absent = resolveModelRoles(input({ ...base }, CATALOG));
			expect(absent.smol.effective?.provider).toBe("ollama");
		});
	});

	it("roleTag estable para atribución", () => {
		expect(roleTag("smol")).toBe("role:smol");
		expect(roleTag("default")).toBe("role:default");
	});
});

describe("#121 — pickChildModel / pickStartupFallback (wiring puro)", () => {
	const cfgOn = {
		enabled: true,
		default: { provider: "frida-enterprise", modelId: "claude-sonnet-4-5" },
		smol: { provider: "ollama", modelId: "llama3.2" },
		fallback: [] as string[],
	};
	const models: Record<string, unknown> = {
		"frida-enterprise/claude-sonnet-4-5": { id: "claude-sonnet-4-5" },
		"ollama/llama3.2": { id: "llama3.2" },
		"ollama/qwen2.5-coder": { id: "qwen2.5-coder" },
	};
	const getModel = (p: string, m: string) => models[`${p}/${m}`] ?? undefined;

	it("pickChildModel: roles OFF → null (modelo de la sesión padre, clásico)", () => {
		const res = resolveModelRoles({ config: cfgOn, authedCatalog: CATALOG });
		expect(
			pickChildModel({ ...cfgOn, enabled: false }, res, getModel),
		).toBeNull();
	});

	it("pickChildModel: smol explícito + ON → modelo Ollama para las hijas", () => {
		const res = resolveModelRoles({ config: cfgOn, authedCatalog: CATALOG });
		expect(pickChildModel(cfgOn, res, getModel)).toEqual({ id: "llama3.2" });
	});

	it("pickChildModel: smol heredado → null (no duplica el default)", () => {
		const cfg = { ...cfgOn, smol: null };
		const res = resolveModelRoles({ config: cfg, authedCatalog: CATALOG });
		expect(pickChildModel(cfg, res, getModel)).toBeNull();
	});

	it("pickStartupFallback: OFF o sin fallback → null", () => {
		const res = resolveModelRoles({ config: cfgOn, authedCatalog: CATALOG });
		expect(
			pickStartupFallback({ ...cfgOn, enabled: false }, res, getModel),
		).toBeNull();
		const res2 = resolveModelRoles({
			config: { ...cfgOn, fallback: null },
			authedCatalog: CATALOG,
		});
		expect(
			pickStartupFallback({ ...cfgOn, fallback: null }, res2, getModel),
		).toBeNull();
	});

	it("pickStartupFallback: ON + cadena → primer respaldo disponible (Ollama)", () => {
		const res = resolveModelRoles({ config: cfgOn, authedCatalog: CATALOG });
		// chain = [enterprise/sonnet, ollama/qwen2.5-coder]
		expect(pickStartupFallback(cfgOn, res, getModel)).toEqual({
			id: "qwen2.5-coder",
		});
	});
});
