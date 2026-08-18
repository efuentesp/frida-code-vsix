// Errata-9 (TDD): el compact usa streamFunction (sdk.js) sin onPayload —
// estos tests exigen que el patch de canales laterales lo compense.

import { describe, expect, it } from "vitest";
import { patchFridaSideChannels } from "../../src/providers/frida-enterprise/side-channels";
import { createFridaEnterpriseRuntime } from "../../src/providers/frida-enterprise/runtime";

function makeIdToken(claims: object) {
	return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}
const ID_TOKEN = makeIdToken({ user_id: "uid-9", email: "e9@softtek.com" });

describe("patchFridaSideChannels (Errata-9: compact sin onPayload)", () => {
	it("inyecta onPayload en streamSimple para modelo frida sin onPayload (camino compact)", () => {
		const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY"]);
		runtime.rememberToken(ID_TOKEN);

		const calls: any[] = [];
		const modelRuntime: any = {
			streamSimple(model: any, context: any, options: any) {
				calls.push({ model, context, options });
				return { fake: "stream" };
			},
			completeSimple(model: any, context: any, options: any) {
				calls.push({ model, context, options });
				return { fake: "complete" };
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m) => m.provider === "frida-enterprise",
		});

		const out = modelRuntime.streamSimple(
			{ id: "NIKE-VICTORY", provider: "frida-enterprise" },
			{ messages: [] },
			{ apiKey: "T" }, // SIN onPayload — como el compact
		);
		expect(out).toEqual({ fake: "stream" });
		expect(typeof calls[0].options.onPayload).toBe("function");

		// El payload inyectado traduce developer→system e inyecta identidad
		const payload = calls[0].options.onPayload({
			model: "NIKE-VICTORY",
			messages: [{ role: "developer", content: "sys" }],
		});
		expect(payload.messages[0].role).toBe("system");
		expect(payload.user_id).toBe("uid-9");
		expect(payload.auto_log).toBe(true);
	});

	it("NO toca otros providers (zai pasa igual, sin onPayload añadido)", () => {
		const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY"]);
		runtime.rememberToken(ID_TOKEN);
		const calls: any[] = [];
		const modelRuntime: any = {
			streamSimple(model: any, context: any, options: any) {
				calls.push({ model, options });
				return {};
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m) => m.provider === "frida-enterprise",
		});
		modelRuntime.streamSimple(
			{ id: "glm-5.2", provider: "zai" },
			{ messages: [] },
			{ apiKey: "T" },
		);
		expect(calls[0].options.onPayload).toBeUndefined();
	});

	it("NO duplica si YA hay onPayload (camino normal del Agent intacto)", () => {
		const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY"]);
		runtime.rememberToken(ID_TOKEN);
		const calls: any[] = [];
		const mine = async (p: any) => p;
		const modelRuntime: any = {
			streamSimple(model: any, context: any, options: any) {
				calls.push({ options });
				return {};
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m) => m.provider === "frida-enterprise",
		});
		modelRuntime.streamSimple(
			{ id: "NIKE-VICTORY", provider: "frida-enterprise" },
			{ messages: [] },
			{ apiKey: "T", onPayload: mine },
		);
		expect(calls[0].options.onPayload).toBe(mine); // la misma, sin envolver
	});

	it("completeSimple también queda cubierto (branch-summary)", () => {
		const runtime = createFridaEnterpriseRuntime(["SELENE-CIPHER"]);
		runtime.rememberToken(ID_TOKEN);
		const calls: any[] = [];
		const modelRuntime: any = {
			streamSimple() {
				return {};
			},
			completeSimple(model: any, context: any, options: any) {
				calls.push({ options });
				return {};
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m) => m.provider === "frida-enterprise",
		});
		modelRuntime.completeSimple(
			{ id: "SELENE-CIPHER", provider: "frida-enterprise" },
			{ messages: [] },
			{ apiKey: "T" },
		);
		expect(typeof calls[0].options.onPayload).toBe("function");
	});

	it("sin identidad vista: NO inyecta (respuesta original, sin envolver)", () => {
		const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY"]); // sin rememberToken
		const calls: any[] = [];
		const modelRuntime: any = {
			streamSimple(model: any, context: any, options: any) {
				calls.push({ options });
				return {};
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m) => m.provider === "frida-enterprise",
		});
		modelRuntime.streamSimple(
			{ id: "NIKE-VICTORY", provider: "frida-enterprise" },
			{ messages: [] },
			{ apiKey: "T" },
		);
		expect(calls[0].options.onPayload).toBeUndefined();
	});
});
