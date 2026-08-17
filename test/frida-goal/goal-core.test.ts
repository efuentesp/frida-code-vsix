// frida-goal (#20) — tests de las piezas puras: parser de /goal, guards de
// estado (no-progreso, clasificación de errores, restauración) y prompts.
import { describe, expect, it } from "vitest";
import {
	parseCommand,
	parseTokenBudget,
	splitObjectiveTokens,
	tokenize,
	validateObjective,
} from "../../src/tools/frida-goal/command";
import {
	classifyAssistantError,
	createGoal,
	fingerprintAssistantText,
	hasAssistantToolCall,
	nextToolFreeRepeatState,
	normalizeLoadedGoal,
	resetSafetyEpoch,
} from "../../src/tools/frida-goal/state";
import {
	appendGoalPromptMarker,
	buildContinuePrompt,
	buildGoalPrompt,
	buildGoalSystemPrompt,
	buildResumePrompt,
	extractContinuationMarker,
	extractGoalPromptMarker,
} from "../../src/tools/frida-goal/prompts";
import {
	loadGoalFromSession,
	serializeGoalState,
} from "../../src/tools/frida-goal/persistence";

describe("frida-goal · command (#20)", () => {
	it("parsea subcomandos sin args", () => {
		expect(parseCommand("")).toEqual({ kind: "show" });
		expect(parseCommand("status")).toEqual({ kind: "show" });
		expect(parseCommand("pause")).toEqual({ kind: "pause" });
		expect(parseCommand("resume")).toEqual({ kind: "resume" });
		expect(parseCommand("clear")).toEqual({ kind: "clear" });
		expect(parseCommand("stop")).toEqual({ kind: "clear" });
	});
	it("subcomando con args extra → usage", () => {
		expect(parseCommand("pause ahora")).toBe("Uso: /goal pause");
		expect(parseCommand("resume ya")).toBe("Uso: /goal resume");
	});
	it("start con objetivo y --tokens", () => {
		expect(parseCommand("migrar tests --tokens 100k")).toEqual({
			kind: "start",
			objective: "migrar tests",
			tokenBudget: 100_000,
		});
		expect(parseCommand('  "migra los 47 tests"  ')).toEqual({
			kind: "start",
			objective: "migra los 47 tests",
			tokenBudget: undefined,
		});
	});
	it("edit con nuevo objetivo", () => {
		expect(parseCommand("edit ahora haz esto otro --tokens=2m")).toEqual({
			kind: "edit",
			objective: "ahora haz esto otro",
			tokenBudget: 2_000_000,
		});
	});
	it("objetivo vacío (sólo --tokens) → mensaje de objetivo vacío", () => {
		expect(parseCommand("--tokens 100k")).toBe(
			"El objetivo no puede estar vacío.",
		);
	});
	it("parseTokenBudget: N, Nk, Nm, inválidos", () => {
		expect(parseTokenBudget("100k")).toBe(100_000);
		expect(parseTokenBudget("2m")).toBe(2_000_000);
		expect(parseTokenBudget("150000")).toBe(150_000);
		expect(parseTokenBudget("0")).toBeUndefined();
		expect(parseTokenBudget("abc")).toBeUndefined();
		expect(parseTokenBudget("-5k")).toBeUndefined();
	});
	it("validateObjective: vacío, marcadores, largo", () => {
		expect(validateObjective("   ")).toBeTruthy();
		expect(
			validateObjective("x <!-- frida-goal-prompt:abc --> y"),
		).toBeTruthy();
		expect(validateObjective("a".repeat(4001))).toBeTruthy();
		expect(validateObjective("objetivo válido")).toBeUndefined();
	});
	it("tokenize respeta comillas", () => {
		expect(tokenize('a "b c" \'d e\'')).toEqual(["a", "b c", "d e"]);
	});
	it("splitObjectiveTokens extrae --tokens inline y separado", () => {
		expect(splitObjectiveTokens(["obj", "--tokens=5k"])).toEqual({
			objective: "obj",
			tokenBudget: 5000,
		});
		expect(splitObjectiveTokens(["obj", "--tokens", "5k"])).toEqual({
			objective: "obj",
			tokenBudget: 5000,
		});
		expect(splitObjectiveTokens(["--tokens"])).toMatch(/--tokens/);
	});
});

describe("frida-goal · guards de estado (#20)", () => {
	const goal = () =>
		createGoal("objetivo de prueba", undefined, 10_000);

	it("fingerprint: sensible a texto, inmune a whitespace/caso", () => {
		const msgs = [
			{ role: "assistant", content: [{ type: "text", text: "Hola  Mundo" }] },
		];
		const msgs2 = [
			{ role: "assistant", content: [{ type: "text", text: "hola mundo" }] },
		];
		expect(fingerprintAssistantText(msgs)).toBe(fingerprintAssistantText(msgs2));
		expect(fingerprintAssistantText(msgs)).not.toBe(
			fingerprintAssistantText([
				{ role: "assistant", content: [{ type: "text", text: "otra cosa" }] },
			]),
		);
	});

	it("hasAssistantToolCall detecta toolCall en assistant", () => {
		expect(
			hasAssistantToolCall([
				{
					role: "assistant",
					content: [{ type: "toolCall", name: "bash" }],
				},
			]),
		).toBe(true);
		expect(
			hasAssistantToolCall([
				{ role: "assistant", content: [{ type: "text", text: "hola" }] },
			]),
		).toBe(false);
	});

	it("nextToolFreeRepeatState: tools resetean; texto igual acumula", () => {
		const g = goal();
		const textMsgs = [
			{ role: "assistant", content: [{ type: "text", text: "sin ideas" }] },
		];
		const s1 = nextToolFreeRepeatState(g, textMsgs);
		expect(s1.toolFreeRepeatCount).toBe(1);
		const g2 = { ...g, ...s1 };
		const s2 = nextToolFreeRepeatState(g2, textMsgs);
		expect(s2.toolFreeRepeatCount).toBe(2);
		// Un run con tools resetea el contador.
		const g3 = { ...g, ...s2 };
		const s3 = nextToolFreeRepeatState(g3, [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "avancé" },
					{ type: "toolCall", name: "read" },
				],
			},
		]);
		expect(s3.toolFreeRepeatCount).toBe(0);
	});

	it("classifyAssistantError: aborted/quota/red/bloqueo/none", () => {
		expect(classifyAssistantError(undefined)).toBe("none");
		expect(classifyAssistantError({ stopReason: "stop" })).toBe("none");
		expect(classifyAssistantError({ stopReason: "aborted" })).toBe("aborted");
		expect(
			classifyAssistantError({ stopReason: "error", errorMessage: "Quota exceeded" }),
		).toBe("usage_limited");
		expect(
			classifyAssistantError({ stopReason: "error", errorMessage: "fetch failed" }),
		).toBe("retryable");
		expect(
			classifyAssistantError({
				stopReason: "error",
				errorMessage: "Invalid API key",
			}),
		).toBe("blocked");
	});

	it("resetSafetyEpoch limpia contadores", () => {
		const g = {
			...goal(),
			automaticModelTurns: 10,
			toolFreeRepeatCount: 2,
			blockedAttempts: 1,
		};
		const r = resetSafetyEpoch(g);
		expect(r.automaticModelTurns).toBe(0);
		expect(r.toolFreeRepeatCount).toBe(0);
		expect(r.blockedAttempts).toBe(0);
	});

	it("normalizeLoadedGoal: completo/inválido → undefined; válido pasa", () => {
		expect(normalizeLoadedGoal({ status: "complete" })).toBeUndefined();
		expect(normalizeLoadedGoal("no soy goal")).toBeUndefined();
		expect(normalizeLoadedGoal({ status: "weird" })).toBeUndefined();
		const g = goal();
		const restored = normalizeLoadedGoal({
			...g,
			status: "paused",
			pausedReason: "x",
		});
		expect(restored?.status).toBe("paused");
		expect(restored?.pausedReason).toBe("x");
	});
});

describe("frida-goal · prompts (#20)", () => {
	const goal = () => createGoal("migrar los 47 tests", 100_000, 500);

	it("goal prompt embebe objetivo, goal_id y budget con escape", () => {
		const p = buildGoalPrompt(goal());
		expect(p).toContain("<goal_objective>");
		expect(p).toContain("migrar los 47 tests");
		expect(p).toContain("<goal_id>");
		expect(p).toContain("Token budget: 100k.");
		// Trust boundary antes del objetivo.
		expect(p.indexOf("user-provided task data")).toBeLessThan(
			p.indexOf("<goal_objective>"),
		);
	});

	it("continue prompt lleva marcador extraíble", () => {
		// En el flujo real, iteration ya fue incrementado en agent_end antes
		// de construir la continuación (pending + settled).
		const g = { ...goal(), iteration: 3 };
		const p = buildContinuePrompt(g, `${g.id}#3`);
		expect(p).toContain("automatic continuation #3");
		const marker = extractContinuationMarker(p);
		expect(marker).toBe(`${g.id}#3`);
		expect(extractContinuationMarker("texto sin marcador")).toBeUndefined();
	});

	it("goal prompt marker round-trip", () => {
		const g = goal();
		const p = appendGoalPromptMarker(buildGoalPrompt(g), g.id);
		expect(extractGoalPromptMarker(p)).toBe(g.id);
	});

	it("resume y system prompt", () => {
		const g = { ...goal(), tokensUsed: 40_000 };
		expect(buildResumePrompt(g)).toContain("explicitly resumed");
		expect(buildGoalSystemPrompt(g)).toContain("Active /goal:");
		expect(buildGoalSystemPrompt(g)).toContain("40k/100k");
	});
});

describe("frida-goal · persistence (#20)", () => {
	it("serialize → load round-trip desde entries custom", () => {
		const g = { ...createGoal("persistir", undefined, 0), status: "paused" as const };
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{ type: "custom", customType: "frida-goal-state", data: serializeGoalState(g) },
				],
			},
		};
		const loaded = loadGoalFromSession(ctx);
		expect(loaded?.id).toBe(g.id);
		expect(loaded?.status).toBe("paused");
	});

	it("sin entries → undefined; complete no se restaura", () => {
		expect(loadGoalFromSession({ sessionManager: {} })).toBeUndefined();
		const done = { ...createGoal("x", undefined, 0), status: "complete" as const };
		const ctx = {
			sessionManager: {
				getEntries: () => [
					{ type: "custom", customType: "frida-goal-state", data: serializeGoalState(done) },
				],
			},
		};
		expect(loadGoalFromSession(ctx)).toBeUndefined();
	});
});
