import { describe, expect, it } from "vitest";
import {
	daemonBase,
	discoverOllamaLocalModels,
	type FetchLike,
} from "../../src/providers/frida-ollama-local/discover";

const TAGS_BODY = {
	models: [
		{
			name: "llama3.2:latest",
			details: { family: "llama", families: ["llama"] },
		},
		{
			name: "nomic-embed-text:latest",
			details: { family: "nomic-bert" },
		},
	],
};

function res(body: unknown, ok = true): { ok: boolean; json(): Promise<unknown> } {
	return { ok, json: async () => body };
}

describe("#123 — discoverOllamaLocalModels (fetch inyectable)", () => {
	it("daemonBase normaliza esquema, puerto y /v1", () => {
		expect(daemonBase("localhost:11434")).toBe("http://localhost:11434");
		expect(daemonBase("http://host:11434/v1/")).toBe("http://host:11434");
	});

	it("descubre chat + enriquece con /api/show (tools + context_length)", async () => {
		const calls: string[] = [];
		const f: FetchLike = async (url, init) => {
			calls.push(`${init?.method ?? "GET"} ${url}`);
			if (url.endsWith("/api/tags")) return res(TAGS_BODY);
			if (url.endsWith("/api/show")) {
				expect(init?.body).toContain("llama3.2");
				return res({
					capabilities: ["tools"],
					model_info: { "llama.context_length": 131_072 },
				});
			}
			return res({}, false);
		};
		const defs = await discoverOllamaLocalModels("localhost:11434", f);
		// solo pregunta /api/show por el modelo de chat (embeddings filtrado antes)
		expect(calls).toEqual([
			"GET http://localhost:11434/api/tags",
			"POST http://localhost:11434/api/show",
		]);
		expect(defs).toHaveLength(1);
		expect(defs[0]?.id).toBe("llama3.2:latest");
		expect(defs[0]?.contextWindow).toBe(131_072);
	});

	it("fail-soft: /api/show que falla NO descarta el modelo (defaults)", async () => {
		const f: FetchLike = async (url) => {
			if (url.endsWith("/api/tags")) return res(TAGS_BODY);
			return res({}, false); // show falla
		};
		const defs = await discoverOllamaLocalModels("localhost:11434", f);
		expect(defs).toHaveLength(1);
		expect(defs[0]?.contextWindow).toBe(8_192); // default local
	});

	it("daemon caído (tags !ok) lanza → el caller registra vacío", async () => {
		const f: FetchLike = async () => res({}, false);
		await expect(
			discoverOllamaLocalModels("localhost:11434", f),
		).rejects.toThrow();
	});

	it("show sin capability tools descarta el modelo", async () => {
		const f: FetchLike = async (url) => {
			if (url.endsWith("/api/tags")) return res(TAGS_BODY);
			return res({ capabilities: ["completion"] });
		};
		const defs = await discoverOllamaLocalModels("localhost:11434", f);
		expect(defs).toEqual([]);
	});
});
