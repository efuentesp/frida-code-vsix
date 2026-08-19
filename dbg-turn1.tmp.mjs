// debug: eventos crudos del stream responses turn-1 contra el gateway vivo
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// compilar adapter para usar buildFridaPayload real
await require("esbuild").build({
	entryPoints: [path.resolve("src/providers/frida-enterprise/index.ts")],
	bundle: true, platform: "node", format: "esm",
	external: ["@earendil-works/*"],
	outfile: "/tmp/fe-bundle.mjs",
});
const { buildFridaPayload } = await import("file:///tmp/fe-bundle.mjs");
// stream responses real de pi-ai
const PIAI = "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js";
const { stream } = await import(path.resolve(PIAI));

const auth = JSON.parse(await fs.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"));
const cred = auth["frida-enterprise"];
const root = cred.compatibleApiUrl.replace(/\/$/, "");
const claims = JSON.parse(Buffer.from(cred.access.split(".")[1], "base64url").toString());
const identity = { user_id: claims.user_id ?? claims.sub, email: claims.email };

const TOOL = [{
	type: "function", name: "get_weather", description: "Clima de una ciudad",
	parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];

let lastPayload = null;
const s = stream(
	{ id: "DEMETER-BLOOM", provider: "frida-enterprise", api: "openai-responses",
	  baseUrl: `${root}/v1`, contextWindow: 1_000_000, maxTokens: 4096, reasoning: true,
	  input: ["text","image"], cost: { input:0, output:0, cacheRead:0, cacheWrite:0 } },
	{ messages: [{ role: "user", content: [{ type: "text", text: "Usa get_weather para el clima de CDMX. Una línea." }] }], tools: TOOL },
	{ apiKey: cred.access, maxTokens: 400, reasoning: "low",
	  onPayload: (p) => { lastPayload = buildFridaPayload(p, identity); return lastPayload; } },
);
const events = [];
for await (const ev of s) {
	events.push(ev.type);
	if (ev.type === "error") console.log("ERROR EVENT:", JSON.stringify(ev).slice(0, 300));
	if (ev.type === "done") console.log("DONE stop:", ev.message?.stopReason, "blocks:", (ev.message?.content??[]).map(b=>b.type).join(","));
}
console.log("eventos:", events.join(" "));
console.log("payload keys:", lastPayload ? Object.keys(lastPayload).join(",") : "null");
