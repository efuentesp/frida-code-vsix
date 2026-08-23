import { describe, expect, it } from "vitest";
import {
	discoverOllamaCloudModels,
	type FetchLike,
} from "../../src/providers/frida-ollama-cloud/discover";
import { OLLAMA_CLOUD_BASE_URL } from "../../src/providers/frida-ollama-cloud/catalog";

function res(
	body: unknown,
	ok = true,
): { ok: boolean; json(): Promise<unknown> } {
	return { ok, json: async () => body };
}

const LIST = {
	data: [{ id: "qwen3:32b" }, { id: "gpt-oss:20b" }, { id: "nomic-embed" }],
};

describe("#122 — discoverOllamaCloudModels (fetch inyectable)", () => {
	it("lista pública + /api/show por modelo; solo tools se registran", async () => {
		const calls: string[] = [];
		const f: FetchLike = async (url, init) => {
			calls.push(url);
			if (url.endsWith("/models")) return res(LIST);
			if (url.endsWith("/api/show")) {
				const body = JSON.parse(String(init?.body ?? "{}"));
				if (body.name === "qwen3:32b")
					return res({
						capabilities: ["tools"],
						model_info: { "qwen3.context_length": 262_144 },
					});
				if (body.name === "gpt-oss:20b")
					return res({
						capabilities: ["tools", "thinking", "vision"],
						model_info: {},
					});
				return res({ capabilities: ["embedding"] });
			}
			return res({}, false);
		};
		const defs = await discoverOllamaCloudModels(OLLAMA_CLOUD_BASE_URL, f);
		// nomic-embed (embedding) no genera /api/show… sí lo genera, pero se
		// descarta al parsear (capabilities sin tools → null).
		expect(defs.map((d) => d.id)).toEqual(["qwen3:32b", "gpt-oss:20b"]);
		expect(defs[0]?.contextWindow).toBe(262_144);
		expect(defs[1]?.reasoning).toBe(true);
		expect(defs[1]?.thinkingLevelMap?.off).toBeNull(); // familia gpt-oss
		expect(calls[0]).toBe("https://ollama.com/v1/models");
	});

	it("degradación parcial: /api/show fallido OMITE el modelo (cloud no es fail-soft)", async () => {
		const f: FetchLike = async (url) => {
			if (url.endsWith("/models")) return res(LIST);
			return res({}, false); // todos los shows fallan
		};
		const defs = await discoverOllamaCloudModels(OLLAMA_CLOUD_BASE_URL, f);
		expect(defs).toEqual([]);
	});

	it("/v1/models caído lanza → caller registra vacío", async () => {
		const f: FetchLike = async () => res({}, false);
		await expect(
			discoverOllamaCloudModels(OLLAMA_CLOUD_BASE_URL, f),
		).rejects.toThrow();
	});

	it("lista vacía → [] sin llamar /api/show", async () => {
		const calls: string[] = [];
		const f: FetchLike = async (url) => {
			calls.push(url);
			return res({ data: [] });
		};
		expect(await discoverOllamaCloudModels(OLLAMA_CLOUD_BASE_URL, f)).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});
