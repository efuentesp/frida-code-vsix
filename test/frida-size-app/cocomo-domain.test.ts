// frida-size-app — dominio COCOMO Basic 81 congelado (issue #139, M10).
//
// Verification Note V2 del design (2026-08-27_20-02-57): el criterio de
// aceptación numérico del FRD. Cuatro capas (molde
// test/frida-traffic2api/openapi-schema.test.ts):
//   1. Fixture CONGELADA del bloque derived.cocomo para kloc=100
//      semi-detached wage=1000: E(1.00) = 3.0·100^1.12 = 521.3 PM — cifras
//      verificadas con node (lección (b) del Slice 5: no copiar de prosa
//      sin recomputar; la "502.4" original de la V2 era un error aritmético
//      corregido en el artefacto).
//   2. Anti-fixtures: el schema TypeBox tiene dientes (wage ausente, EAF
//      fuera del spread, menos de 3 filas, effort no-numérico).
//   3. Dientes semánticos con literales INDEPENDIENTES del código bajo
//      prueba: las constantes {3.0, 1.12, 2.5, 0.35} y el overhead 2.4 se
//      escriben AQUÍ — si alguien edita COCOMO_CONSTANTS con un bump
//      equivocado, la corrida e2e (capa 4) deja de reproducir la fixture.
//   4. Corrida e2e compacta sobre el motor real (runWorkflowInStore): el
//      script REAL produce exactamente la fixture congelada a partir de un
//      by-file canned de 100 archivos × 1000 LOC (kloc=100.0 exacto) y
//      congela el borde SQALE B: deuda 2501 h sobre 100000 NCLOC → ratio
//      0.05002 (>0.05 → B sobre el ratio SIN redondear) aunque el stored
//      round3 muestre 0.05 (validado con harness en el Slice 5).
//
// El schema vive test-local a propósito: es un criterio de aceptación, no
// una API del pack (molde openapi-schema). scc se falsifica instalado al
// pin en el HOME aislado (ruta absoluta SCC_BIN, D12) — sin git ni lizard:
// 4 degradaciones (3 git + 1 lizard), familias ok: by-file + duplication.

import { randomUUID } from "node:crypto";
import {
 chmodSync,
 mkdirSync,
 mkdtempSync,
 readFileSync,
 rmSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { SIZE_APP_PATTERN } from "../../src/tools/frida-size-app";
import {
 currentSccAsset,
 sccBinPath,
 sccMarkerPath,
 SCC_PIN,
} from "../../src/tools/frida-size-app/constants";

// ── Schema TypeBox del bloque derived.cocomo (criterio V2) ─────────────────

const CocomoRowSchema = Type.Object({
 eaf: Type.Union([Type.Literal(0.85), Type.Literal(1), Type.Literal(1.15)]),
 effort: Type.Number(),
 tdev: Type.Number(),
 people: Type.Union([Type.Number(), Type.Null()]),
 cost: Type.Integer(),
});

const CocomoBlockSchema = Type.Object({
 type: Type.Union([
  Type.Literal("organic"),
  Type.Literal("semi-detached"),
  Type.Literal("embedded"),
 ]),
 constants: Type.Object({
  a: Type.Number(),
  b: Type.Number(),
  c: Type.Number(),
  d: Type.Number(),
 }),
 overhead: Type.Literal(2.4),
 wageMonthly: Type.Number(),
 currency: Type.String(),
 klocSource: Type.String(),
 rows: Type.Array(CocomoRowSchema, { minItems: 3, maxItems: 3 }),
});

/** Assert con diagnóstico (molde openapi-schema: instancePath, no path). */
function expectValid(schema: TSchema, value: unknown): void {
 const errors = [...Value.Errors(schema, value)].map(
  (e) => `${e.instancePath || "/"}: ${e.message}`,
 );
 expect(errors, errors.join(" | ")).toEqual([]);
}

/** Borra una key sin pelearse con el checker de `delete`. */
function dropKey(obj: object, key: string): void {
 delete (obj as Record<string, unknown>)[key];
}

// ── Fixture congelada (kloc=100 semi-detached wage=1000 — verificada node) ─

/** Constantes Basic COCOMO 81 de scc v4.0.0 (processor/cocomo.go) —
 *  literales AQUÍ a propósito: independientes del código bajo prueba. */
const SEMI = { a: 3.0, b: 1.12, c: 2.5, d: 0.35 };
const KLOC_SOURCE = "families['by-file'].loc / 1000 (SLOC con exclusiones)";

function frozenCocomoBlock() {
 return {
  type: "semi-detached",
  constants: { ...SEMI },
  overhead: 2.4,
  wageMonthly: 1000,
  currency: "USD",
  klocSource: KLOC_SOURCE,
  rows: [
   { eaf: 0.85, effort: 443.1, tdev: 21.1, people: 21, cost: 1063534 },
   { eaf: 1, effort: 521.3, tdev: 22.3, people: 23.3, cost: 1251217 },
   { eaf: 1.15, effort: 599.5, tdev: 23.5, people: 25.6, cost: 1438899 },
  ],
 };
}

// ── Mock scc + spawner (contrato del e2e del pack; versión compacta) ───────

const SCC_MOCK = `#!/usr/bin/env bash
# mock scc v4.0.0 (cocomo-domain) — contrato documentado del release.
D="$(cd "$(dirname "$0")" && pwd)"
case " $* " in
  *" --version "*)
    cat "$D/scc-mock-data/version.txt"
    ;;
  *" -a "*)
    cat "$D/scc-mock-data/scc-a.json"
    ;;
  *" --exclude-dir "*)
    cat "$D/scc-mock-data/by-file-curated.json"
    ;;
  *)
    cat "$D/scc-mock-data/by-file-raw.json"
    ;;
esac
`;

/** by-file canned: 100 archivos × 1000 LOC = kloc 100.0 EXACTO. Deuda
 *  cognitiva 2501 h (98×15 sin deuda + b98 con 16 → 0.5 h + z99 con 5016
 *  sintético → 2500.5 h) para clavar el borde SQALE B (0.05002 > 0.05). */
function domainByFile(): string {
 const files: Array<Record<string, unknown>> = [];
 const job = (location: string, complexity: number, cognitive: number) => ({
  Location: location,
  Language: "TypeScript",
  Lines: 1015,
  Code: 1000,
  Comment: 10,
  Blank: 5,
  Complexity: complexity,
  Cognitive: cognitive,
 });
 for (let i = 0; i < 98; i++) {
  files.push(job(`app/a${String(i).padStart(2, "0")}.ts`, 15, 15));
 }
 files.push(job("app/b98.ts", 16, 16));
 files.push(job("app/z99.ts", 5016, 5016));
 return JSON.stringify([{ Language: "TypeScript", Files: files }]);
}

const miniSpawn = (async (prompt: string) => {
 if (prompt.includes("## Tu anexo")) {
  const file = prompt.match(/Ruta EXACTA donde escribirlo: (\S+)/)?.[1] ?? "";
  const base = process.env.SIZE_DOMAIN_CWD ?? process.cwd();
  const p = join(base, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "# Anexo mock (cocomo-domain)\n", "utf-8");
  return {
   doc: file,
   sections: ["interpretacion"],
   summary: file + " escrito",
  };
 }
 if (prompt.includes("## Entregables a auditar")) {
  // 4 degradaciones (3 git + 1 lizard) → CONCERNS declarado.
  return {
   decision: "CONCERNS",
   findings: [
    {
     severity: "MEDIUM",
     evidence: "4 familias degradadas declaradas en metrics.json",
     fix: "correr sobre un repo git con lizard instalado",
    },
   ],
   summary: "familias degradadas",
  };
 }
 return "echo: " + prompt.slice(0, 40);
}) as unknown as SpawnAgentFn;
// ── Tests ──────────────────────────────────────────────────────────────────

describe("frida-size-app · dominio COCOMO — Basic 81 congelado (#139, V2)", () => {
 it("fixture congelada es válida y satisface E=a·KSLOC^b·EAF con literales independientes", () => {
  const block = frozenCocomoBlock();
  expectValid(CocomoBlockSchema, block);
  // E central recomputada con literales del TEST (no imports):
  // 3.0·100^1.12 = 521.34 → round1 521.3.
  const central = 3.0 * 100 ** 1.12;
  expect(block.rows[1].effort).toBe(Math.round(central * 10) / 10);
  // Los bordes del spread son E(1.00)×{0.85, 1.15} (lineal en EAF).
  expect(block.rows[0].effort).toBe(Math.round(central * 0.85 * 10) / 10);
  expect(block.rows[2].effort).toBe(Math.round(central * 1.15 * 10) / 10);
  // TDEV = 2.5·E^0.35 y costo = E·wage·2.4 (réplica scc exacta, D6).
  expect(block.rows[1].tdev).toBe(Math.round(2.5 * central ** 0.35 * 10) / 10);
  expect(block.rows[1].cost).toBe(Math.round(central * 1000 * 2.4));
 });

 it("anti-fixture: wage ausente → inválida", () => {
  const bad = frozenCocomoBlock();
  dropKey(bad, "wageMonthly");
  expect(Value.Check(CocomoBlockSchema, bad)).toBe(false);
 });

 it("anti-fixture: EAF fuera del spread (1.4) → inválida", () => {
  const bad = frozenCocomoBlock();
  bad.rows[2].eaf = 1.4;
  expect(Value.Check(CocomoBlockSchema, bad)).toBe(false);
 });

 it("anti-fixture: 2 filas → inválida (el spread son 3 corridas)", () => {
  const bad = frozenCocomoBlock();
  bad.rows = bad.rows.slice(0, 2);
  expect(Value.Check(CocomoBlockSchema, bad)).toBe(false);
 });

 it("anti-fixture: effort como string → inválida", () => {
  const bad = frozenCocomoBlock();
  (bad.rows[0] as Record<string, unknown>).effort = "443.1";
  expect(Value.Check(CocomoBlockSchema, bad)).toBe(false);
 });

 it("dientes semánticos: exponente del modo equivocado no reproduce; efforts y costs monótonos", () => {
  const block = frozenCocomoBlock();
  // organic {2.4, 1.05} sobre kloc=100 da 302.1 PM ≠ 521.3 (semi).
  const organic = Math.round(2.4 * 100 ** 1.05 * 10) / 10;
  expect(organic).not.toBe(block.rows[1].effort);
  // El rango es estrictamente creciente en effort Y cost.
  for (let i = 1; i < block.rows.length; i++) {
   expect(block.rows[i].effort).toBeGreaterThan(block.rows[i - 1].effort);
   expect(block.rows[i].cost).toBeGreaterThan(block.rows[i - 1].cost);
  }
 });

 describe("corrida e2e compacta sobre el motor real", () => {
  const REAL_HOME = process.env.HOME;
  let home: string;
  let cwd: string;

  beforeEach(() => {
   home = mkdtempSync(join(tmpdir(), "size-cocomo-home-"));
   cwd = mkdtempSync(join(tmpdir(), "size-cocomo-cwd-"));
   process.env.HOME = home;
   // Mock scc instalado al pin (ruta absoluta, D12): canned de 100
   // archivos × 1000 LOC — kloc 100.0 exacto para las cifras V2.
   const bin = sccBinPath(join(home, ".frida"));
   mkdirSync(dirname(bin), { recursive: true });
   writeFileSync(bin, SCC_MOCK, "utf-8");
   chmodSync(bin, 0o755); // ejecutable — sin esto el sandbox lo invoca con exit 126
   const dataDir = join(home, ".frida", "bin", "scc-mock-data");
   mkdirSync(dataDir, { recursive: true });
   writeFileSync(join(dataDir, "version.txt"), "scc version 4.0.0\n");
   writeFileSync(join(dataDir, "by-file-curated.json"), domainByFile());
   writeFileSync(join(dataDir, "by-file-raw.json"), domainByFile());
   // Contrato V1 observado: array de LanguageSummary con ULOC por
   // lenguaje (sin DRYness global en el JSON de -a).
   writeFileSync(
    join(dataDir, "scc-a.json"),
    '[{"Name":"TypeScript","Files":[],"ULOC":90000}]\n',
   );
   writeFileSync(
    sccMarkerPath(join(home, ".frida")),
    JSON.stringify({
     pin: SCC_PIN,
     asset: currentSccAsset(),
     sha256: "0".repeat(64),
    }),
   );
   // El spawner mock resuelve las rutas relativas de los anexos
   // contra este cwd.
   process.env.SIZE_DOMAIN_CWD = cwd;
  });

  afterEach(() => {
   if (REAL_HOME) process.env.HOME = REAL_HOME;
   delete process.env.SIZE_DOMAIN_CWD;
   rmSync(home, { recursive: true, force: true });
   rmSync(cwd, { recursive: true, force: true });
  });

  it("derived.cocomo deep-equal congelada + SQALE B en el borde 0.05002", async () => {
   const args = { wage: 1000, currency: "USD", review: "auto" };
   const script = SIZE_APP_PATTERN.resolve(args, { cwd });

   const { result } = await runWorkflowInStore({
    name: "size-app",
    script,
    args,
    cwd,
    sessionId: "sess-size-cocomo",
    spawnAgent: miniSpawn,
    home,
    runId: randomUUID(),
    foreground: false,
   });

   const m = JSON.parse(
    readFileSync(
     join(cwd, "docs/dimensionamiento/artifacts/metrics.json"),
     "utf-8",
    ),
   ) as {
    derived: {
     computed: boolean;
     kloc: number;
     debtHours: number;
     sqale: { ratio: number; rating: string };
     cocomo: ReturnType<typeof frozenCocomoBlock>;
     percentiles: {
      complexity: { p50: number; p90: number; p99: number; samples: number };
     };
    };
   };

   // El corazón de V2: el script REAL produce la fixture congelada.
   expect(m.derived.computed).toBe(true);
   expect(m.derived.kloc).toBe(100);
   expect(m.derived.cocomo).toEqual(frozenCocomoBlock());

   // SQALE en el borde: rating sobre el ratio SIN redondear
   // (2501/(0.5·100000) = 0.05002 > 0.05 → B); stored round3 = 0.05.
   // toMatchObject: las 4 claves completas (formula/thresholds) se
   // congelan en el e2e del pack — aquí basta el borde.
   expect(m.derived.debtHours).toBe(2501);
   expect(m.derived.sqale).toMatchObject({ ratio: 0.05, rating: "B" });

   // Percentiles (98×15 + 16 + 5016): p50/p90 sobre la masa, p99
   // expone el archivo gordo (nearest-rank ceil(p·N)−1).
   expect(m.derived.percentiles.complexity).toEqual({
    p50: 15,
    p90: 15,
    p99: 16,
    samples: 100,
   });

   // El informe pinta las cifras congeladas (D3: desde metrics.json).
   const reporte = readFileSync(
    join(cwd, "docs/dimensionamiento/dimensionamiento.md"),
    "utf-8",
   );
   expect(reporte).toContain(
    "## COCOMO — Basic COCOMO 81 (Boehm), tipo semi-detached",
   );
   expect(reporte).toContain(
    "| **1.00** | **521.3** | **22.3** | **23.3** | **$1,251,217** |",
   );
   expect(reporte).toContain("= 0.050 → **B**");
   expect(reporte).toContain("**2501.0 h**");
   expect(reporte).toContain("| CCN por función (lizard) | no disponible |");

   const r = result as {
    kloc: number;
    familiesOk: number;
    familiesTotal: number;
    degradations: number;
    judge: { decision: string };
   };
   expect(r.kloc).toBe(100);
   expect(r.familiesOk).toBe(2); // by-file + duplication
   expect(r.familiesTotal).toBe(6);
   expect(r.degradations).toBe(4); // 3 git + 1 lizard
   expect(r.judge.decision).toBe("CONCERNS");
  }, 45000);
 });
});
