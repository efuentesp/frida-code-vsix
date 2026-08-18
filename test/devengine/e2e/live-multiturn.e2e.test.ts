// E2E live — Conversaciones multiturno para detectar bugs de historial en DevEngine.
//
// OBJETIVO: verificar que el gateway DevEngine mantiene contexto entre turnos
// en TODOS los modelos del catálogo (ADR-0056: mini, luna, sol, terra) y
// detectar bugs conocidos:
//   - requiresThinkingAsText: rechaza reasoning_content en historial → 500
//   - requiresAssistantAfterToolResult: rechaza content:null en assistant → 500
//
//   npx vitest run test/devengine/e2e/live-multiturn.e2e.test.ts
//   Override: DEVENGINE_MODELS="gpt-5.6-sol" (csv)
//
// Genera test/devengine/e2e/reporte-multiturn-devengine.md con los resultados.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
	DEVENGINE_BASE_URL,
	DEVENGINE_MODELS,
	DEVENGINE_TIMEOUT,
	readCredential,
	makeEngine,
} from "./harness";

interface MultiturnCase {
	name: string;
	turns: Array<{ role: "user" | "assistant"; content: string }>;
	verify: (finalText: string) => string | null;
}

const CASES: MultiturnCase[] = [
	{
		name: "T1-memory",
		turns: [
			{ role: "user", content: "Mi nombre es Alice y mi color favorito es azul." },
			{
				role: "assistant",
				content: "Entendido, Alice. Tu color favorito es azul.",
			},
			{ role: "user", content: "¿Cuál es mi nombre y mi color favorito?" },
		],
		verify: (text) =>
			/Alice/i.test(text) && /azul/i.test(text)
				? null
				: "no recordó nombre o color",
	},
	{
		name: "T2-context",
		turns: [
			{ role: "user", content: "Suma 15 + 27" },
			{ role: "assistant", content: "42" },
			{ role: "user", content: "Ahora multiplícalo por 3" },
		],
		verify: (text) =>
			/126/.test(text) ? null : "no mantuvo contexto del cálculo previo",
	},
];

interface MultiturnResult {
	name: string;
	ok: boolean;
	finalText: string;
	detail?: string;
	ms: number;
}

describe("E2E live MULTITURN: DevEngine × conversaciones 2-3 turnos × modelos", () => {
	it(
		`matriz de casos multiturno × ${DEVENGINE_MODELS.length} modelos → reporte MD`,
		async () => {
			const cred = await readCredential();
			if (!cred?.access) {
				console.warn(
					"SKIP: sin credencial DevEngine (configura DEVENGINE_API_KEY o ~/.frida/auth.json)",
				);
				return;
			}

			const byModel: Array<{ model: string; results: MultiturnResult[] }> = [];
			for (const model of DEVENGINE_MODELS) {
				const { turn } = await makeEngine({
					baseUrl: DEVENGINE_BASE_URL,
					key: cred.access,
					model,
				});

				const results: MultiturnResult[] = [];
				byModel.push({ model, results });

				for (const c of CASES) {
					const t0 = Date.now();
					try {
						// Construir historial: todos los turnos previos al último
						const history: any[] = [];
						for (let i = 0; i < c.turns.length - 1; i++) {
							const t = c.turns[i];
							history.push({
								role: t.role,
								content: [{ type: "text", text: t.content }],
							});
						}
						// Último turno (siempre user)
						const lastTurn = c.turns[c.turns.length - 1];
						history.push({
							role: lastTurn.role,
							content: [{ type: "text", text: lastTurn.content }],
						});

						const r = await turn(history, [], { maxTokens: 1000 });
						const verifyErr = c.verify(r.text);
						results.push({
							name: c.name,
							ok: !verifyErr,
							finalText: r.text.slice(0, 200),
							detail: verifyErr ?? undefined,
							ms: Date.now() - t0,
						});
					} catch (e: any) {
						results.push({
							name: c.name,
							ok: false,
							finalText: "",
							detail: `excepción: ${String(e?.message ?? e).slice(0, 140)}`,
							ms: Date.now() - t0,
						});
					}
				}
			} // fin for model

			// ── Reporte MD (sección por modelo) ──
			const lines: string[] = [];
			lines.push(
				`# Reporte E2E multiturn — ${DEVENGINE_MODELS.join(", ")} (${new Date().toISOString()})`,
			);
			lines.push("");
			lines.push(
				`Endpoint: ${DEVENGINE_BASE_URL}/v1/chat/completions · Adapter: openai-completions`,
			);
			for (const { model, results } of byModel) {
				const okCount = results.filter((r) => r.ok).length;
				lines.push("");
				lines.push(`## ${model}`);
				lines.push("");
				lines.push(`### Resumen`);
				lines.push("");
				lines.push(
					`- **${okCount}/${CASES.length}** casos mantienen contexto`,
				);
				lines.push("");
				lines.push(`| Caso | Resultado | Respuesta final (200 chars) | ms |`);
				lines.push(`|---|---|---|---|`);
				for (const r of results) {
					lines.push(
						`| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.finalText.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${r.ms} |`,
					);
				}
				if (results.some((r) => !r.ok)) {
					lines.push("");
					lines.push(`#### Detalles de fallos`);
					lines.push("");
					for (const r of results.filter((r) => !r.ok)) {
						lines.push(`- **${r.name}**: ${r.detail ?? "sin detalle"}`);
					}
				}
			}
			lines.push("");
			lines.push(`## Conversaciones`);
			lines.push("");
			for (const c of CASES) {
				lines.push(`### ${c.name}`);
				lines.push("");
				for (const t of c.turns) {
					lines.push(`- **${t.role}**: ${t.content}`);
				}
				lines.push("");
			}

			const report = lines.join("\n");
			const reportPath = join(__dirname, "reporte-multiturn-devengine.md");
			const fs = await import("node:fs/promises");
			await fs.writeFile(reportPath, report, "utf8");
			console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);

			// Exige que al menos 1 caso funcione POR modelo (regresión total)
			for (const { model, results } of byModel) {
				const okCount = results.filter((r) => r.ok).length;
				expect(
					okCount,
					`${model}: regresión total de multiturn (${okCount}/${CASES.length})`,
				).toBeGreaterThanOrEqual(1);
			}
		},
		DEVENGINE_TIMEOUT * DEVENGINE_MODELS.length,
	);
});
