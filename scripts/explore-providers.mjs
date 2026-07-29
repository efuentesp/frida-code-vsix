// Exploración Fase 0 (ADR-0018): reproduce el ModelRuntime de Frida (~/.frida) y
// loguea qué proveedores aparecen con getProviders(), su auth (oauth/apiKey), el
// estado de auth (getProviderAuthStatus) y los modelos por proveedor. Define el
// alcance exacto de la Fase 1 (selector dinámico).
//
// Uso: node scripts/explore-providers.mjs [--refresh]
//   --refresh  además ejecuta refresh({allowNetwork:true}) con timeout 15s (hace
//              GET /models real a cada proveedor configurado). Sin la flag, sólo
//              catálogo cacheado/built-in (sin red).
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const doRefresh = process.argv.includes("--refresh");
const agentDir = path.join(os.homedir(), ".frida");

// Config mínima de softtek-devengine (igual que buildSofttekProviderConfig).
const SOFTTEK_PROVIDER = "softtek-devengine";
const softtekConfig = {
	name: "Softtek DevEngine Gateway",
	baseUrl: "https://mywork.softtek.com/apg/devengine",
	api: "openai-completions",
	authHeader: false,
	models: [
		{
			id: "gpt-5.4-mini",
			name: "GPT-5.4 Mini",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 300000,
			maxTokens: 128000,
			compat: { supportsReasoningEffort: true },
		},
	],
};

(async () => {
	console.log(`\n=== Exploración providers (ADR-0018 Fase 0) ===`);
	console.log(`agentDir: ${agentDir}`);
	console.log(
		`refresh con red: ${doRefresh ? "SÍ" : "no (sólo cache/built-in)"}`,
	);

	const mr = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
		modelsStorePath: path.join(agentDir, "models-store.json"),
		allowModelNetwork: doRefresh,
	});
	mr.registerProvider(SOFTTEK_PROVIDER, softtekConfig);

	const providers = mr.getProviders();
	console.log(`\n--- getProviders(): ${providers.length} proveedor(es) ---`);
	for (const p of providers) {
		const status = mr.getProviderAuthStatus(p.id);
		const models = mr.getModels(p.id);
		console.log(
			`\n• ${p.id}  "${p.name}"\n` +
				`    auth: oauth=${!!p.auth?.oauth}  apiKey=${!!p.auth?.apiKey}\n` +
				`    status: configured=${status.configured}  source=${status.source ?? "-"}  label=${status.label ?? "-"}\n` +
				`    modelos: ${models.length}` +
				(models.length > 0 && models.length <= 8
					? ` [${models.map((m) => m.id).join(", ")}]`
					: ""),
		);
	}

	const snapshot = mr.getAvailableSnapshot();
	const byProvider = new Map();
	for (const m of snapshot)
		byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + 1);
	console.log(
		`\n--- getAvailableSnapshot(): ${snapshot.length} modelo(s) usables (provider autenticado) ---`,
	);
	for (const [pid, n] of byProvider) console.log(`    ${pid}: ${n}`);

	if (mr.getError()) console.log(`\ngetError(): ${mr.getError()}`);

	if (doRefresh) {
		console.log(`\n--- refresh({allowNetwork:true}) ---`);
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 15000);
		try {
			const res = await mr.refresh({ allowNetwork: true, signal: ctrl.signal });
			console.log(`  aborted=${res.aborted}  errors=${res.errors.size}`);
			for (const [pid, err] of res.errors)
				console.log(
					`    ✗ ${pid}: ${err instanceof Error ? err.message : err}`,
				);
		} catch (e) {
			console.log(`  EXCEPCIÓN: ${e}`);
		} finally {
			clearTimeout(timer);
		}
	}
	console.log(`\n=== fin ===\n`);
})().catch((e) => {
	console.error("Error:", e);
	process.exit(1);
});
