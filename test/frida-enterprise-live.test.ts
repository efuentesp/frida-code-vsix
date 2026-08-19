import { describe, expect, it } from "vitest";

/**
 * Smoke de producción opt-in para cada modelo que el provider anuncia como chat.
 * No corre en la suite normal: requiere FRIDA_ENTERPRISE_LIVE=1 y reutiliza la
 * credential local de ~/.frida/auth.json sin imprimir tokens.
 *
 * Uso:
 *   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise-live.test.ts
 */

type Credential = {
	access?: string;
	compatibleApiUrl?: string;
	envVars?: { COMPATIBLE_API_URL?: string };
};

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";

describe.skipIf(!live)("Frida Enterprise live model smoke", () => {
	it("cada modelo chat publicado responde por /v1/chat/completions", async () => {
		const fs = await import("node:fs/promises");
		const path = `${process.env.HOME}/.frida/auth.json`;
		const auth = JSON.parse(await fs.readFile(path, "utf8"));
		const credential = auth["frida-enterprise"] as Credential | undefined;
		expect(credential?.access).toBeTruthy();

		const root = (
			credential?.compatibleApiUrl ??
			credential?.envVars?.COMPATIBLE_API_URL ??
			""
		).replace(/\/$/, "");
		expect(root).toMatch(/^https?:\/\//);
		const claims = JSON.parse(
			Buffer.from(credential!.access!.split(".")[1], "base64url").toString(),
		);
		const identity = {
			user_id: claims.user_id ?? claims.sub,
			email: claims.email,
			auto_log: true,
		};

		const catalogResponse = await fetch(`${root}/v1/models`, {
			headers: { Authorization: `Bearer ${credential!.access}` },
		});
		expect(catalogResponse.ok).toBe(true);
		const catalog = (await catalogResponse.json()) as {
			data?: Array<{ id?: string; capabilities?: unknown[] }>;
		};
		const models = (catalog.data ?? []).filter(
			(model) =>
				typeof model.id === "string" &&
				Array.isArray(model.capabilities) &&
				model.capabilities.some((cap) => String(cap).toLowerCase() === "chat"),
		);
		expect(models.length).toBeGreaterThan(0);

		const failures: string[] = [];
		for (const model of models) {
			const response = await fetch(`${root}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${credential!.access}`,
				},
				body: JSON.stringify({
					model: model.id,
					messages: [{ role: "user", content: "Responde solo: pong" }],
					stream: false,
					max_tokens: 16,
					...identity,
				}),
			});
			if (!response.ok) {
				failures.push(`${model.id}: HTTP ${response.status}`);
				await response.text();
			}
		}
		expect(failures, failures.join("; ")).toEqual([]);
	}, 120_000);
});
