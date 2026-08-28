// frida-size-app — integración end-to-end del patrón sobre el motor real
// (runWorkflowInStore). Issue #139, M10 Pista M.
//
// Doble mock (moldes test/frida-understand-app/e2e.test.ts y
// test/frida-traffic2api/e2e.test.ts):
//   1. Binario scc FALSO instalado AL PIN en el HOME aislado
//      (<home>/.frida/bin/scc + marker): el script lo invoca por RUTA
//      ABSOLUTA (SCC_BIN interpolada host-side, D12) — NO vía PATH, así que
//      el mock vive donde la sonda isSccInstalledAtPin lo encuentra y
//      CAPABILITIES.scc=true desde el resolve(). Despacha por flags y emite
//      el CONTRATO OBSERVADO de scc v4.0.0 (congelado por el smoke V1 sobre
//      un clone de OFBiz — transcript en .rpiv/tmp/scc-smoke/transcript.txt;
//      lecciones 30ef616/59517f7/9d6d8bb: el binario miente en los mocks):
//      --version · --by-file --format json --cognitive --exclude-dir…
//      (curada) · --by-file --format json (2ª pasada raw, sin curada) ·
//      -a (array de LanguageSummary con ULOC POR LENGUAJE y Files:[] — SIN
//      DRYness global en JSON; la suma de ULOC es el total) ·
//      --hotspots/--coupling/--by-author (CSVs con 1ª línea de comentario
//      "# window: depth=… commits=…" ANTES del header). Los datos canned
//      son sintéticos con números congelados (verificados con node).
//      lizard SÍ es una sonda PATH (command -v) → mock en .mock-bin. git es
//      real (`git init` en el cwd habilita las familias churn; los CSVs son
//      canned del mock, no de git — declarado, el gate es presencia de repo).
//   2. Spawner mock por anclas de runtime context (contrato del Slice 5):
//      escritores "## Tu anexo" (ESCRIBEN archivos reales — #83, mocks
//      honestos, lesson bffd6f1/30ef616) y juez "## Entregables a auditar"
//      (deriva del contexto interpolado: stoppedBy="time" → CONCERNS por
//      corte; degradations>0 → CONCERNS por familias; si no,
//      opts.judgeDecision ?? "PASS").
//
// Cobertura: corrida feliz (6/6 familias, exclusiones con volumen medido
// por el delta de la 2ª pasada raw, 3 anexos, informe+README deterministas
// con COCOMO/SQALE/olas/bus factor congelados, juez PASS), degradación
// total (9 degradaciones 5+3+1, rama no computable, CONCERNS), familia
// corrupta mid-run (by-file parse-error SIN duplicar gates de bootstrap,
// FR-7), corte wall-clock (maxMinutes=1 + FAKE_DATE +90 s: anexos no
// generados, synthesize/judge siguen — FR-11), escritor mentiroso (gate
// test -s + reintento informado único), escritor flaky (reintento rescata),
// juez FAIL no-abortivo (V5 plumbing), checkpoint final review=manual y
// determinismo (derived/exclusions/families deep-equal).

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
 chmodSync,
 existsSync,
 mkdirSync,
 mkdtempSync,
 readFileSync,
 rmSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { resolveCheckpoint } from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { SIZE_APP_PATTERN } from "../../src/tools/frida-size-app";
import {
 currentSccAsset,
 sccBinPath,
 sccMarkerPath,
 SCC_PIN,
} from "../../src/tools/frida-size-app/constants";
import {
 COCOMO_CONSTANTS,
 COCOMO_EAF_SPREAD,
 COCOMO_OVERHEAD,
} from "../../src/tools/frida-size-app/workflow";

const REAL_HOME = process.env.HOME;
const REAL_PATH = process.env.PATH;

/** Entregables del size-app (relativos al cwd de la corrida). */
const ART = "docs/dimensionamiento";

const ANNEX_FILES = [
 `${ART}/analisis/hotspots.md`,
 `${ART}/analisis/deuda-modulos.md`,
 `${ART}/analisis/riesgos-tamano.md`,
];

let home: string;
let cwd: string;
let binDir: string;

beforeEach(() => {
 home = mkdtempSync(join(tmpdir(), "size-e2e-home-"));
 cwd = mkdtempSync(join(tmpdir(), "size-e2e-cwd-"));
 binDir = join(cwd, ".mock-bin");
 mkdirSync(binDir, { recursive: true });
 // HOME aislado (molde M1/M9): la sonda del pack (os.homedir() lee $HOME)
 // ve <home>/.frida — el fixture del binario scc decide CAPABILITIES.scc.
 process.env.HOME = home;
 // El sandbox hereda el env del proceso (execution.ts): .mock-bin gana en
 // PATH (lizard falso, date falsificado cuando se escribe). SUPUESTO de
 // entorno: lizard REAL ausente del PATH del runner en los tests que
 // congelan conteos de degradaciones (9/5/4) — familia opcional de Python
 // (pip install lizard); si el runner lo tuviera, esos conteos bajan en 1
 // y el dominio pasaría a familiesOk 3.
 process.env.PATH = binDir + ":" + REAL_PATH;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 if (REAL_PATH) process.env.PATH = REAL_PATH;
 rmSync(home, { recursive: true, force: true });
 rmSync(cwd, { recursive: true, force: true });
});

// ── Mock del binario scc (contrato v4.0.0 OBSERVADO en el smoke V1) ───────

/** Despacha por flags: --version / --hotspots / --coupling / --by-author /
 *  -a / --exclude-dir (by-file curada) / default (by-file raw). Los canned
 *  viven junto al binario en bin/scc-mock-data/ (los escribe el test). */
const SCC_MOCK = `#!/usr/bin/env bash
# mock scc v4.0.0 (e2e frida-size-app) — contrato observado del release.
D="$(cd "$(dirname "$0")" && pwd)"
DATA="$D/scc-mock-data"
case " $* " in
  *" --version "*)
    cat "$DATA/version.txt"
    ;;
  *" --hotspots "*)
    cat "$DATA/hotspots.csv"
    ;;
  *" --coupling "*)
    cat "$DATA/coupling.csv"
    ;;
  *" --by-author "*)
    cat "$DATA/by-author.csv"
    ;;
  *" -a "*)
    cat "$DATA/scc-a.json"
    ;;
  *" --exclude-dir "*)
    # --by-file --format json --cognitive --exclude-dir <curada>
    cat "$DATA/by-file-curated.json"
    ;;
  *)
    # --by-file --format json (2ª pasada raw, SIN la exclusión curada)
    cat "$DATA/by-file-raw.json"
    ;;
esac
`;

/** date falsificado (molde M8/M9): cada epoch avanza `step` s (contador en
 *  disco); el formato largo (%Y…) responde fecha fija determinista. El paso
 *  es parametrizable: el corte de size-app compara 2 epochs (bootstrap +
 *  check de analyze) contra deadline = epoch₁ + maxMinutes·60 → con
 *  maxMinutes=1 se necesita paso ≥ 60 s (+90 corta, +30 no). */
const fakeDateScript = (step: number): string => `#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
case "$*" in
  *%Y*)
    printf '2026-08-24 12:00:00 +0000\\n'
    ;;
  *)
    n=0
    if [ -f "$D/date.n" ]; then n=$(cat "$D/date.n"); fi
    n=$((n + 1))
    printf '%s' "$n" > "$D/date.n"
    printf '%s\\n' $((1750000000 + n * ${step}))
    ;;
esac
`;

function writeFakeDate(step = 30): void {
 writeFileSync(join(binDir, "date"), fakeDateScript(step), "utf-8");
 chmodSync(join(binDir, "date"), 0o755);
}

/** lizard falso en .mock-bin (sonda PATH `command -v lizard`): emite el CSV
 *  del contrato (NLOC,CCN,Tokens,Param,Length,Location) — 2 funciones. */
const LIZARD_MOCK = `#!/usr/bin/env bash
# mock lizard --csv (e2e frida-size-app).
cat <<'EOF'
120,10,300,2,60,12:34@core/api.c:handler
80,5,200,1,40,8:20@core/domain.c:parse
EOF
`;

function writeLizardMock(): void {
 writeFileSync(join(binDir, "lizard"), LIZARD_MOCK, "utf-8");
 chmodSync(join(binDir, "lizard"), 0o755);
}

/** Instala el mock de scc AL PIN en el agentDir (binario + canned + marker)
 *  — misma sonda que CAPABILITIES.scc (isSccInstalledAtPin). */
function fixtureSccAtPin(agentDir: string, data: Record<string, string>): void {
 const bin = sccBinPath(agentDir);
 mkdirSync(dirname(bin), { recursive: true });
 writeFileSync(bin, SCC_MOCK, "utf-8");
 chmodSync(bin, 0o755);
 const dataDir = join(agentDir, "bin", "scc-mock-data");
 mkdirSync(dataDir, { recursive: true });
 for (const [name, content] of Object.entries(data)) {
  writeFileSync(join(dataDir, name), content, "utf-8");
 }
 writeFileSync(
  sccMarkerPath(agentDir),
  JSON.stringify({
   pin: SCC_PIN,
   asset: currentSccAsset(),
   sha256: "0".repeat(64),
  }),
 );
}

/** FileJob del contrato v4.0.0 (keys que consume el agregador host-side). */
function fileJob(
 location: string,
 language: string,
 code: number,
 comment: number,
 blank: number,
 complexity: number,
 cognitive: number,
): Record<string, unknown> {
 return {
  Location: location,
  Language: language,
  Lines: code + comment + blank,
  Code: code,
  Comment: comment,
  Blank: blank,
  Complexity: complexity,
  Cognitive: cognitive,
 };
}

// Fixture feliz (kloc 3.6 congelado — verificado con node): 4 archivos
// medidos (min.js filtrado por el agregador), debt 22.5 h (app 7.5 ·
// core 12.5 · lib 2.5 — Σ max(0, cognitiva−15)×0.5 h del agregador locked,
// recomputada tras hallazgo del verificador), raw añade dist/node_modules
// para el volumen excluido.
const APP_MAIN = fileJob("app/main.ts", "TypeScript", 1200, 80, 40, 45, 30);
const CORE_DOMAIN = fileJob(
 "core/domain.ts",
 "TypeScript",
 800,
 30,
 20,
 20,
 12,
);
const CORE_API = fileJob("core/api.ts", "TypeScript", 1500, 60, 50, 60, 40);
const LIB_LEGACY = fileJob("lib/legacy.js", "JavaScript", 100, 10, 5, 10, 20);
const APP_MIN = fileJob("app.min.js", "JavaScript", 5000, 0, 0, 3, 2);
const DIST_BUNDLE = fileJob("dist/bundle.js", "JavaScript", 3000, 10, 5, 10, 5);
const NM_INDEX = fileJob(
 "node_modules/lib/index.js",
 "JavaScript",
 2000,
 5,
 5,
 4,
 2,
);

const HAPPY_CURATED = JSON.stringify([
 {
  Language: "TypeScript",
  Files: [APP_MAIN, CORE_DOMAIN, CORE_API],
 },
 { Language: "JavaScript", Files: [LIB_LEGACY, APP_MIN] },
]);

const HAPPY_RAW = JSON.stringify([
 {
  Language: "TypeScript",
  Files: [APP_MAIN, CORE_DOMAIN, CORE_API],
 },
 {
  Language: "JavaScript",
  Files: [LIB_LEGACY, APP_MIN, DIST_BUNDLE, NM_INDEX],
 },
]);

// Contrato V1 observado: los CSVs churn llevan 1ª línea de comentario
// "# window: …" ANTES del header — el csvBody del helper la salta.
const HOTSPOTS_CSV = [
 "# window: depth=1000 commits=299 from=2026-06-16 to=2026-08-28",
 "File,Language,Complexity,Commits,LinesChanged,Authors,CodeChurn,CommentChurn,Score",
 "core/api.ts,TypeScript,60,12,8,3,90,10,720",
 "app/main.ts,TypeScript,45,8,5,2,40,5,360",
 "lib/legacy.js,JavaScript,10,3,2,1,10,1,60",
 "",
].join("\n");

const COUPLING_CSV = [
 "# window: depth=1000 commits=299 from=2026-06-16 to=2026-08-28",
 "FileA,FileB,Shared,CommitsA,CommitsB,Degree",
 "core/api.ts,core/domain.ts,7,12,3,0.58",
 "app/main.ts,core/api.ts,4,8,12,0.33",
 "",
].join("\n");

// Autor con coma EMBAUTIDA en comillas (fila 1): el parser from-right del
// agregador lo reconstruye (con las comillas literales — documentado).
const BY_AUTHOR_CSV = [
 "# window: depth=1000 commits=299 from=2026-06-16 to=2026-08-28",
 "Author,Email,Code,Complexity,Comment,Files,OwnsPercent,LastCommit,BeforeWindow",
 '"Smith, John",john@x.io,100,10,10,1,2.8,2025-10-01,0',
 "Ada Lovelace,ada@x.io,2500,70,120,2,69.4,2026-01-02,0",
 "Grace Hopper,grace@x.io,1000,50,50,1,27.8,2025-11-30,0",
 "",
].join("\n");

// Contrato V1 observado: el JSON de -a es un array de LanguageSummary con
// "ULOC" POR LENGUAJE y "Files":[] — SIN DRYness global ni ULOC total (la
// tabla de texto plano sí trae DRYness, pero la sonda redirige --format
// json). El helper SUMA los ULOC (2900 + 1300 = 4200 congelado).
const SCC_A_JSON = JSON.stringify([
 { Name: "TypeScript", Files: [], ULOC: 2900 },
 { Name: "JavaScript", Files: [], ULOC: 1300 },
]);

const HAPPY_SCC_DATA: Record<string, string> = {
 "version.txt": "scc version 4.0.0\n",
 "by-file-curated.json": HAPPY_CURATED,
 "by-file-raw.json": HAPPY_RAW,
 "scc-a.json": SCC_A_JSON,
 "hotspots.csv": HOTSPOTS_CSV,
 "coupling.csv": COUPLING_CSV,
 "by-author.csv": BY_AUTHOR_CSV,
};

/** Setup feliz completo: scc al pin + git real + lizard falso. */
function fixtureHappy(runCwd: string = cwd): void {
 fixtureSccAtPin(join(home, ".frida"), HAPPY_SCC_DATA);
 execSync("git init -q", { cwd: runCwd });
 writeLizardMock();
}

/** Escribe un artefacto real en el cwd de la corrida (contrato #83). */
function writeArtifact(base: string, rel: string, content: string): void {
 const p = join(base, rel);
 mkdirSync(dirname(p), { recursive: true });
 writeFileSync(p, content, "utf-8");
}
// ── Spawner mock por anclas de runtime context (contrato del Slice 5) ─────

interface SpawnOptions {
 /** Anexo cuyo escritor NUNCA escribe (claim sin archivo, incluso al
  *  reintentar). */
 liarAnnex?: string;
 /** Anexo que solo escribe en el reintento (ancla FALLA ANTERIOR). */
 flakyAnnex?: string;
 /** Decisión del juez cuando NO hay corte ni degradaciones (default
  *  "PASS"). */
 judgeDecision?: "PASS" | "CONCERNS" | "FAIL";
}

const makeSpawn = (
 opts: SpawnOptions = {},
 seen: string[] = [],
 artifactsCwd: string = cwd,
) =>
 (async (prompt: string) => {
  seen.push(prompt);
  // Escritor de anexo — ancla: bloque "## Tu anexo".
  if (prompt.includes("## Tu anexo")) {
   const file = prompt.match(/Ruta EXACTA donde escribirlo: (\S+)/)?.[1] ?? "";
   const isRetry = prompt.includes("FALLA ANTERIOR");
   if (opts.liarAnnex && file === opts.liarAnnex) {
    return { doc: file, sections: ["claim"], summary: "claim sin archivo" };
   }
   if (opts.flakyAnnex && file === opts.flakyAnnex && !isRetry) {
    return { doc: file, sections: ["falla"], summary: "primera pasada vacía" };
   }
   writeArtifact(
    artifactsCwd,
    file,
    "# Anexo " + file + "\n\nInterpretación mock; cifras en metrics.json.\n",
   );
   return {
    doc: file,
    sections: ["interpretacion"],
    summary: file + " escrito",
   };
  }
  // Juez — ancla: bloque "## Entregables a auditar". Deriva del contexto
  // de corte interpolado (REGLAS RUNTIME del Slice 5): corte wall-clock
  // → CONCERNS; degradaciones declaradas → CONCERNS; si no, opts.
  if (prompt.includes("## Entregables a auditar")) {
   if (/stoppedBy="time"/.test(prompt)) {
    return {
     decision: "CONCERNS",
     findings: [
      {
       severity: "MEDIUM",
       evidence:
        "gap documentado: corrida cortada por time (stoppedBy de metrics.json)",
       fix: "relanzar con tope mayor para cubrir los anexos",
      },
     ],
     summary: "corte conocido",
    };
   }
   const degraded = Number(prompt.match(/degradations=(\d+)/)?.[1] ?? "0");
   if (degraded > 0) {
    return {
     decision: "CONCERNS",
     findings: [
      {
       severity: "MEDIUM",
       evidence: degraded + " familias degradadas declaradas en metrics.json",
       fix: "revisar degradations[] y reintentar con las fuentes disponibles",
      },
     ],
     summary: "familias degradadas",
    };
   }
   if (opts.judgeDecision === "FAIL") {
    return {
     decision: "FAIL",
     findings: [
      {
       severity: "CRITICAL",
       evidence:
        "dimensionamiento.md declara familia churn sin sustento en metrics.json",
       fix: "derivar el informe exclusivamente de metrics.json",
      },
     ],
     summary: "claim falsa",
    };
   }
   return {
    decision: opts.judgeDecision ?? "PASS",
    findings: [],
    summary: "auditoría mock",
   };
  }
  return "echo: " + prompt.slice(0, 40);
 }) as unknown as SpawnAgentFn;

// ── Tipos de metrics.json/return leídos del disco (contrato del Slice 4-5) ─

interface MetricsExclusion {
 what: string;
 kind: string;
 files: number;
 loc: number;
}

interface MetricsDegradation {
 familia: string;
 causa: string;
 hint: string;
}

interface MetricsFamily {
 status: string;
 causa?: string;
 hint?: string;
 rows?: Array<Record<string, unknown>>;
 [key: string]: unknown;
}

interface MetricsDerived {
 computed: boolean;
 causa?: string;
 kloc: number | null;
 files?: number;
 loc?: number;
 debtHours?: number;
 sqale?: {
  ratio: number;
  rating: string;
  formula: string;
  thresholds: Record<string, number>;
 };
 cocomo?: {
  type: string;
  constants: { a: number; b: number; c: number; d: number };
  overhead: number;
  wageMonthly: number;
  currency: string;
  klocSource: string;
  rows: Array<{
   eaf: number;
   effort: number;
   tdev: number;
   people: number | null;
   cost: number;
  }>;
 };
 percentiles?: {
  complexity: { p50: number; p90: number; p99: number; samples: number } | null;
  ccn: { p50: number; p90: number; p99: number; samples: number } | null;
 };
 busFactor?: {
  count: number;
  authorsConsidered: number;
  codeConsidered: number;
  truncated: boolean;
 } | null;
 waves?: {
  eligibleModules: number;
  consideredDebtHours: number;
  tdevCentralMonths: number;
  waves: Array<{
   wave: number;
   modules: string[];
   moduleCount: number;
   debtHours: number;
   share: number;
   weeks: number;
  }>;
 };
 modulesDebt?: Array<{
  name: string;
  files: number;
  loc: number;
  cognitive: number;
  debtHours: number;
 }>;
}

interface Metrics {
 run: {
  pattern: string;
  language: string;
  wage: number;
  currency: string;
  cocomoType: string;
  exclude: string[];
  curatedExclude: string[];
  maxMinutes: number;
  review: string;
  sccVersion: string;
  startedAt: string;
  startedAtEpoch: number;
  finishedAt: string;
  stoppedBy: string;
  stoppedByTime: boolean;
 };
 capabilities: {
  scc: boolean;
  sccPin: string;
  git: boolean;
  lizard: boolean;
  lens: boolean;
  codebaseIndex: boolean;
 };
 exclusions: MetricsExclusion[];
 families: Record<string, MetricsFamily>;
 degradations: MetricsDegradation[];
 annexes: Array<{ key: string; file: string; status: string }>;
 derived: MetricsDerived;
}

interface SaResult {
 pattern: string;
 language: string;
 wage: number;
 currency: string;
 cocomoType: string;
 kloc: number | null;
 sqale: string | null;
 cocomoRange: {
  effortLow: number;
  effortHigh: number;
  costLow: number;
  costHigh: number;
 } | null;
 familiesOk: number;
 familiesTotal: number;
 degradations: number;
 exclusions: number;
 annexes: number;
 stoppedBy: string;
 judge: {
  decision: string;
  findings: Array<{ severity: string; evidence: string; fix: string }>;
  summary: string;
 };
 docs: { informe: string; readme: string; metrics: string };
}

function docPath(base: string, rel: string): string {
 return join(base, ART, rel);
}

function readMetrics(base: string): Metrics {
 return JSON.parse(
  readFileSync(docPath(base, "artifacts/metrics.json"), "utf-8"),
 ) as Metrics;
}

function readReport(base: string): string {
 return readFileSync(docPath(base, "dimensionamiento.md"), "utf-8");
}

/** SAFETY: el return del workflow es el objeto del contrato del Slice 5 —
 *  lo produce el script del patrón; el cast cruza la frontera JsonValue. */
function asResult(value: unknown): SaResult {
 return value as SaResult;
}

describe("frida-size-app · e2e sobre el motor (#139)", () => {
 it("recorrido feliz: metrics 6/6 familias, exclusiones con volumen, 3 anexos, informe determinista, juez PASS", async () => {
  fixtureHappy();
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });
  const seen: string[] = [];

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-1",
   spawnAgent: makeSpawn({}, seen),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.pattern).toBe("size-app");
  expect(r.language).toBe("es-MX");
  expect(r.wage).toBe(35000);
  expect(r.currency).toBe("MXN");
  expect(r.cocomoType).toBe("semi-detached");
  expect(r.kloc).toBe(3.6);
  expect(r.sqale).toBe("A");
  expect(r.familiesOk).toBe(6);
  expect(r.familiesTotal).toBe(6);
  expect(r.degradations).toBe(0);
  expect(r.exclusions).toBe(9);
  expect(r.annexes).toBe(3);
  expect(r.stoppedBy).toBe("");
  expect(r.judge.decision).toBe("PASS");
  // Rango COCOMO del return = bordes del spread (cifras congeladas).
  expect(r.cocomoRange).toEqual({
   effortLow: 10.7,
   effortHigh: 14.5,
   costLow: 899245,
   costHigh: 1216626,
  });
  expect(r.docs).toEqual({
   informe: `${ART}/dimensionamiento.md`,
   readme: `${ART}/README.md`,
   metrics: `${ART}/artifacts/metrics.json`,
  });

  // Entregables y evidencia en disco (nada pre-creado por el test).
  for (const rel of [
   "README.md",
   "dimensionamiento.md",
   "artifacts/metrics.json",
   "artifacts/metrics-agg.js",
   "artifacts/scc-by-file.json",
   "artifacts/scc-by-file-raw.json",
   "artifacts/scc-a.json",
   "artifacts/scc-hotspots.csv",
   "artifacts/scc-coupling.csv",
   "artifacts/scc-by-author.csv",
   "artifacts/lizard.csv",
   ...ANNEX_FILES.map((f) => f.slice(ART.length + 1)),
  ]) {
   expect(existsSync(docPath(cwd, rel)), rel).toBe(true);
  }

  const m = readMetrics(cwd);
  expect(m.run).toMatchObject({
   pattern: "size-app",
   wage: 35000,
   currency: "MXN",
   cocomoType: "semi-detached",
   exclude: [],
   maxMinutes: 0,
   review: "auto",
   stoppedBy: "",
  });
  expect(m.run.sccVersion).toContain("4.0.0");
  expect(m.capabilities).toEqual({
   scc: true,
   sccPin: SCC_PIN,
   git: true,
   lizard: true,
   lens: false,
   codebaseIndex: false,
  });
  expect(Object.keys(m.families).sort()).toEqual([
   "authors",
   "by-file",
   "ccn-funcion",
   "coupling",
   "duplication",
   "hotspots",
  ]);
  for (const name of Object.keys(m.families)) {
   expect(m.families[name].status, name).toBe("ok");
  }
  expect(m.degradations).toEqual([]);
  // Contrato V1: DRYness no vive en el JSON de -a → null; ULOC = suma.
  expect(m.families.duplication).toMatchObject({
   status: "ok",
   drynessPercent: null,
   uloc: 4200,
  });
  // FR-6/D8: exclusión declarada CON volumen (delta de la 2ª pasada raw).
  expect(m.exclusions).toHaveLength(9);
  const byWhat = Object.fromEntries(
   m.exclusions.map((e) => [e.what, e]),
  ) as Record<string, MetricsExclusion>;
  expect(byWhat["dist"]).toEqual({
   what: "dist",
   kind: "dir",
   files: 1,
   loc: 3000,
  });
  expect(byWhat["node_modules"]).toEqual({
   what: "node_modules",
   kind: "dir",
   files: 1,
   loc: 2000,
  });
  expect(byWhat["*.min.js"]).toEqual({
   what: "*.min.js",
   kind: "pattern",
   files: 1,
   loc: 5000,
  });
  expect(byWhat["vendor"]).toEqual({
   what: "vendor",
   kind: "dir",
   files: 0,
   loc: 0,
  });

  // derived (D9): KLOC/deuda/SQALE/percentiles/bus factor/olas.
  expect(m.derived.computed).toBe(true);
  expect(m.derived.kloc).toBe(3.6);
  expect(m.derived.files).toBe(4);
  expect(m.derived.loc).toBe(3600);
  expect(m.derived.debtHours).toBe(22.5);
  expect(m.derived.sqale).toEqual({
   ratio: 0.013,
   rating: "A",
   formula: "deudaHoras / (0.5h × NCLOC)",
   thresholds: { A: 0.05, B: 0.1, C: 0.2, D: 0.5 },
  });
  expect(m.derived.percentiles?.complexity).toEqual({
   p50: 20,
   p90: 60,
   p99: 60,
   samples: 4,
  });
  expect(m.derived.percentiles?.ccn).toEqual({
   p50: 5,
   p90: 10,
   p99: 10,
   samples: 2,
  });
  expect(m.derived.busFactor).toEqual({
   count: 1,
   authorsConsidered: 3,
   codeConsidered: 3600,
   truncated: false,
  });
  expect(m.derived.waves?.waves.map((w) => [w.modules, w.weeks])).toEqual([
   [["core"], 14.7],
   [["app"], 8.8],
   [["lib"], 2.9],
  ]);
  expect(m.derived.modulesDebt?.map((x) => [x.name, x.debtHours])).toEqual([
   ["core", 12.5],
   ["app", 7.5],
   ["lib", 2.5],
  ]);

  // COCOMO (D6): el script usa EXACTAMENTE las constantes exportadas
  // (relación export↔script) y las cifras absolutas están congeladas
  // (verificadas con node — lección (b) del Slice 5).
  const C = COCOMO_CONSTANTS["semi-detached"];
  const kloc = m.derived.kloc as number;
  const expectedRows = COCOMO_EAF_SPREAD.map((eaf) => {
   const effort = C.a * kloc ** C.b * eaf;
   const tdev = C.c * effort ** C.d;
   return {
    eaf,
    effort: Math.round(effort * 10) / 10,
    tdev: Math.round(tdev * 10) / 10,
    people: Math.round((effort / tdev) * 10) / 10,
    cost: Math.round(effort * 35000 * COCOMO_OVERHEAD),
   };
  });
  expect(m.derived.cocomo?.rows).toEqual(expectedRows);
  expect(expectedRows).toEqual([
   { eaf: 0.85, effort: 10.7, tdev: 5.7, people: 1.9, cost: 899245 },
   { eaf: 1, effort: 12.6, tdev: 6.1, people: 2.1, cost: 1057936 },
   { eaf: 1.15, effort: 14.5, tdev: 6.4, people: 2.3, cost: 1216626 },
  ]);

  // Informe 100% determinista desde metrics.json (D3).
  const reporte = readReport(cwd);
  expect(reporte).toContain(
   "## COCOMO — Basic COCOMO 81 (Boehm), tipo semi-detached",
  );
  expect(reporte).toContain(
   "| **1.00** | **12.6** | **6.1** | **2.1** | **$1,057,936** |",
  );
  expect(reporte).toContain("KLOC efectivos: **3.6** (4 archivos");
  expect(reporte).toContain(
   "rating = deudaHoras / (0.5 h × NCLOC) = 0.013 → **A**",
  );
  expect(reporte).toContain("cognitiva − 15) × 0.5 h = **22.5 h**");
  expect(reporte).toContain("Bus factor: **1**");
  expect(reporte).toContain("| O1 (1) | `core` | 12.5 | 56% | 14.7 |");
  expect(reporte).toContain("| O2 (1) | `app` | 7.5 | 33% | 8.8 |");
  expect(reporte).toContain("| O3 (1) | `lib` | 2.5 | 11% | 2.9 |");
  expect(reporte).toContain(
   "| Complejidad por archivo (scc) | 4 | 20 | 60 | 60 |",
  );
  expect(reporte).toContain("| CCN por función (lizard) | 2 | 5 | 10 | 10 |");
  expect(reporte).toContain("| `dist` | dir | 1 | 3,000 |");
  expect(reporte).toContain("| `node_modules` | dir | 1 | 2,000 |");
  expect(reporte).toContain("| `*.min.js` | pattern | 1 | 5,000 |");
  expect(reporte).toContain("| `core/api.ts` | 60 | 12 | 3 | 720 |");
  expect(reporte).toContain("`core/api.ts` ↔ `core/domain.ts`");
  // Contrato V1: DRYness n/d (no vive en el JSON de -a), ULOC = 4200.
  expect(reporte).toContain("DRYness: n/d · ULOC: 4,200");
  expect(reporte).toContain("[analisis/hotspots.md](analisis/hotspots.md)");
  expect(reporte).toContain("## Cómo auditar");
  expect(reporte).not.toContain("## Degradaciones");
  expect(reporte).toContain("scc: scc version 4.0.0");

  // README: índice determinista SIN veredicto del juez (corre después).
  const readme = readFileSync(docPath(cwd, "README.md"), "utf-8");
  expect(readme).toContain("[dimensionamiento.md](dimensionamiento.md)");
  expect(readme).toContain("wage MXN 35000.00/mes");
  expect(readme).toContain("| `by-file` | ok |");
  expect(readme).toContain("| `ccn-funcion` | ok |");
  expect(readme).not.toContain("PASS");
  expect(readme).not.toContain("CONCERNS");

  // Contrato D11: el preamble (juez de números + veto) viaja en TODOS
  // los prompts; el escritor lee metrics.json de disco (no re-sondea).
  expect(seen.length).toBeGreaterThanOrEqual(4); // 3 escritores + juez
  for (const p of seen) {
   expect(p).toContain("JUEZ DE NÚMEROS");
   expect(p).toContain("VETADO");
  }
  // Orden-independiente (hallazgo de la validación, blocker b1): el orden
  // de despacho del fanout paralelo no está garantizado bajo carga — el
  // find se ancla al anexo objetivo, no al primer escritor visto.
  const writerPrompt = seen.find((p) =>
   p.includes("Ruta EXACTA donde escribirlo: " + ANNEX_FILES[0]),
  );
  expect(writerPrompt).toContain("## Tu anexo");
  expect(writerPrompt).toContain(`${ART}/artifacts/metrics.json`);
  const judgePrompt = seen.find((p) => p.includes("## Entregables a auditar"));
  expect(judgePrompt).toContain("degradations=0");
 }, 45000);

 it("degradación total (sin scc/git/lizard): 9 degradaciones, rama no computable, juez CONCERNS, sin abortar", async () => {
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-2",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.kloc).toBeNull();
  expect(r.sqale).toBeNull();
  expect(r.familiesOk).toBe(0);
  expect(r.familiesTotal).toBe(0);
  expect(r.degradations).toBe(9); // 5 scc + 3 git + 1 lizard (locked)
  expect(r.annexes).toBe(3); // analyze corrió igual (deadline 0)
  expect(r.judge.decision).toBe("CONCERNS");

  const m = readMetrics(cwd);
  expect(m.capabilities).toEqual({
   scc: false,
   sccPin: SCC_PIN,
   git: false,
   lizard: false,
   lens: false,
   codebaseIndex: false,
  });
  expect(m.families).toEqual({}); // el agregador no corrió (FR-7)
  expect(m.exclusions).toEqual([]);
  expect(m.degradations.map((d) => d.familia)).toEqual([
   "by-file",
   "duplication",
   "hotspots",
   "coupling",
   "authors",
   "hotspots",
   "coupling",
   "authors",
   "ccn-funcion",
  ]);
  expect(m.derived.computed).toBe(false);

  // Informe honesto: rama no computable + familias "no disponible".
  const reporte = readReport(cwd);
  expect(reporte).toContain("## Dimensionamiento no computable");
  expect(reporte).toContain("No disponible (familia authors degradada");
  expect(existsSync(docPath(cwd, "artifacts/scc-by-file.json"))).toBe(false);
 }, 30000);

 it("familia corrupta mid-run (by-file no-JSON): degradación del helper SIN duplicar gates de bootstrap (FR-7)", async () => {
  fixtureSccAtPin(join(home, ".frida"), {
   ...HAPPY_SCC_DATA,
   "by-file-curated.json": "no es json{{{",
  });
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-3",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  // 3 git + 1 lizard (bootstrap, sin fixture) + 1 by-file parse-error
  // (helper) — hasDegradation evita duplicar las de bootstrap.
  expect(r.degradations).toBe(5);
  expect(r.familiesOk).toBe(1); // duplication ok
  expect(r.familiesTotal).toBe(6);
  expect(r.kloc).toBeNull();
  expect(r.judge.decision).toBe("CONCERNS");

  const m = readMetrics(cwd);
  expect(m.families["by-file"].status).toBe("parse-error");
  expect(m.families["by-file"].causa).toContain("no es JSON válido");
  expect(m.derived.computed).toBe(false);
  expect(readReport(cwd)).toContain("## Dimensionamiento no computable");
 }, 30000);

 it("corta por wall-clock (maxMinutes=1): stoppedBy=time, anexos no generados, synthesize/judge siguen (FR-11)", async () => {
  fixtureHappy();
  // +90 s por epoch: epoch₁=1750000090 → deadline=1750000150; el check
  // de analyze (epoch₂=1750000180) lo vence. (+30 s NO cortaría: solo
  // hay 2 lecturas de epoch en el camino — bootstrap y el check.)
  writeFakeDate(90);
  const args = {
   wage: 35000,
   currency: "MXN",
   maxMinutes: 1,
   review: "auto",
  };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-4",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.stoppedBy).toBe("time");
  expect(r.annexes).toBe(0);
  expect(r.kloc).toBe(3.6); // synthesize corrió sobre lo alcanzado
  expect(r.judge.decision).toBe("CONCERNS"); // regla runtime duplicada (D11)

  const m = readMetrics(cwd);
  expect(m.run.startedAt).toBe("2026-08-24 12:00:00 +0000");
  expect(m.run.startedAtEpoch).toBe(1750000090);
  expect(m.run.stoppedBy).toBe("time");
  expect(m.run.stoppedByTime).toBe(true);
  expect(m.annexes).toEqual([]);
  for (const f of ANNEX_FILES) {
   expect(existsSync(join(cwd, f)), f).toBe(false);
  }
  const reporte = readReport(cwd);
  expect(reporte).toContain("No generados — corte por tiempo antes de analyze");
 }, 30000);

 it("escritor mentiroso: gate test -s falla el run tras el reintento informado (#83 redux)", async () => {
  fixtureHappy();
  const liar = ANNEX_FILES[0];
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });
  const seen: string[] = [];

  const promise = runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-5",
   spawnAgent: makeSpawn({ liarAnnex: liar }, seen),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  await expect(promise).rejects.toThrow(/NO escribieron/);
  expect(
   seen.some(
    (p) => p.includes("FALLA ANTERIOR") && p.includes("analisis/hotspots.md"),
   ),
  ).toBe(true);
  expect(existsSync(join(cwd, liar))).toBe(false);
  // El throw es en analyze: el informe aún no se escribe.
  expect(existsSync(docPath(cwd, "dimensionamiento.md"))).toBe(false);
 }, 30000);

 it("escritor flaky: el reintento informado rescata la corrida", async () => {
  fixtureHappy();
  const flaky = ANNEX_FILES[1];
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-6",
   spawnAgent: makeSpawn({ flakyAnnex: flaky }),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  expect(existsSync(join(cwd, flaky))).toBe(true);
  const r = asResult(result);
  expect(r.annexes).toBe(3);
  expect(r.judge.decision).toBe("PASS");
 }, 30000);

 it("caso negativo del juez: FAIL viaja en el return sin abortar (V5)", async () => {
  fixtureHappy();
  const args = { wage: 35000, currency: "MXN", review: "auto" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-7",
   spawnAgent: makeSpawn({ judgeDecision: "FAIL" }),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.judge.decision).toBe("FAIL");
  expect(r.judge.findings[0]?.severity).toBe("CRITICAL");
  expect(r.judge.findings[0]?.evidence).toMatch(/metrics\.json/);
  // El FAIL NO aborta: los entregables quedaron en disco.
  expect(existsSync(docPath(cwd, "dimensionamiento.md"))).toBe(true);
 }, 30000);

 it("checkpoint final solo con review=manual: size-app-final aprobado", async () => {
  fixtureHappy();
  const args = { wage: 35000, currency: "MXN", review: "manual" };
  const script = SIZE_APP_PATTERN.resolve(args, { cwd });
  const checkpoints: Array<{ name: string }> = [];
  const runId = randomUUID();

  const promise = runWorkflowInStore({
   name: "size-app",
   script,
   args,
   cwd,
   sessionId: "sess-size-8",
   spawnAgent: makeSpawn(),
   home,
   runId,
   foreground: false,
   onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
  });

  await waitUntil(() => checkpoints.length >= 1);
  expect(checkpoints[0]?.name).toBe("size-app-final");
  resolveCheckpoint(runId, "size-app-final", true);

  const { result } = await promise;
  const r = asResult(result);
  expect(r.kloc).toBe(3.6);
  expect(r.judge.decision).toBe("PASS");
 }, 30000);

 it("determinismo: dos corridas idénticas → derived/exclusions/by-file deep-equal", async () => {
  fixtureHappy();
  const runOnce = async () => {
   const runCwd = mkdtempSync(join(tmpdir(), "size-e2e-det-"));
   execSync("git init -q", { cwd: runCwd });
   const args = { wage: 35000, currency: "MXN", review: "auto" };
   const script = SIZE_APP_PATTERN.resolve(args, { cwd: runCwd });
   await runWorkflowInStore({
    name: "size-app",
    script,
    args,
    cwd: runCwd,
    sessionId: "sess-size-det",
    spawnAgent: makeSpawn({}, [], runCwd),
    home,
    runId: randomUUID(),
    foreground: false,
   });
   const m = readMetrics(runCwd);
   rmSync(runCwd, { recursive: true, force: true });
   return m;
  };
  const first = await runOnce();
  const second = await runOnce();
  expect(second.derived).toEqual(first.derived);
  expect(second.exclusions).toEqual(first.exclusions);
  expect(second.families["by-file"]).toEqual(first.families["by-file"]);
 }, 60000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows (molde M8). */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
 const deadline = Date.now() + ms;
 while (!cond()) {
  if (Date.now() > deadline) throw new Error("timeout esperando condición");
  await new Promise((res) => setTimeout(res, 20));
 }
}
