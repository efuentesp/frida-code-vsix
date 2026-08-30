// M3 (#144) — persistencia del snapshot de sonar por proyecto.
//
// JSON único con poda FIFO EN LA ESCRITURA (ningún JSONL del repo poda — el FIFO
// es contrato de escritura del FR-9). No-throw SIEMPRE (molde pilens-config.ts):
// un fallo de FS degrada (save=false / load=undefined), nunca rompe el turno.
//
// NFR secrets: el archivo persiste refs {key,path,line?,rule?,tool,severity,
// family} — JAMÁS `message` de diagnóstico (gate.ts lo garantiza por tipo).

import fs from "node:fs";
import path from "node:path";
import { encodeCwd } from "../tools/frida-workflow/audit";
import { SONAR_GATE_SCHEMA, type SonarEntry, type SonarIssue } from "./gate";

/** Shape del snapshot.json (schema aditivo = sigue v1 — molde frida-usage-report/v1). */
export interface SonarSnapshotFile {
  schema: string;
  cwd: string;
  /** Historial por turno (FIFO al historyLimit). */
  entries: SonarEntry[];
  /** Issue-set consolidado ACTUAL (para diff tras reload/reinicio — FR-2). */
  issues: SonarIssue[];
}

/** Path canónico: <baseDir>/sonar/<encodeCwd(cwd)>/snapshot.json (espejo del
 *  patrón workflows/<encodeCwd>/runs — audit.ts:22-25). */
export function snapshotPath(baseDir: string, cwd: string): string {
  return path.join(baseDir, "sonar", encodeCwd(cwd), "snapshot.json");
}

/** Snapshot vacío (primer uso / degradación honesta por schema desconocido). */
export function emptySnapshot(cwd: string): SonarSnapshotFile {
  return { schema: SONAR_GATE_SCHEMA, cwd, entries: [], issues: [] };
}

/** Load tolerante: inexistente/corrupto/schema desconocido → undefined (el
 *  caller degrada a emptySnapshot). Nunca lanza. */
export function loadSnapshot(file: string): SonarSnapshotFile | undefined {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as SonarSnapshotFile;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schema !== SONAR_GATE_SCHEMA ||
      !Array.isArray(parsed.entries) ||
      !Array.isArray(parsed.issues)
    )
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Append puro con poda FIFO (AC literal del FRD: fixture con historyLimit+1
 *  entradas queda podado a historyLimit tras el append — la más vieja sale
 *  primero). Sin FS: testeable en puro. historyLimit ≤ 0 se clampea a 1
 *  (siempre se conserva la entrada recién agregada). */
export function appendEntry(
  snap: SonarSnapshotFile,
  entry: SonarEntry,
  issues: SonarIssue[],
  historyLimit: number,
): SonarSnapshotFile {
  const limit =
    Number.isFinite(historyLimit) && historyLimit > 0
      ? Math.floor(historyLimit)
      : 1;
  const entries = [...snap.entries, entry];
  while (entries.length > limit) entries.shift(); // FIFO: la más vieja primero
  return { schema: snap.schema, cwd: snap.cwd, entries, issues };
}

/** Escritura atómica 0600 no-throw (molde pilens-config.ts:33-53 — mkdirSync
 *  recursive + writeFileSync mode 0o600). Devuelve false si el FS falla. */
export function saveSnapshot(file: string, snap: SonarSnapshotFile): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snap, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}
