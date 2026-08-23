import { describe, expect, it } from "vitest";
import {
	OLLAMA_CLOUD_BASE_URL,
	OLLAMA_CLOUD_DEFAULT_CONTEXT,
	OLLAMA_CLOUD_DISPLAY,
	OLLAMA_CLOUD_MAX_TOKENS,
	OLLAMA_CLOUD_PROVIDER,
	contextLengthFrom,
	modelIdsFromList,
	parseShowResponse,
	thinkingLevelMapFor,
} from "../../src/providers/frida-ollama-cloud/catalog";

const SHOW_TOOLS = {
	capabilities: ["tools"],
	model_info: { "qwen3.context_length": 262_144 },
};
const SHOW_TOOLS_THINKING_VISION = {
	capabilities: ["tools", "thinking", "vision"],
	model_info: { "gptoss.attention.context_length": 131_072 },
};

describe("#122 — catálogo Ollama Cloud (parser /api/show)", () => {
	it("modelo con tools se registra; contexto real; sin thinking maps", () => {
		const def = parseShowResponse("qwen3:32b", SHOW_TOOLS);
		expect(def).toMatchObject({
			id: "qwen3:32b",
			reasoning: false,
			input: ["text"],
			contextWindow: 262_144,
			maxTokens: OLLAMA_CLOUD_MAX_TOKENS,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
		expect(def?.thinkingLevelMap).toBeUndefined();
	});

	it("thinking → reasoning + thinkingLevelMap; vision → input con image", () => {
		const def = parseShowResponse("gpt-oss:20b", SHOW_TOOLS_THINKING_VISION);
		expect(def?.reasoning).toBe(true);
		expect(def?.input).toEqual(["text", "image"]);
		// familia gpt-oss: no se puede apagar el thinking
		expect(def?.thinkingLevelMap).toMatchObject({ off: null, low: "low" });
	});

	it("SIN capability tools → null (no sirve para tool-calling)", () => {
		expect(
			parseShowResponse("nomic-embed", {
				capabilities: ["embedding"],
				model_info: {},
			}),
		).toBeNull();
		expect(parseShowResponse("x", { capabilities: [] })).toBeNull();
	});

	it("sin context_length en model_info → default 128k", () => {
		const def = parseShowResponse("m:1b", {
			capabilities: ["tools"],
			model_info: {},
		});
		expect(def?.contextWindow).toBe(OLLAMA_CLOUD_DEFAULT_CONTEXT);
	});

	it("contextLengthFrom: primera clave *.context_length > 0", () => {
		expect(
			contextLengthFrom({ "llama.attention.context_length": 4096 }),
		).toBe(4096);
		expect(contextLengthFrom({ "a.x": 0, "b.context_length": -1 })).toBeUndefined();
		expect(contextLengthFrom(undefined)).toBeUndefined();
	});
});

describe("#122 — modelIdsFromList (/v1/models)", () => {
	it("extrae ids, recorta, deduplica, ignora basura", () => {
		expect(
			modelIdsFromList({ data: [{ id: " a " }, { id: "a" }, { id: "b" }, {}] }),
		).toEqual(["a", "b"]);
		expect(modelIdsFromList({})).toEqual([]);
	});
});

describe("#122 — thinkingLevelMap por familia (port del plugin)", () => {
	it("DEFAULT: off/low/medium/high/xhigh; minimal oculto (duplica low)", () => {
		const m = thinkingLevelMapFor("algún-modelo-nuevo");
		expect(m).toMatchObject({
			off: "off",
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: null,
		});
	});

	it("GPT_OSS: sin off ni xhigh (thinking no se apaga)", () => {
		const m = thinkingLevelMapFor("gpt-oss:20b");
		expect(m.off).toBeNull();
		expect(m.xhigh).toBeNull();
		expect(m.low).toBe("low");
	});

	it("QWEN3: binario off/medium (vl va a NO_OFF)", () => {
		const m = thinkingLevelMapFor("qwen3:32b");
		expect(m).toMatchObject({ off: "off", low: null, medium: "medium" });
		const vl = thinkingLevelMapFor("qwen3-vl:8b");
		expect(vl).toMatchObject({ off: null, low: "low", medium: "medium" });
	});

	it("GLM 5.2: off/high/xhigh; NO_OFF para kimi-thinking/minimax", () => {
		expect(thinkingLevelMapFor("glm-5.2")).toMatchObject({
			off: "off",
			high: "high",
			xhigh: "xhigh",
		});
		expect(thinkingLevelMapFor("kimi-k2-thinking")).toMatchObject({
			off: null,
			low: "low",
		});
		expect(thinkingLevelMapFor("minimax-m2")).toMatchObject({
			off: null,
			low: "low",
		});
	});

	it("constantes estables", () => {
		expect(OLLAMA_CLOUD_PROVIDER).toBe("ollama-cloud");
		expect(OLLAMA_CLOUD_DISPLAY).toBe("Ollama Cloud");
		expect(OLLAMA_CLOUD_BASE_URL).toBe("https://ollama.com/v1");
	});
});
