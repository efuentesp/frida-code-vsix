// E2E live — REGRESIÓN de los issues del reporte fix-frida-gateway.md.
//
// Gate de aceptación automatizado de los fixes que el equipo DevEngine debe
// implementar. Cada probe replica EXACTAMENTE los casos curl del §4 del
// reporte original (mismo body, mismo contrato), con fetch plano — sin
// adapter ni workarounds de Frida: lo que recibe el gateway es lo que
// recibiría cualquier cliente OpenAI-compatible.
//
// ESTADO ESPERADO HOY: ROJO en P1/P2/P3 (los issues siguen pendientes — los
// workarounds de Frida siguen activos en src/providers/softtek-provider.ts).
// VERDE cuando DevEngine implemente los fixes → Frida podrá quitar los
// workarounds correspondientes (ADR-0009).
//
//   npx vitest run test/devengine/e2e/live-regression.e2e.test.ts
//
// Genera test/devengine/e2e/reporte-regresion-devengine.md con el estado
// RESUELTO/PENDIENTE de cada issue.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { DEVENGINE_BASE_URL, readCredential } from "./harness";

interface ProbeResult {
	id: string;
	issue: string;
	expectativa: string;
	status: number | null;
	resuelto: boolean;
	detalle: string;
}

async function postChat(
	base: string,
	key: string,
	body: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
	const res = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers: { "X-Api-Key": key, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return { status: res.status, text: (await res.text()).slice(0, 300) };
}

describe("E2E live REGRESIÓN: issues del reporte fix-frida-gateway.md", () => {
	it("probes P1-P4 (round-trip reasoning, content null, /models metadata) → reporte MD", async () => {
		const cred = await readCredential();
		if (!cred?.access) {
			console.warn(
				"SKIP: sin credencial DevEngine (configura DEVENGINE_API_KEY o ~/.frida/auth.json)",
			);
			return;
		}
		const key = cred.access;
		const results: ProbeResult[] = [];

		// ── P1 (Issue 1): round-trip de reasoning_content ──
		// El gateway EMITE reasoning_content en responses; al reenviarlo en
		// un assistant del historial debe aceptarlo (round-trip DeepSeek),
		// no responder 500.
		{
			const r = await postChat(base(), key, {
				model: "gpt-5.4-mini",
				messages: [
					{ role: "user", content: "hola" },
					{
						role: "assistant",
						content: "hola!",
						reasoning_content: "pensé antes de responder",
					},
					{ role: "user", content: "otra vez" },
				],
			});
			results.push({
				id: "P1",
				issue: "Issue 1 — round-trip de reasoning_content",
				expectativa: "200 (el gateway acepta su propio reasoning_content)",
				status: r.status,
				resuelto: r.status === 200,
				detalle: r.text,
			});
		}

		// ── P2 (Issue 2): content null + tool_calls ──
		// Estándar OpenAI: assistant con tool_calls puede llevar content:null.
		{
			const r = await postChat(base(), key, {
				model: "gpt-5.4-mini",
				messages: [
					{ role: "user", content: "edita x" },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "edit", arguments: "{}" },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1", content: "ok" },
					{ role: "user", content: "gracias" },
				],
			});
			results.push({
				id: "P2",
				issue: "Issue 2 — content:null con tool_calls",
				expectativa: "200 (estándar OpenAI: content puede ser null)",
				status: r.status,
				resuelto: r.status === 200,
				detalle: r.text,
			});
		}

		// ── P3 (Issue 3): /models expone context_length ──
		// Sin context_length los clientes no pueden respetar el límite real
		// del modelo → overflow manifestado como 500 (Issue 3).
		{
			const res = await fetch(`${base()}/models`, {
				headers: { "X-Api-Key": key },
			});
			const text = await res.text();
			let hasContext = false;
			let modelCount = -1;
			try {
				const data = JSON.parse(text)?.data;
				if (Array.isArray(data)) {
					modelCount = data.length;
					hasContext = data.some(
						(m: any) =>
							typeof m?.context_length === "number" ||
							typeof m?.context_window === "number",
					);
				}
			} catch {
				/* body no-JSON */
			}
			results.push({
				id: "P3",
				issue: "Issue 3 — /models expone context_length/context_window",
				expectativa: "200 con context_length numérico en cada modelo",
				status: res.status,
				resuelto: res.status === 200 && hasContext,
				detalle: `modelos=${modelCount} context_length=${hasContext} · ${text.slice(0, 120)}`,
			});
		}

		// ── P4 (autodescubrimiento): GET /models/{alias} ──
		// El alias que el propio gateway rutea debe ser consultable.
		{
			const res = await fetch(`${base()}/models/gpt-5.4-mini`, {
				headers: { "X-Api-Key": key },
			});
			results.push({
				id: "P4",
				issue: "Autodescubrimiento — GET /models/{alias}",
				expectativa: "200 (detalle del modelo, incluyendo aliases)",
				status: res.status,
				resuelto: res.status === 200,
				detalle: (await res.text()).slice(0, 200),
			});
		}

		// ── Reporte MD ──
		const lines: string[] = [];
		lines.push(
			`# Reporte E2E regresión issues fix-frida-gateway (${new Date().toISOString()})`,
		);
		lines.push("");
		lines.push(
			`Endpoint: ${DEVENGINE_BASE_URL} · probes con fetch plano (sin workarounds de Frida)`,
		);
		lines.push("");
		lines.push("| Probe | Issue | Esperado | Status | Estado | Detalle |");
		lines.push("|---|---|---|---|---|---|");
		for (const r of results) {
			lines.push(
				`| ${r.id} | ${r.issue} | ${r.expectativa} | ${r.status ?? "?"} | ${r.resuelto ? "✅ RESUELTO" : "❌ PENDIENTE"} | ${r.detalle.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120)} |`,
			);
		}
		lines.push("");
		lines.push(
			`> Estado global: ${results.filter((r) => r.resuelto).length}/${results.length} resueltos. ` +
				`Los workarounds de Frida (ADR-0009) se retiran issue por issue cuando su probe pasa.`,
		);
		const report = lines.join("\n");
		const reportPath = join(__dirname, "reporte-regresion-devengine.md");
		const fs = await import("node:fs/promises");
		await fs.writeFile(reportPath, report, "utf8");
		console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);

		// Gate de aceptación: VERDE sólo cuando TODOS los issues estén
		// resueltos. Mientras exista un PENDIENTE, este test reproduce el
		// problema y documenta el estado.
		const pendientes = results.filter((r) => !r.resuelto);
		expect(
			pendientes.map((p) => `${p.id}: ${p.issue}`),
			`Issues aún PENDIENTES en el gateway (ver ${reportPath})`,
		).toEqual([]);
	}, 120_000);
});

/** Base URL del gateway (composable para el test). */
function base(): string {
	return DEVENGINE_BASE_URL;
}
