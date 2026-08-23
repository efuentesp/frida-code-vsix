import { describe, expect, it } from "vitest";
import {
	OLLAMA_PROVIDER,
	OLLAMA_PROVIDER_DISPLAY,
	buildOllamaProviderConfig,
	filterVisibleChatProviders,
	parseTagsResponse,
	type OllamaTagsResponse,
} from "../../src/providers/frida-ollama-local/catalog";
import { providerLocationTag } from "../../webview/components/ModelPanel";

const TAGS: OllamaTagsResponse = {
	models: [
		{
			// chat normal, dedup con el siguiente
			name: "llama3.2:latest",
			details: { family: "llama", families: ["llama"] },
		},
		{ name: "llama3.2:latest", details: { family: "llama" } },
		{
			// visión (families incluye clip)
			name: "llama3.2-vision:11b",
			details: { family: "mllama", families: ["llama", "clip", "mllama"] },
		},
		{
			// embeddings — debe EXCLUIRSE (caso real del usuario: nomic-embed-text)
			name: "nomic-embed-text:latest",
			details: { family: "nomic-bert", families: ["nomic-bert"] },
		},
		{ name: "", details: { family: "llama" } }, // vacío: se ignora
	],
};

describe("#123 — parser de /api/tags (proveedor Ollama local)", () => {
	it("convierte modelos de chat, deduplica y excluye embeddings", () => {
		const defs = parseTagsResponse(TAGS);
		expect(defs.map((d) => d.id)).toEqual([
			"llama3.2:latest",
			"llama3.2-vision:11b",
		]);
		// embeddings fuera (el daemon del usuario solo tiene nomic-embed → lista vacía)
		expect(
			parseTagsResponse({
				models: [
					{ name: "nomic-embed-text:latest", details: { family: "nomic-bert" } },
				],
			}),
		).toEqual([]);
	});

	it("visión por families clip/mllama; texto plano si no", () => {
		const defs = parseTagsResponse(TAGS);
		expect(defs[0]?.input).toEqual(["text"]);
		expect(defs[1]?.input).toEqual(["text", "image"]);
	});

	it("contextWindow desde /api/show cuando existe; default si no", () => {
		const defs = parseTagsResponse(TAGS, {
			"llama3.2:latest": {
				capabilities: ["tools"],
				model_info: { "llama.context_length": 131_072 },
			},
		});
		expect(defs[0]?.contextWindow).toBe(131_072);
		expect(defs[1]?.contextWindow).toBe(8_192); // default local
	});

	it("modelo cuyo /api/show no declara tools se excluye", () => {
		const defs = parseTagsResponse(TAGS, {
			"llama3.2:latest": { capabilities: ["completion"] },
		});
		expect(defs.map((d) => d.id)).toEqual(["llama3.2-vision:11b"]);
	});

	it("costo cero (local) y provider config con compat flags", () => {
		const defs = parseTagsResponse(TAGS);
		expect(defs[0]?.cost).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		const cfg = buildOllamaProviderConfig("http://localhost:11434", defs);
		expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
		expect(cfg.api).toBe("openai-completions");
		expect(cfg.apiKey).toBe("ollama"); // placeholder
		expect(cfg.compat).toEqual({
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
		});
		expect(cfg.models).toHaveLength(2);
	});

	it("normaliza OLLAMA_HOST sin esquema, con /v1 y con slash final", () => {
		expect(buildOllamaProviderConfig("localhost:11434", []).baseUrl).toBe(
			"http://localhost:11434/v1",
		);
		expect(buildOllamaProviderConfig("http://host:11434/v1/", []).baseUrl).toBe(
			"http://host:11434/v1",
		);
		expect(buildOllamaProviderConfig("http://host:11434/", []).baseUrl).toBe(
			"http://host:11434/v1",
		);
	});

	it("ids/export estables", () => {
		expect(OLLAMA_PROVIDER).toBe("ollama");
		expect(OLLAMA_PROVIDER_DISPLAY).toBe("Ollama (local)");
	});
});

describe("#122/#123 — etiqueta de ubicación local vs nube en las filas", () => {
	it("ollama → local con icono de máquina; ollama-cloud → nube", () => {
		expect(providerLocationTag("ollama")).toEqual({
			label: "local",
			icon: "device-desktop",
		});
		expect(providerLocationTag("ollama-cloud")).toEqual({
			label: "nube",
			icon: "cloud",
		});
	});

	it("otros proveedores no llevan etiqueta (sin ruido)", () => {
		expect(providerLocationTag("frida-enterprise")).toBeNull();
		expect(providerLocationTag("openai")).toBeNull();
	});
});

describe("#123 — filterVisibleChatProviders (ocultar ollama sin modelos)", () => {
	const base = ["frida-enterprise", "ollama", "openai"];

	it("ollama SIN modelos de chat se oculta de las listas", () => {
		expect(
			filterVisibleChatProviders(base, (id) => id !== "ollama"),
		).toEqual(["frida-enterprise", "openai"]);
	});

	it("ollama CON modelos visible (tras ollama pull)", () => {
		expect(filterVisibleChatProviders(base, () => true)).toEqual(base);
	});

	it("otros proveedores siempre visibles aunque no tengan modelos", () => {
		expect(filterVisibleChatProviders(["openai", "zai"], () => false)).toEqual([
			"openai",
			"zai",
		]);
	});
});
