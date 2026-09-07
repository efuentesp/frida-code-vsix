#!/usr/bin/env node
// frida-shunt (#202): benchmark de ahorro — metodología del upstream de
// Spotify (estimación conservadora chars/4, 4 escenarios). Genera fixtures
// deterministas en un dir temporal, calcula los tokens de ENTRADA que
// consumiría el contexto del PADRE con y sin el gate, y escribe el reporte a
// docs/research/2026-09-06-shunt-benchmark.md.
//
// Uso: node scripts/shunt-benchmark.mjs [--dry]   (--dry: sólo imprime)

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Fixtures deterministas (semilla fija: mismo output en cada corrida) ──

const gen = (n) =>
	Array.from({ length: n }, (_, i) => `export const handler${i} = (ev${i}: Event) => { return ev${i}.id + ${i}; };`)
		.join("\n") + "\n";

const genTests = (n, name) =>
	`import { describe, it, expect } from "vitest";\nimport { ${name} } from "./${name}";\n\n` +
	Array.from({ length: n }, (_, i) =>
		`describe("${name} caso ${i}", () => {\n  it("procesa el evento ${i}", () => {\n    expect(${name}({ id: ${i} })).toBe(${i});\n  });\n});\n`
	).join("\n");

const dir = join(tmpdir(), "frida-shunt-bench-");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const fixtures = {
	"websocket-handler.ts": gen(602),
	"user-service.ts": gen(480),
	"order-service.test.ts": genTests(90, "orderService"),
};
for (const [name, content] of Object.entries(fixtures)) {
	writeFileSync(join(dir, name), content, "utf8");
}

// ── Proxies deterministas ──

/** Outline proxy de module_report (pi-lens): firmas de símbolos + rango. */
const outlineOf = (content) => {
	const lines = content.split("\n");
	const keep = lines.filter((l) =>
		/^(export |import |describe\(| {2}it\()/.test(l) || /=> \{/.test(l)
	);
	// Cota del outline: máx 60 líneas por archivo (module_report acota igual).
	return keep.slice(0, 60).map((l, i) => `${i + 1}-\t${l.trim()}`).join("\n");
};

const tok = (s) => Math.ceil(s.length / 4);
const REASON = tok(
	"Lectura costosa bloqueada por frida-shunt: ~600 líneas (umbral 350). " +
		"Usa la escalera: 1) module_report/read_symbol de pi-lens (0 tokens); " +
		"2) subagent Explore (rol smol) para preguntas profundas multi-archivo; " +
		"3) para editar, read con offset/limit."
);
const SUBAGENT_RET = tok(
	"- websocket-handler.ts: 602 líneas, exporta 602 handlers (handler0..601), todos (ev: Event) => ev.id + i. Sin estado compartido ni side-effects.\n" +
		"- user-service.ts: 480 líneas, mismo patrón (handler0..479).\n" +
		"- order-service.test.ts: 90 bloques describe/it cubriendo orderService({id}) → id."
);

// ── Escenarios (espejo del benchmarks.json del upstream) ──

const F = (n) => tok(fixtures[n]);
const OUT = (n) => tok(outlineOf(fixtures[n]));

const scenarios = [
	{
		id: 1,
		name: "single-large-file",
		desc: "Leer un servicio de 602 líneas y resumir sus exports",
		without: F("websocket-handler.ts"),
		with: REASON + OUT("websocket-handler.ts"),
		withDeep: REASON + SUBAGENT_RET,
	},
	{
		id: 2,
		name: "multi-file-cross-read",
		desc: "3 archivos, pregunta transversal (exports y relaciones)",
		without: F("websocket-handler.ts") + F("user-service.ts") + F("order-service.test.ts"),
		with: REASON + OUT("websocket-handler.ts") + OUT("user-service.ts") + OUT("order-service.test.ts"),
		withDeep: REASON + SUBAGENT_RET,
	},
	{
		id: 3,
		name: "source-plus-test",
		desc: "Par fuente+test para entender cobertura",
		without: F("user-service.ts") + F("order-service.test.ts"),
		with: REASON + OUT("user-service.ts") + OUT("order-service.test.ts"),
		withDeep: REASON + SUBAGENT_RET,
	},
	{
		id: 4,
		name: "code-generation",
		desc: "Generar tests de UserService siguiendo el patrón de OrderService (input-side)",
		without: F("order-service.test.ts") + F("user-service.ts"),
		with: tok(
			"Escribe tests para UserService siguiendo exactamente el patrón de tests/OrderService.test.ts (spec+reference). Escribe directo a tests/UserService.test.ts. Reporta ruta + resumen de 3 líneas."
		) + SUBAGENT_RET,
		withDeep: null, // el code-writer ES el camino profundo
	},
];

const pct = (without, with_) => Math.round((1 - with_ / without) * 100);
const rows = scenarios.map((s) => {
	const best = s.withDeep === null ? s.with : Math.min(s.with, s.withDeep);
	return { ...s, best, savings: pct(s.without, s.with), savingsDeep: s.withDeep === null ? null : pct(s.without, s.withDeep) };
});
const meanSavings = Math.round(rows.reduce((a, r) => a + r.savings, 0) / rows.length);
const meanBest = Math.round(rows.reduce((a, r) => a + (r.savingsDeep ?? r.savings), 0) / rows.length);

const today = "2026-09-06";
const report = `# Benchmark de frida-shunt — ahorro de tokens (input del contexto padre)

> Generado por \`scripts/shunt-benchmark.mjs\` (#202) · ${today} · Metodología del
> [upstream de Spotify](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt/evals):
> estimación conservadora **chars/4**, fixtures deterministas, 4 escenarios.
> Mide los tokens de ENTRADA que consumiría el contexto del modelo PRINCIPAL
> (lo que ahorra el gate); el costo del worker (rol smol / Ollama local) corre
> por fuera y en el caso local es ~0.

## Escenarios

| # | Escenario | Sin shunt (tokens) | Con shunt — escalera mínima (pi-lens) | Con shunt — peldaño 2 (subagent) | Ahorro pi-lens | Ahorro subagent |
| --- | --- | --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.id} | ${r.name}<br/><sub>${r.desc}</sub> | ${r.without} | ${r.with} | ${r.withDeep ?? "—" } | ${r.savings}% | ${r.savingsDeep ?? "—"}% |`).join("\n")}

**Ahorro medio (peldaño 1, pi-lens): ${meanSavings}% · (mejor peldaño por escenario): ${meanBest}%**

## Lecturas honestas

- **Peldaño 1 (pi-lens/module_report)** domina cuando la pregunta es de
  estructura: es determinístico (0 tokens de worker, 0 latencia). El proxy del
  outline (firmas acotadas a 60 líneas) es conservador: el module_report real
  incluye rangos y who-uses-this, igualmente acotado.
- **Peldaño 2 (subagent smol)** gana cuando la pregunta es semántica: vuelve
  sólo la respuesta destilada (proxy: resumen fijo). Con Ollama local el
  worker es costo 0; con un modelo pequeño remoto, su costo NO entra al
  contexto del padre (la propiedad clave del patrón).
- **Escenario 4 (code-writer)** mide sólo el lado INPUT (spec + resumen): el
  output va directo a disco y el principal jamás lo ve — el ahorro real incluye
  TODO el output no generado por el principal (no medible con chars/4 contra
  un baseline que no existe).
- Comparativa con el upstream: Spotify reporta 82–94% en bulk-read (media ~90%)
  con delegación a worker remoto; frida obtiene el mismo orden con el gate
  local + el peldaño determinístico extra que Spotify no tiene.

## Reproducir

\`\`\`bash
node scripts/shunt-benchmark.mjs          # escribe este archivo
node scripts/shunt-benchmark.mjs --dry    # sólo imprime la tabla
\`\`\`
`;

if (process.argv.includes("--dry")) {
	for (const r of rows) {
		console.log(`#${r.id} ${r.name}: sin=${r.without} pi-lens=${r.with} (${r.savings}%) subagent=${r.withDeep ?? "—"} (${r.savingsDeep ?? "—"}%)`);
	}
	console.log(`MEDIA: pi-lens ${meanSavings}% · mejor-peldaño ${meanBest}%`);
} else {
	writeFileSync("docs/research/2026-09-06-shunt-benchmark.md", report, "utf8");
	console.log(`ok → docs/research/2026-09-06-shunt-benchmark.md (media pi-lens ${meanSavings}%, mejor ${meanBest}%)`);
}
rmSync(dir, { recursive: true, force: true });
