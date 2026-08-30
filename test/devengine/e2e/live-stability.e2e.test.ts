// E2E live — ESTABILIDAD del gateway DevEngine bajo uso agéntico real.
//
// INCIDENTE 29-30/ago (ver reporte-incidente-2-devengine.md): durante una
// sesión agéntica de ~20h el gateway falló ~19 veces (~2.7% de ~700 requests)
// en 4 episodios, con dos firmas:
//
//   FIRMA A — SSE error del gateway en español SIN status HTTP:
//             "Error procesando la respuesta del proveedor" (~61-68s tras
//             el request; el upstream del gateway falla a mitad del stream).
//   FIRMA B — el gateway nunca devuelve headers → timeout del cliente:
//             "Request timed out." (~71-85s tras el request).
//
// Ambas son EPISÓDICAS (ventanas de minutos, no deterministas por request),
// así que este soak test dispara N requests secuenciales por modelo con el
// payload típico del agente y CLASIFICA cada resultado por firma. El test:
//   - VERDE: 0 fallos con firma conocida (el gateway está estable ahora).
//   - ROJO: cualquier request reproduce firma A o B → el reporte
//     reporte-stability-devengine.md lleva la evidencia lista para DevEngine
//     (n, modelo, ms, firma, errorMessage).
//
// El timeout por vuelta (default 90s) reproduce la ventana de producción:
// un request sano responde en 1-20s; firma B se manifiesta ANTES del timeout.
//
//   npx vitest run test/devengine/e2e/live-stability.e2e.test.ts
//   Overrides: DEVENGINE_MODELS="gpt-5.6-sol" · DEVENGINE_STABILITY_N=20
//              DEVENGINE_STABILITY_TIMEOUT_MS=90000
//
// Genera test/devengine/e2e/reporte-stability-devengine.md.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
	DEVENGINE_BASE_URL,
	DEVENGINE_MODELS,
	DEVENGINE_TIMEOUT,
	readCredential,
	makeEngine,
} from "./harness";

/** Requests secuenciales por modelo. */
const N = Number(process.env.DEVENGINE_STABILITY_N ?? 10);
/** Timeout del cliente por vuelta (ms) — ventana de producción (~60s+handshake). */
const PER_REQUEST_TIMEOUT_MS = Number(
	process.env.DEVENGINE_STABILITY_TIMEOUT_MS ?? 90_000,
);

/** Mensaje típico de un turno agéntico: instrucción + contexto de código. */
const AGENT_TURN_PROMPT = `Analiza este fragmento de un servicio PHP y responde en 3 viñetas qué harías para hacerlo más testeable:

final class PlazosService
{
    public function __construct(private readonly CalendarioInhabil $calendario) {}

    public function diasHabiles(DateTimeImmutable $desde, int $dias): DateTimeImmutable
    {
        $fecha = $desde;
        $restantes = $dias;
        while ($restantes > 0) {
            $fecha = $fecha->modify('+1 day');
            if ($this->calendario->esInhabil($fecha)) { continue; }
            $restantes--;
        }
        return $fecha;
    }
}`;

/** Clasifica un fallo por su firma (los mensajes llegan del gateway o del
 *  SDK openai; ver stream-failure-signatures.test.ts para el mecanismo). */
function classifyFailure(errorMessage: string): string {
	const msg = String(errorMessage ?? "");
	if (/Error procesando la respuesta del proveedor/.test(msg))
		return "FIRMA-A: error SSE del gateway sin status (upstream falló a mitad del stream)";
	if (/timed? ?out/i.test(msg))
		return "FIRMA-B: gateway sin respuesta (timeout del cliente)";
	if (/^\s*5\d\d/.test(msg) || /internal server error/i.test(msg))
		return "HTTP-5xx del gateway";
	if (/^\s*4\d\d/.test(msg)) return "HTTP-4xx del gateway";
	if (/abort/i.test(msg)) return "abortado";
	return "otro";
}

interface StabilityResult {
	n: number;
	model: string;
	ok: boolean;
	signature: string;
	errorMessage: string;
	ms: number;
}

describe("E2E live STABILITY: DevEngine × N requests (detecta firmas A/B del incidente)", () => {
	it(
		`soak ${N} requests × ${DEVENGINE_MODELS.length} modelo(s) → 0 firmas de fallo → reporte MD`,
		async () => {
			const cred = await readCredential();
			if (!cred?.access) {
				console.warn(
					"SKIP: sin credencial DevEngine (configura DEVENGINE_API_KEY o ~/.frida/auth.json)",
				);
				return;
			}

			const results: StabilityResult[] = [];
			for (const model of DEVENGINE_MODELS) {
				const { turn } = await makeEngine({
					baseUrl: DEVENGINE_BASE_URL,
					key: cred.access,
					model,
				});
				for (let n = 1; n <= N; n++) {
					const t0 = Date.now();
					try {
						await turn(
							[
								{
									role: "user",
									content: [{ type: "text", text: AGENT_TURN_PROMPT }],
								},
							],
							[],
							{
								maxTokens: 1500,
								reasoningEffort: "medium",
								timeoutMs: PER_REQUEST_TIMEOUT_MS,
							},
						);
						results.push({
							n,
							model,
							ok: true,
							signature: "ok",
							errorMessage: "",
							ms: Date.now() - t0,
						});
					} catch (e: any) {
						const msg = String(e?.message ?? e);
						results.push({
							n,
							model,
							ok: false,
							signature: classifyFailure(msg),
							errorMessage: msg.slice(0, 200),
							ms: Date.now() - t0,
						});
					}
				}
			}

			// ── Reporte MD ──
			const lines: string[] = [];
			lines.push(
				`# Reporte E2E estabilidad — ${DEVENGINE_MODELS.join(", ")} (${new Date().toISOString()})`,
			);
			lines.push("");
			lines.push(
				`Endpoint: ${DEVENGINE_BASE_URL}/v1/chat/completions · ${N} requests secuenciales por modelo · timeout cliente ${PER_REQUEST_TIMEOUT_MS}ms · effort medium`,
			);
			const failures = results.filter((r) => !r.ok);
			const bySig = new Map<string, number>();
			for (const f of failures)
				bySig.set(f.signature, (bySig.get(f.signature) ?? 0) + 1);
			lines.push("");
			lines.push(`## Resumen`);
			lines.push("");
			lines.push(
				`- Total: ${results.length} requests · Éxitos: ${results.length - failures.length} · Fallos: ${failures.length}`,
			);
			if (bySig.size > 0) {
				lines.push("- Fallos por firma:");
				for (const [sig, count] of bySig) lines.push(`  - \`${sig}\`: ${count}`);
			}
			lines.push("");
			lines.push(
				"| # | Modelo | Resultado | ms | Firma | ErrorMessage (200 chars) |",
			);
			lines.push("|---|---|---|---|---|---|");
			for (const r of results) {
				lines.push(
					`| ${r.n} | ${r.model} | ${r.ok ? "✅" : "❌"} | ${r.ms} | ${r.signature} | ${r.errorMessage.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
				);
			}

			const report = lines.join("\n");
			const reportPath = join(__dirname, "reporte-stability-devengine.md");
			const fs = await import("node:fs/promises");
			await fs.writeFile(reportPath, report, "utf8");
			console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);

			// Gate: CUALQUIER fallo reproduce el incidente → rojo con evidencia.
			// (El gateway sano debe completar todos los requests secuenciales.)
			expect(
				failures.length,
				`${failures.length}/${results.length} requests fallaron (ver ${reportPath}) — firmas: ${[...bySig.entries()].map(([s, c]) => `${s}×${c}`).join(", ") || "n/a"}`,
			).toBe(0);
		},
		// N × modelos × (timeout por request + margen)
		DEVENGINE_TIMEOUT +
			N * DEVENGINE_MODELS.length * (PER_REQUEST_TIMEOUT_MS + 10_000),
	);
});
