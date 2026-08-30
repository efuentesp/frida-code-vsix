// M3 (#144) — lib host de frida-sonar (Node puro, sin vscode).
// Fixtures honestos (lecciones 30ef616/9d6d8bb): reproducen el shape REAL del
// bus y de details verificado contra ~/.frida/npm/node_modules/pi-lens@3.8.72 —
// el contrato del externo miente en las interfaces tipadas (LensDiagnostic
// declara range/code/source/semantic que el bus NUNCA envía).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  anyTruncated,
  BLOCKING_FAMILIES,
  buildTurnSnapshot,
  computeVerdict,
  diffIssues,
  EMPTY_SONAR_THRESHOLDS,
  familyOf,
  flattenIssues,
  issueKey,
  mergeSonarPayload,
  normalizeRuleForDedup,
  parseLensDetails,
  progressLineFromUpdate,
  runnerToFamily,
  sanitizeDisabledFamilies,
  SONAR_FAMILIES,
  SONAR_GATE_SCHEMA,
  type LensDetailsAggregates,
  type SonarConsolidated,
  type SonarIssue,
} from "../src/sonar/gate";
import {
  appendEntry,
  emptySnapshot,
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  type SonarSnapshotFile,
} from "../src/sonar/snapshot-store";

const CWD = path.join(path.sep, "repo", "proj");

/** Evento del bus con el shape REAL 3.8.72: {v, source, cwd, seq, ts, files[{path,
 *  diagnostics[{severity, message, tool, ruleId?, line?, col?, fixable?}], truncated?}]}
 *  — SIN range/code/source/semantic POR DIAGNÓSTICO (el payload-level `source`
 *  sí existe). severity dual: string normalizado o número LSP crudo. */
function busPayload(
  seq: number,
  files: Array<{
    path: string;
    diagnostics: Array<Record<string, unknown>>;
    truncated?: boolean;
  }>,
): any {
  return { v: 1, source: "pi-lens", cwd: CWD, seq, ts: 1750000000000, files };
}

const D_ERR = {
  severity: "error",
  message: "undefined name",
  tool: "ruff",
  ruleId: "F821",
  line: 42,
  col: 8,
  fixable: false,
};
const D_ERR_LSP = {
  severity: 1,
  message: "Type 'string' is not assignable",
  tool: "tsserver",
  line: 7,
};
const D_WARN = {
  severity: "warning",
  message: "unused var",
  tool: "biome",
  ruleId: "noUnusedVariables",
  line: 3,
};
const D_INFO = { severity: 3, message: "hint", tool: "tsserver", line: 9 };

// ── Constantes congeladas ────────────────────────────────────────────────────

describe("sonar lib · constantes congeladas", () => {
  it("SONAR_GATE_SCHEMA es frida-sonar-gate/v1", () => {
    expect(SONAR_GATE_SCHEMA).toBe("frida-sonar-gate/v1");
  });

  it("SONAR_FAMILIES tiene las 8 familias y las bloqueantes son errores/secrets/cve", () => {
    expect(SONAR_FAMILIES).toHaveLength(8);
    expect(BLOCKING_FAMILIES).toEqual(["errores", "secrets", "cve"]);
    for (const b of BLOCKING_FAMILIES) expect(SONAR_FAMILIES).toContain(b);
  });
});

// ── Identidad de issue ───────────────────────────────────────────────────────

describe("sonar lib · issueKey / normalizeRuleForDedup (convención diagnosticDedupKey)", () => {
  it("normaliza 'ast-grep:regla-js' → 'regla' (prefix + sufijo)", () => {
    expect(normalizeRuleForDedup("ast-grep:no-console-js")).toBe("no-console");
    expect(normalizeRuleForDedup("F821")).toBe("F821");
  });

  it("key = path:line:rule con rule; line ausente → '?'; sin rule → tool", () => {
    expect(issueKey("src/a.ts", 42, "F821", "ruff")).toBe("src/a.ts:42:F821");
    expect(issueKey("src/a.ts", undefined, undefined, "biome")).toBe(
      "src/a.ts:?:biome",
    );
  });
});

// ── Familias ─────────────────────────────────────────────────────────────────

describe("sonar lib · familyOf / runnerToFamily", () => {
  it("error: gitleaks→secrets, trivy/govulncheck→cve, resto→errores", () => {
    expect(familyOf("error", "gitleaks")).toBe("secrets");
    expect(familyOf("error", "trivy")).toBe("cve");
    expect(familyOf("error", "govulncheck")).toBe("cve");
    expect(familyOf("error", "ruff")).toBe("errores");
    expect(familyOf("error", "tsserver")).toBe("errores");
  });

  it("warning: jscpd→dup, madge→ciclos, knip→dead-code, complejidad por rule, resto→warnings", () => {
    expect(familyOf("warning", "jscpd")).toBe("dup");
    expect(familyOf("warning", "madge")).toBe("ciclos");
    expect(familyOf("warning", "knip")).toBe("dead-code");
    expect(familyOf("warning", "eslint", "max-complexity")).toBe("complejidad");
    expect(familyOf("warning", "fact-rules")).toBe("complejidad");
    expect(familyOf("warning", "biome")).toBe("warnings");
    // warning-level de un runner bloqueante no hereda la familia FAIL:
    expect(familyOf("warning", "gitleaks")).toBe("warnings");
  });

  it("sanitizeDisabledFamilies: dedupe + drop desconocidas + drop bloqueantes", () => {
    expect(
      sanitizeDisabledFamilies(["warnings", "errores", "nope", "warnings"]),
    ).toEqual(["warnings"]);
    expect(sanitizeDisabledFamilies(["secrets", "cve"])).toEqual([]);
  });
});

// ── Consolidación del bus ────────────────────────────────────────────────────

describe("sonar lib · mergeSonarPayload (semántica del productor)", () => {
  it("full-replace por archivo: evento posterior reemplaza TODO lo del path", () => {
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(1, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_ERR, D_WARN] },
      ]),
      CWD,
    );
    mergeSonarPayload(
      st,
      busPayload(2, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_WARN] },
      ]),
      CWD,
    );
    const flat = flattenIssues(st);
    expect(flat).toHaveLength(1);
    expect(flat[0].severity).toBe("warning");
  });

  it("diagnostics: [] = archivo limpio → se elimina del consolidado", () => {
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(1, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_ERR] },
      ]),
      CWD,
    );
    mergeSonarPayload(
      st,
      busPayload(2, [{ path: path.join(CWD, "src/a.ts"), diagnostics: [] }]),
      CWD,
    );
    expect(flattenIssues(st)).toHaveLength(0);
  });

  it("out-of-order: un evento con seq MENOR al ya visto para el path se ignora", () => {
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(5, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_WARN] },
      ]),
      CWD,
    );
    mergeSonarPayload(
      st,
      busPayload(3, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_ERR] },
      ]),
      CWD,
    );
    const flat = flattenIssues(st);
    expect(flat).toHaveLength(1);
    expect(flat[0].severity).toBe("warning"); // el seq 3 (error) se ignoró
  });

  it("severity dual: número LSP 1 → error; string 'warning' → warning; info (3) se descarta", () => {
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(1, [
        {
          path: path.join(CWD, "src/x.ts"),
          diagnostics: [D_ERR_LSP, D_WARN, D_INFO],
        },
      ]),
      CWD,
    );
    const flat = flattenIssues(st);
    expect(flat).toHaveLength(2);
    expect(flat.filter((i) => i.severity === "error")).toHaveLength(1);
    expect(flat.filter((i) => i.severity === "warning")).toHaveLength(1);
  });

  it("paths absolutos se relativizan al cwd; la issue NO transporta message", () => {
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(1, [
        { path: path.join(CWD, "src/deep/b.ts"), diagnostics: [D_ERR] },
      ]),
      CWD,
    );
    const flat = flattenIssues(st);
    expect(flat[0].path).toBe(path.join("src", "deep", "b.ts"));
    expect(JSON.stringify(flat[0])).not.toContain("message");
    expect("message" in flat[0]).toBe(false);
  });

  it("truncated por archivo queda expuesto vía anyTruncated", () => {
    const clean: SonarConsolidated = new Map();
    mergeSonarPayload(
      clean,
      busPayload(1, [
        { path: path.join(CWD, "src/a.ts"), diagnostics: [D_WARN] },
      ]),
      CWD,
    );
    expect(anyTruncated(clean)).toBe(false);
    const st: SonarConsolidated = new Map();
    mergeSonarPayload(
      st,
      busPayload(1, [
        {
          path: path.join(CWD, "src/a.ts"),
          diagnostics: [D_WARN],
          truncated: true,
        },
      ]),
      CWD,
    );
    expect(anyTruncated(st)).toBe(true);
  });
});

// ── Veredicto ────────────────────────────────────────────────────────────────

const det = (
  o: Partial<LensDetailsAggregates> = {},
): LensDetailsAggregates => ({
  mode: "all",
  filesChecked: 4,
  filesWithIssues: 1,
  totalBlocking: 0,
  totalErrors: 0,
  totalWarnings: 0,
  ...o,
});

const w = (family: SonarIssue["family"], n = 1): SonarIssue[] =>
  Array.from({ length: n }, () => ({
    key: `k-${family}-${Math.random()}`,
    path: "src/a.ts",
    tool: "biome",
    severity: "warning" as const,
    family,
  }));

describe("sonar lib · computeVerdict (D3)", () => {
  it("FAIL por totalBlocking; también FAIL por totalErrors con blocking 0", () => {
    expect(
      computeVerdict({
        details: det({ totalBlocking: 1 }),
        issues: [],
        thresholds: EMPTY_SONAR_THRESHOLDS,
      }).verdict,
    ).toBe("fail");
    expect(
      computeVerdict({
        details: det({ totalErrors: 2 }),
        issues: [],
        thresholds: EMPTY_SONAR_THRESHOLDS,
      }).verdict,
    ).toBe("fail");
  });

  it("WARN si warnings > maxWarnings; PASS si ≤ (AC umbrales en vivo, mismo fixture)", () => {
    const d = det({ totalWarnings: 3 });
    expect(
      computeVerdict({
        details: d,
        issues: [],
        thresholds: { maxWarnings: 0, disabledFamilies: [] },
      }).verdict,
    ).toBe("warn");
    expect(
      computeVerdict({
        details: d,
        issues: [],
        thresholds: { maxWarnings: 3, disabledFamilies: [] },
      }).verdict,
    ).toBe("pass");
  });

  it("exclusión best-effort: resta warnings de familias deshabilitadas según el consolidado (clamp ≥0)", () => {
    // totalWarnings 5, consolidado con 2 warnings familia "warnings" deshabilitada
    const issues = w("warnings", 2);
    const d = det({ totalWarnings: 5 });
    const th = { maxWarnings: 2, disabledFamilies: ["warnings" as const] };
    const r = computeVerdict({ details: d, issues, thresholds: th });
    expect(r.effectiveWarnings).toBe(3);
    expect(r.verdict).toBe("warn"); // 3 > 2
    expect(
      computeVerdict({
        details: d,
        issues,
        thresholds: { ...th, maxWarnings: 3 },
      }).verdict,
    ).toBe("pass");
  });

  it("familias bloqueantes jamás deshabilitables: disabled [errores] con totalBlocking 1 → FAIL", () => {
    const r = computeVerdict({
      details: det({ totalBlocking: 1 }),
      issues: [],
      thresholds: { maxWarnings: 0, disabledFamilies: ["errores" as const] },
    });
    expect(r.verdict).toBe("fail");
  });

  it("no-data honesto: sin filesChecked/filesWithIssues y consolidado vacío", () => {
    const r = computeVerdict({
      details: {},
      issues: [],
      thresholds: EMPTY_SONAR_THRESHOLDS,
    });
    expect(r.verdict).toBe("no-data");
    // con issues en el consolidado ya hay datos:
    expect(
      computeVerdict({
        details: {},
        issues: w("warnings", 1),
        thresholds: EMPTY_SONAR_THRESHOLDS,
      }).verdict,
    ).toBe("pass");
  });

  it("degradado: timedOut/partial → degraded con causas; coldRunners → familias no disponibles", () => {
    const r = computeVerdict({
      details: det({
        totalWarnings: 1,
        timedOut: true,
        partial: true,
        coldRunners: ["trivy", "weird-runner"],
      }),
      issues: [],
      thresholds: EMPTY_SONAR_THRESHOLDS,
    });
    expect(r.degraded).toBe(true);
    expect(r.causes).toHaveLength(2);
    expect(r.familiesUnavailable.map((f) => f.family)).toEqual([
      "cve",
      "weird-runner",
    ]);
  });
});

describe("sonar lib · parseLensDetails (lenient 3.8.72)", () => {
  it("unknown/basura → objeto sin campos; números/arrays correctos pasan", () => {
    expect(parseLensDetails(null)).toEqual({});
    expect(parseLensDetails("x")).toEqual({});
    expect(
      parseLensDetails({
        mode: "all",
        filesWithIssues: 2,
        totalBlocking: 1,
        coldRunners: ["knip", 5],
      }),
    ).toEqual({
      mode: "all",
      filesWithIssues: 2,
      totalBlocking: 1,
      coldRunners: ["knip"],
    });
  });
});

// ── Diff ─────────────────────────────────────────────────────────────────────

describe("sonar lib · diffIssues", () => {
  it("+N −M por identidad key, con desglose por familia", () => {
    const a = {
      key: "a",
      path: "a.ts",
      tool: "t",
      severity: "error" as const,
      family: "errores" as const,
    };
    const b = {
      key: "b",
      path: "b.ts",
      tool: "t",
      severity: "warning" as const,
      family: "warnings" as const,
    };
    const c = {
      key: "c",
      path: "c.ts",
      tool: "t",
      severity: "warning" as const,
      family: "complejidad" as const,
    };
    const d = diffIssues([a, b], [b, c]);
    expect(d.added).toBe(1);
    expect(d.resolved).toBe(1);
    expect(d.addedByFamily).toEqual({ complejidad: 1 });
    expect(d.resolvedByFamily).toEqual({ errores: 1 });
  });
});

// ── buildTurnSnapshot ────────────────────────────────────────────────────────

describe("sonar lib · buildTurnSnapshot (una sola fuente de verdad, 40c7d20)", () => {
  it("entrada completa + invariante Σ countsPorFamilia == issues.length", () => {
    const issues: SonarIssue[] = [
      {
        key: "a.ts:1:F821",
        path: "a.ts",
        line: 1,
        rule: "F821",
        tool: "ruff",
        severity: "error",
        family: "errores",
      },
      {
        key: "b.ts:2:noUnused",
        path: "b.ts",
        line: 2,
        rule: "noUnused",
        tool: "biome",
        severity: "warning",
        family: "warnings",
      },
    ];
    const prev: SonarIssue[] = [
      {
        key: "a.ts:1:F821",
        path: "a.ts",
        line: 1,
        rule: "F821",
        tool: "ruff",
        severity: "error",
        family: "errores",
      },
      {
        key: "z.ts:9:old",
        path: "z.ts",
        line: 9,
        rule: "old",
        tool: "biome",
        severity: "warning",
        family: "warnings",
      },
    ];
    const snap = buildTurnSnapshot({
      ts: 1750000000123,
      details: {
        mode: "all",
        filesWithIssues: 2,
        totalBlocking: 1,
        totalErrors: 1,
        totalWarnings: 1,
      },
      issues,
      prevIssues: prev,
      thresholds: EMPTY_SONAR_THRESHOLDS,
    });
    expect(snap.entry.verdict).toBe("fail");
    expect(snap.entry.ts).toBe(1750000000123);
    expect(snap.entry.diff).toEqual({ added: 1, resolved: 1 });
    const total = Object.values(snap.entry.countsPorFamilia).reduce(
      (s, n) => s + (n ?? 0),
      0,
    );
    expect(total).toBe(snap.issues.length);
    expect(snap.issues).toHaveLength(2);
  });

  it("familias deshabilitadas excluidas de issues persistidas y del diff", () => {
    const issues: SonarIssue[] = [
      {
        key: "a:1:x",
        path: "a.ts",
        line: 1,
        tool: "eslint",
        severity: "warning",
        family: "complejidad",
      },
      {
        key: "b:2:y",
        path: "b.ts",
        line: 2,
        tool: "biome",
        severity: "warning",
        family: "warnings",
      },
    ];
    const snap = buildTurnSnapshot({
      ts: 1,
      details: { totalWarnings: 2, filesWithIssues: 2 },
      issues,
      prevIssues: [],
      thresholds: { maxWarnings: 0, disabledFamilies: ["complejidad"] },
    });
    expect(snap.issues.map((i) => i.key)).toEqual(["b:2:y"]);
    expect(snap.entry.countsPorFamilia).toEqual({ warnings: 1 });
    // best-effort: la warning deshabilitada también se resta del conteo:
    expect(snap.entry.warnings).toBe(1);
  });
});

// ── snapshot-store ───────────────────────────────────────────────────────────

let tmp: string;
afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined as unknown as string;
  }
});

describe("sonar lib · snapshot-store (JSON único, FIFO, 0600, no-throw)", () => {
  it("snapshotPath espeja el patrón workflows: <base>/sonar/<encodeCwd>/snapshot.json", () => {
    const p = snapshotPath("/gs", CWD);
    const encoded = CWD.replace(/[^a-zA-Z0-9._-]/g, "_").replace(
      /^_+|_+$/g,
      "",
    );
    expect(p).toBe(path.join("/gs", "sonar", encoded, "snapshot.json"));
  });

  it("AC FRD: fixture con historyLimit+1 entradas queda podado FIFO a historyLimit", () => {
    let snap = emptySnapshot(CWD);
    const limit = 3;
    for (let i = 0; i < limit + 1; i++) {
      snap = appendEntry(
        snap,
        {
          ts: i,
          verdict: "pass",
          degraded: false,
          blocking: 0,
          errors: 0,
          warnings: 0,
          diff: { added: 0, resolved: 0 },
          countsPorFamilia: {},
        },
        [],
        limit,
      );
    }
    expect(snap.entries).toHaveLength(limit);
    expect(snap.entries[0].ts).toBe(1); // la más vieja (ts 0) fue evicted
    expect(snap.entries.at(-1)?.ts).toBe(limit);
  });

  it("historyLimit inválido (0) se clampea a 1: siempre queda la última", () => {
    let snap = emptySnapshot(CWD);
    snap = appendEntry(
      snap,
      {
        ts: 1,
        verdict: "pass",
        degraded: false,
        blocking: 0,
        errors: 0,
        warnings: 0,
        diff: { added: 0, resolved: 0 },
        countsPorFamilia: {},
      },
      [],
      0,
    );
    snap = appendEntry(
      snap,
      {
        ts: 2,
        verdict: "warn",
        degraded: false,
        blocking: 0,
        errors: 0,
        warnings: 1,
        diff: { added: 0, resolved: 0 },
        countsPorFamilia: {},
      },
      [],
      0,
    );
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0].ts).toBe(2);
  });

  it("save/load roundtrip: crea dirs, persiste y recupera intacto (modo 0600 en POSIX)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-lib-"));
    const file = snapshotPath(tmp, CWD);
    const issues: SonarIssue[] = [
      {
        key: "a.ts:42:F821",
        path: "a.ts",
        line: 42,
        rule: "F821",
        tool: "ruff",
        severity: "error",
        family: "errores",
      },
    ];
    let snap = emptySnapshot(CWD);
    snap = appendEntry(
      snap,
      {
        ts: 99,
        verdict: "fail",
        degraded: false,
        blocking: 1,
        errors: 1,
        warnings: 0,
        diff: { added: 1, resolved: 0 },
        countsPorFamilia: { errores: 1 },
      },
      issues,
      500,
    );
    expect(saveSnapshot(file, snap)).toBe(true);
    const back = loadSnapshot(file);
    expect(back).toEqual(snap);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    // NFR secrets: el archivo persistido no contiene message de diagnóstico:
    expect(fs.readFileSync(file, "utf8")).not.toContain("undefined name");
  });

  it("loadSnapshot tolerante: inexistente/corrupto/schema desconocido → undefined", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-lib-"));
    expect(loadSnapshot(path.join(tmp, "nope.json"))).toBeUndefined();
    const corrupt = path.join(tmp, "corrupt.json");
    fs.writeFileSync(corrupt, "{ no json", "utf8");
    expect(loadSnapshot(corrupt)).toBeUndefined();
    const future: SonarSnapshotFile = {
      schema: "frida-sonar-gate/v2",
      cwd: CWD,
      entries: [],
      issues: [],
    };
    const fpath = path.join(tmp, "v2.json");
    fs.writeFileSync(fpath, JSON.stringify(future), "utf8");
    expect(loadSnapshot(fpath)).toBeUndefined();
  });

  it("saveSnapshot no-throw: path inválido (padre es archivo) → false", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-lib-"));
    const blocker = path.join(tmp, "afile");
    fs.writeFileSync(blocker, "x", "utf8");
    expect(
      saveSnapshot(
        path.join(blocker, "sub", "snapshot.json"),
        emptySnapshot(CWD),
      ),
    ).toBe(false);
  });
});

// ── Gate completo bajo demanda (FR-7, Slice 6) ───────────────────────────────

describe("sonar lib · progressLineFromUpdate (contrato onUpdate 3.8.72)", () => {
  /** Payload REAL del productor (scan-progress.js): el texto trae la barra de
   *  bloques del productor (glifos prohibidos por NFR UX) — la línea debe
   *  salir de details.completed/total, NUNCA del texto. */
  const scanUpdate = (completed: number, total: number): any => ({
    content: [
      {
        type: "text",
        text: `Scanning project diagnostics… [${"█".repeat(9)}${"░".repeat(11)}] ${completed}/${total}`,
      },
    ],
    details: { phase: "scanning", completed, total },
  });

  it("deriva la línea de details.completed/total (ASCII, pct redondeado)", () => {
    expect(progressLineFromUpdate(scanUpdate(45, 123))).toBe(
      "Escaneando diagnósticos del proyecto… 45/123 (37%)",
    );
  });

  it("NFR UX: la línea JAMÁS contiene la barra de bloques del productor", () => {
    const line = progressLineFromUpdate(scanUpdate(45, 123)) ?? "";
    expect(line).not.toMatch(/[█░]/);
  });

  it("total 0 → sin porcentaje; shapes no-scanning/basura → undefined", () => {
    expect(progressLineFromUpdate(scanUpdate(0, 0))).toBe(
      "Escaneando diagnósticos del proyecto… 0/0",
    );
    expect(progressLineFromUpdate(undefined)).toBeUndefined();
    expect(progressLineFromUpdate("x")).toBeUndefined();
    expect(
      progressLineFromUpdate({ content: [], details: { phase: "done" } }),
    ).toBeUndefined();
    expect(
      progressLineFromUpdate({
        details: { phase: "scanning", completed: "x", total: [] },
      }),
    ).toBe("Escaneando diagnósticos del proyecto… 0/0");
  });
});

describe("sonar lib · details de mode=full (lenient, campos extra ignorados)", () => {
  it("analyzerTimingsMs/analyzersAborted* desconocidos no rompen el parse; coldRunners vacío pasa", () => {
    const d = parseLensDetails({
      mode: "full",
      filesWithIssues: 7,
      totalBlocking: 2,
      totalErrors: 2,
      totalWarnings: 89,
      coldRunners: [],
      analyzerTimingsMs: { knip: 1200, trivy: 180000 },
      analyzersAborted: 1,
      analyzersAbortedIds: ["trivy"],
    });
    expect(d).toEqual({
      mode: "full",
      filesWithIssues: 7,
      totalBlocking: 2,
      totalErrors: 2,
      totalWarnings: 89,
      coldRunners: [],
    });
  });
});
