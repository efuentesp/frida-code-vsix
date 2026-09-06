// TTSR (#201): coordinator — violación → abort + steer + continue sobre una
// sesión falsa que graba las llamadas (mismo molde que mode-override.test.ts).
import { describe, expect, it, vi } from "vitest";
import { createTtsr } from "../../src/ttsr/coordinator";

/** Sesión falsa: graba el orden de las llamadas. */
function fakeSession(over: Record<string, Error | undefined> = {}) {
	const orden: string[] = [];
	const throws = (name: string) => {
		const e = over[name];
		return async () => {
			if (e) throw e;
			orden.push(name);
		};
	};
	return {
		orden,
		abort: throws("abort"),
		steer: async (text: string) => {
			if (over.steer) throw over.steer;
			orden.push(`steer:${text.slice(0, 40)}`);
		},
		followUp: async (text: string) => {
			if (over.followUp) throw over.followUp;
			orden.push(`followUp:${text.slice(0, 24)}`);
		},
		agent: { continue: throws("continue") },
	};
}

function makeTtsr(over: Partial<Parameters<typeof createTtsr>[0]> = {}) {
	const diags: string[] = [];
	const notices: string[] = [];
	const ttsr = createTtsr({
		diag: (m) => diags.push(m),
		notify: (t) => notices.push(t),
		isEnabled: () => true,
		disabledRules: () => [],
		now: () => 1_000,
		...over,
	});
	return { ttsr, diags, notices };
}

/** message_update con un partial que viola es-mx en texto. */
const deltaEsMx = (text: string) => ({
	type: "message_update",
	message: {},
	assistantMessageEvent: {
		type: "text_delta",
		delta: text,
		partial: { content: [{ type: "text", text }] },
	},
});

const deltaRefs = (text: string) => ({
	type: "message_update",
	message: {},
	assistantMessageEvent: {
		type: "toolcall_delta",
		partial: {
			content: [{ type: "toolCall", name: "commit", arguments: text }],
		},
	},
});

describe("TTSR coordinator: intervención completa", () => {
	it("violación es-mx → abort + steer(reminder) + continue en orden", async () => {
		const s = fakeSession();
		const { ttsr, notices, diags } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("gracias, vosotros podéis continuar"), s);
		// intervene es async void: esperar microtasks.
		await vi.waitFor(() => expect(s.orden.length).toBe(3));
		expect(s.orden[0]).toBe("abort");
		expect(s.orden[1]).toContain("steer:(Recordatorio automático TTSR)");
		expect(s.orden[2]).toBe("continue");
		expect(notices[0]).toContain("TTSR");
		expect(diags.some((d) => d.includes("[ttsr] VIOLACIÓN rule=es-mx"))).toBe(
			true,
		);
	});

	it("violación refs-not-closes en TOOLARGS (commit) también dispara", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr();
		ttsr.handleEvent(deltaRefs('{"message": "feat: x\\n\\nCloses #123"}'), s);
		await vi.waitFor(() => expect(s.orden.length).toBe(3));
		expect(s.orden[2]).toBe("continue");
	});

	it("sin violación: el delta pasa sin tocar la sesión", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("todo bien en español de México"), s);
		await new Promise((r) => setTimeout(r, 10));
		expect(s.orden).toHaveLength(0);
	});

	it("deltas del stream moribundo tras la intervención NO re-disparan", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		await vi.waitFor(() => expect(s.orden.length).toBe(3));
		expect(s.orden).toHaveLength(3); // exactamente 1 intervención
		// Más deltas (el SDK aún emite el parcial mientras muere):
		ttsr.handleEvent(deltaEsMx("vosotros otra vez"), s);
		ttsr.handleEvent(deltaRefs("Closes #9"), s);
		await new Promise((r) => setTimeout(r, 10));
		expect(s.orden).toHaveLength(3); // nada nuevo
	});

	it("abort falla → NO se inyecta nada (lección de #2: sin abort limpio no hay reintento)", async () => {
		const s = fakeSession({ abort: new Error("race timeout") });
		const { ttsr, diags } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		await vi.waitFor(() =>
			expect(diags.some((d) => d.includes("abort() falló"))).toBe(true),
		);
		expect(s.orden).toHaveLength(0); // ni steer ni continue
	});

	it("continue falla (activeRun) → fallback followUp", async () => {
		const s = fakeSession({ continue: new Error("Agent is already processing") });
		const { ttsr, diags } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		await vi.waitFor(() =>
			expect(diags.some((d) => d.includes("followUp"))).toBe(true),
		);
		expect(s.orden).toContain("abort");
		expect(s.orden.some((x) => x.startsWith("followUp:"))).toBe(true);
	});

	it("sin sesión activa: registra la violación y no explota", async () => {
		const { ttsr, diags } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("vosotros"), undefined);
		await vi.waitFor(() =>
			expect(diags.some((d) => d.includes("sin sesión activa"))).toBe(true),
		);
	});
});

describe("TTSR coordinator: settings", () => {
	it("isEnabled=false → no-op total (barato)", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr({ isEnabled: () => false });
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		await new Promise((r) => setTimeout(r, 10));
		expect(s.orden).toHaveLength(0);
	});

	it("disabledRules filtra la regla ofendida", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr({ disabledRules: () => ["es-mx"] });
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		// refs sigue viva: una violación de OTRA regla sí dispara.
		ttsr.handleEvent(deltaRefs("Closes #1"), s);
		await vi.waitFor(() => expect(s.orden.length).toBe(3));
		expect(s.orden).toContain("abort");
	});
});

describe("TTSR coordinator: cadena por prompt", () => {
	it("onUserPrompt resetea: la misma violación re-dispara en la cadena nueva", async () => {
		const s = fakeSession();
		const { ttsr } = makeTtsr();
		ttsr.handleEvent(deltaEsMx("vosotros"), s);
		await vi.waitFor(() => expect(s.orden.length).toBe(3));
		ttsr.handleEvent({ type: "agent_start" }, s); // fin de la ventana intervening
		// Sin prompt nuevo: cooldown 30s bloquea re-intervención inmediata.
		ttsr.handleEvent(deltaEsMx("vosotros de nuevo"), s);
		expect(s.orden).toHaveLength(3);
		// Prompt nuevo del usuario → cadena nueva → dispara otra vez.
		ttsr.onUserPrompt();
		ttsr.handleEvent(deltaEsMx("vosotros de nuevo"), s);
		await vi.waitFor(() => expect(s.orden.length).toBe(6));
	});
});
