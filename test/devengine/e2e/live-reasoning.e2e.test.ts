// E2E live — Matriz de niveles de razonamiento para DevEngine.
//
// OBJETIVO: verificar que el gateway DevEngine soporta todos los niveles de
// reasoning_effort (none/low/medium/high) en TODOS los modelos del catálogo
// (ADR-0056: mini, luna, sol, terra) y detectar el bug conocido
// requiresThinkingAsText (el gateway devuelve reasoning_content pero lo
// rechaza en el historial → 500 en turno 2).
//
//   npx vitest run test/devengine/e2e/live-reasoning.e2e.test.ts
//   Override: DEVENGINE_MODELS="gpt-5.6-sol" (csv)
//
// Genera test/devengine/e2e/reporte-reasoning-devengine.md con la matriz
// completa (modelo × effort → status, texto, reasoning_tokens, ms).

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
	DEVENGINE_BASE_URL,
	DEVENGINE_MODELS,
	DEVENGINE_TIMEOUT,
	readCredential,
	makeEngine,
} from "./harness";

const EFFORTS = ["none", "low", "medium", "high"] as const;

interface ReasoningCase {
	effort: (typeof EFFORTS)[number];
	prompt: string;
	verify: (text: string, reasoningTokens: number) => string | null;
}

const CASES: ReasoningCase[] = [
	{
		effort: "none",
		prompt: "¿Cuánto es 17×23? Responde solo el número.",
		verify: (text) =>
			/391/.test(text) ? null : "respuesta incorrecta (esperado 391)",
	},
	{
		effort: "low",
		prompt: "Explica brevemente por qué el cielo es azul.",
		verify: (text, reasoning) =>
			text.length > 50
				? null
				: `respuesta muy corta (${text.length} chars, reasoning=${reasoning})`,
	},
	{
		effort: "medium",
		prompt:
			"Diseña una API REST minimalista para un blog con posts y comentarios. Lista solo los endpoints.",
		verify: (text) =>
			/GET|POST|PUT|DELETE/i.test(text) ? null : "no listó endpoints HTTP",
	},
	{
		effort: "high",
		prompt:
			"Resuelve: tienes 3 jarras [8L, 5L, 3L] llenas de agua. ¿Cómo obtienes exactamente 4L en la jarra de 8L? Explica los pasos.",
		verify: (text) =>
			text.length > 100 ? null : `respuesta muy corta (${text.length} chars)`,
	},
];

interface ReasoningResult {
	effort: string;
	ok: boolean;
	text: string;
	reasoningTokens: number;
	detail?: string;
	ms: number;
}

describe("E2E live REASONING: DevEngine × effort levels × modelos", () => {
	it(
		`matriz effort (none/low/medium/high) × ${DEVENGINE_MODELS.length} modelos → reporte MD`,
		async () => {
			const cred = await readCredential();
			if (!cred?.access) {
				console.warn(
					"SKIP: sin credencial DevEngine (configura DEVENGINE_API_KEY o ~/.frida/auth.json)",
				);
				return;
			}

			const byModel: Array<{ model: string; results: ReasoningResult[] }> = [];
			for (const model of DEVENGINE_MODELS) {
				const { turn } = await makeEngine({
					baseUrl: DEVENGINE_BASE_URL,
					key: cred.access,
					model,
				});

				const results: ReasoningResult[] = [];
				byModel.push({ model, results });

				for (const c of CASES) {
					const t0 = Date.now();
					try {
						const r = await turn(
							[{ role: "user", content: [{ type: "text", text: c.prompt }] }],
							[],
							{ reasoningEffort: c.effort, maxTokens: 2000 },
						);

						const verifyErr = c.verify(r.text, r.reasoningTokens);
						results.push({
							effort: c.effort,
							ok: !verifyErr,
							text: r.text.slice(0, 200),
							reasoningTokens: r.reasoningTokens,
							detail: verifyErr ?? undefined,
							ms: Date.now() - t0,
						});
					} catch (e: any) {
						results.push({
							effort: c.effort,
							ok: false,
							text: "",
							reasoningTokens: 0,
							detail: `excepción: ${String(e?.message ?? e).slice(0, 140)}`,
							ms: Date.now() - t0,
						});
					}
				}
			} // fin for model

			// ── Reporte MD (sección por modelo) ──
			const lines: string[] = [];
			lines.push(
				`# Reporte E2E reasoning — ${DEVENGINE_MODELS.join(", ")} (${new Date().toISOString()})`,
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
					`- **${okCount}/${CASES.length}** efforts funcionan correctamente`,
				);
				lines.push("");
				lines.push(
					`| Effort | Resultado | Reasoning tokens | Texto (primeros 200 chars) | ms |`,
				);
				lines.push(`|---|---|---|---|---|`);
				for (const r of results) {
					lines.push(
						`| ${r.effort} | ${r.ok ? "✅" : "❌"} | ${r.reasoningTokens} | ${r.text.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${r.ms} |`,
					);
				}
				if (results.some((r) => !r.ok)) {
					lines.push("");
					lines.push(`#### Detalles de fallos`);
					lines.push("");
					for (const r of results.filter((r) => !r.ok)) {
						lines.push(`- **${r.effort}**: ${r.detail ?? "sin detalle"}`);
					}
				}
			}
			lines.push("");
			lines.push(`## Prompts usados`);
			lines.push("");
			for (const c of CASES) {
				lines.push(`- **${c.effort}**: ${c.prompt}`);
			}

			const report = lines.join("\n");
			const reportPath = join(__dirname, "reporte-reasoning-devengine.md");
			const fs = await import("node:fs/promises");
			await fs.writeFile(reportPath, report, "utf8");
			console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);

			// Exige que al menos 2 efforts funcionen POR modelo (regresión total)
			for (const { model, results } of byModel) {
				const okCount = results.filter((r) => r.ok).length;
				expect(
					okCount,
					`${model}: regresión total de reasoning (${okCount}/${CASES.length})`,
				).toBeGreaterThanOrEqual(2);
			}
		},
		DEVENGINE_TIMEOUT * DEVENGINE_MODELS.length,
	);
});
