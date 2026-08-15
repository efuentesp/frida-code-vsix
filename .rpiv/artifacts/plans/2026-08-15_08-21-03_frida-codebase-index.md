---
date: 2026-08-15T08:21:03-0600
author: Edgar F. Fuentes Perea
commit: f0edeae
branch: main
repository: frida-code
topic: "frida-codebase-index: índice semántico + call graph vía wrapper de open-codebase-index (issue #25, ADR-0036)"
tags: [plan, codebase-index, semantic-search, call-graph, embeddings, issue-25]
status: ready
parent: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md
phase_count: 5
phases:
  - { n: 1, title: "Fundaciones — constantes, settings y espejo de configuración", files: [src/tools/frida-codebase-index/constants.ts, src/settings.ts, package.json, test/frida-codebase-index/constants.test.ts], depends_on: [] }
  - { n: 2, title: "Installer on-demand + poda de natives", files: [src/tools/frida-codebase-index/installer.ts, test/frida-codebase-index/installer.test.ts], depends_on: [1] }
  - { n: 3, title: "Shim ExtensionAPI + wrapper de 6 tools con degradación", files: [src/tools/frida-codebase-index/shim.ts, src/tools/frida-codebase-index/index.ts, test/frida-codebase-index/shim.test.ts], depends_on: [2] }
  - { n: 4, title: "Registro en sesión + host setup (auth sync + gitignore)", files: [src/tools/frida-codebase-index/host-setup.ts, src/pi-session.ts], depends_on: [3] }
  - { n: 5, title: 'Tab "Index" del webview + comando VS Code', files: [webview/components/IndexTab.tsx, webview/components/SettingsHub.tsx, webview/types.ts, webview/store.ts, webview/App.tsx, src/extension.ts, package.json], depends_on: [4] }
last_updated: 2026-08-15T08:21:03-0600
last_updated_by: Edgar F. Fuentes Perea
---

# frida-codebase-index Implementation Plan

## Overview

Implementa la búsqueda semántica de código, navegación por grafo de llamadas y lookup de implementaciones en Frida (issue #25, ADR-0036): **6 tools renombradas** (`semantic_context`, `semantic_search`, `call_graph`, `implementation_lookup`, `index_codebase`, `index_status`) respaldadas por el paquete upstream `open-codebase-index@0.23.0` (MIT) instalado **on-demand** en `~/.frida/npm`. Un **wrapper fino embebido** (`src/tools/frida-codebase-index/`) importa el paquete, captura sus tools vía un **shim ExtensionAPI** y re-registra solo el subconjunto elegido — sin vendorizar código, sin engordar el `.vsix` (51 MB se mantienen). La UX vive en un **tab "Index" del SettingsHub del webview** con degradación accionable cuando falta el paquete u Ollama.

Diseño fuente (decisiones ya settled): `.rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md`.

**Paralelismo**: ninguno — secuencial estricto Fase 1→2→3→4→5 (cada una construye sobre la anterior: constantes → installer → shim/wrapper → registro sesión → UI). Dentro de la Fase 5, el comando VS Code y el tab son independientes entre sí pero ambos dependen del estado publicado por la Fase 4.

## Desired End State

El usuario abre Frida → SettingsHub → tab **"Index"**: ve "Paquete no instalado" → clic **Instalar** (progreso visible) → poda automática → "Requiere embeddings: Ollama no detectado" con guía (`brew install ollama` / `ollama pull nomic-embed-text`) o uso de su OpenAI key ya guardada → clic **Indexar** → progreso → "Índice listo (N chunks)". En el chat:

- "¿dónde se valida la sesión antes de un request?" → el agente usa `semantic_context`/`semantic_search` y responde con `verifyToken` aunque no comparta palabras con la pregunta.
- "¿quién llama a `sendUserMessage`?" → `call_graph` devuelve callers con archivo:línea.
- "¿ruta de llamadas del webview al gateway?" → `call_graph({ from, to, mode: "path" })`.
- Sin índice, las tools explican cómo activarlo (nunca error opaco).

## What We're NOT Doing

- Las otras tools del upstream (`find_similar`, `pr_impact`, `code_communities`, `index_metrics`, `index_health_check`, `index_logs`, `codebase_peek` como tool separada, KB `knowledge_base_*`) — fase B si hay demanda.
- Slash commands del upstream (`/status`, `/index` estilo OpenCode) y los 5 prompts MCP.
- Reranking externo (Cohere/Jina) del upstream.
- Auto-index/watch activado por defecto (upstream ya trae `autoIndex:false` default; exponemos el toggle sin encenderlo).
- Índice symbol-only sin embeddings (el upstream no lo soporta; research Open Question #1 queda documentada, no parcheamos).
- Empaquetar el paquete en el `.vsix`, status bar, settings UI nativa más allá del espejo de props.

---

## Phase 1: Fundaciones — constantes, settings y espejo de configuración

### Overview

Crea el módulo `src/tools/frida-codebase-index/` con sus constantes (pin de versión upstream, entry path, mapping Frida↔upstream de las 6 tools, mapa plataforma→natives), los lectores de settings `readCodebaseIndexConfig()`/`isCodebaseIndexEnabled()` en `src/settings.ts` (patrón zai/devengine), el espejo de las 5 props `frida.codebaseIndex.*` en `package.json contributes.configuration`, y sus tests.

### Changes Required

#### 1. Constantes del módulo (pin, paths, mapping tools, plataformas)

**File**: `src/tools/frida-codebase-index/constants.ts`
**Changes**: NEW — pin de versión upstream, entry path del paquete (`dist/pi-extension.js`), mapping Frida↔upstream de las 6 tools, plataforma actual → natives a conservar/podar.

```typescript
/**
 * frida-codebase-index — constantes (issue #25, ADR-0036).
 *
 * Wrapper fino del paquete upstream open-codebase-index (MIT): Frida lo instala
 * on-demand en ~/.frida/npm, importa su extensión Pi vía import() nativo
 * (patrón frida-lens, src/pi-session.ts:326-343) y re-registra SOLO el subconjunto
 * de tools elegido con nombres Frida (ADR-0036 D1). Única fuente de verdad del
 * pin, paths y mapping.
 */
import * as path from "node:path";

/** Paquete upstream y pin EXACTO (releases diarios: subir versión es deliberado). */
export const CODEBASE_INDEX_PACKAGE = "open-codebase-index";
export const CODEBASE_INDEX_PIN = "0.23.0";
export const CODEBASE_INDEX_SPEC = `${CODEBASE_INDEX_PACKAGE}@${CODEBASE_INDEX_PIN}`;

/**
 * Entry de la extensión Pi del paquete. Fuente: manifest del tarball npm 0.23.0
 * (`package/package.json` → `"pi": { "extensions": ["./dist/pi-extension.js"] }`,
 * verificado contra el tarball — NO es el `main` dist/index.js de OpenCode/CLI;
 * research §I). Verificar contra el manifest en cada bump de pin.
 */
export const CODEBASE_INDEX_PI_ENTRY = path.join("dist", "pi-extension.js");

/** Path absoluto del entry dentro del agentDir de Frida (~/.frida/npm/node_modules/...). */
export function upstreamEntryPath(agentDir: string): string {
  return path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    CODEBASE_INDEX_PI_ENTRY,
  );
}

/** Directorio de natives del paquete (package/native/*.node). */
export function upstreamNativeDir(agentDir: string): string {
  return path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    "native",
  );
}

/** Natives bundled del paquete (research §C) y su mapa plataforma→archivo.
 *  OJO: win32-x64 es "-msvc" y linux es "-gnu" — los sufijos NO son derivables
 *  uniformemente, por eso el mapa explícito (la versión con endsWith rompía
 *  win32-x64 — corregido tras slice-verifier). */
const PLATFORM_NATIVE: Readonly<Record<string, string>> = {
  "darwin-arm64": "codebase-index-native.darwin-arm64.node",
  "darwin-x64": "codebase-index-native.darwin-x64.node",
  "linux-arm64": "codebase-index-native.linux-arm64-gnu.node",
  "linux-x64": "codebase-index-native.linux-x64-gnu.node",
  "win32-x64": "codebase-index-native.win32-x64-msvc.node",
};

/** Todos los natives bundled (para la poda del installer, Slice 2). */
export const BUNDLED_NATIVES = Object.freeze([
  ...new Set(Object.values(PLATFORM_NATIVE)),
]);

/** Native de la plataforma indicada (default: la actual). undefined si no hay
 *  prebuild (p.ej. linux-musl) → el caller degrada con guía accionable. */
export function currentPlatformNative(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  return PLATFORM_NATIVE[`${platform}-${arch}`];
}

/**
 * Mapping de tools Frida → upstream (ADR-0036 D1 + decisión "6 tools MVP+").
 * call_graph absorbe call_graph_path vía parámetro mode:"path".
 */
export const FRIDA_TO_UPSTREAM_TOOLS: Readonly<Record<string, string>> = {
  semantic_context: "codebase_context",
  semantic_search: "codebase_search",
  call_graph: "call_graph",
  implementation_lookup: "implementation_lookup",
  index_codebase: "index_codebase",
  index_status: "index_status",
};

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const CODEBASE_INDEX_FACTORY_NAME = "frida-codebase-index";

/** Storage del upstream dentro del repo (research §D) — se gitignora automático. */
export const CODEBASE_INDEX_STORAGE_DIR = ".codebase-index";
```

#### 2. Lectores de settings

**File**: `src/settings.ts`
**Changes**: MODIFY — lectores `readCodebaseIndexConfig()` y `isCodebaseIndexEnabled()` siguiendo el patrón zai/devengine (se añaden al final del archivo).

```typescript
// === Codebase index (frida-codebase-index, ADR-0036 / issue #25) ===

/** Config de frida.codebaseIndex.*. */
export interface CodebaseIndexConfig {
 enabled: boolean;
 /** Conservar los natives de otras plataformas tras instalar (debug/multi-target). */
 keepOtherPlatforms: boolean;
 /** Provider de embeddings: auto (Ollama→OpenAI→Google) | ollama | custom. */
 provider: "auto" | "ollama" | "custom";
 /** Endpoint custom OpenAI-compatible (vacío = no configurado). */
 customBaseUrl: string;
 /** Modelo del endpoint custom (vacío = default del upstream). */
 customModel: string;
}

/** ¿Está activo frida-codebase-index? Default: true (degrada con guía si falta el paquete). */
export function isCodebaseIndexEnabled(): boolean {
 return vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<boolean>("codebaseIndex.enabled", true);
}

/** Snapshot de la config del índice de código. */
export function readCodebaseIndexConfig(): CodebaseIndexConfig {
 const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
 const provider = cfg.get<string>(
  "codebaseIndex.embeddings.provider",
  "auto",
 );
 return {
  enabled: isCodebaseIndexEnabled(),
  keepOtherPlatforms: cfg.get<boolean>(
   "codebaseIndex.keepOtherPlatforms",
   false,
  ),
  provider:
   provider === "ollama" || provider === "custom" ? provider : "auto",
  customBaseUrl: String(
   cfg.get<string>("codebaseIndex.embeddings.custom.baseUrl", ""),
  ).trim(),
  customModel: String(
   cfg.get<string>("codebaseIndex.embeddings.custom.model", ""),
  ).trim(),
 };
}
```

#### 3. Espejo de configuración (contributes.configuration)

**File**: `package.json`
**Changes**: MODIFY — `contributes.configuration` con las props `frida.codebaseIndex.*` (inserción entre `frida.zai.maxTokens` y `frida.notifyOnComplete`).

```jsonc
"frida.codebaseIndex.enabled": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "Habilita **frida-codebase-index**: búsqueda semántica de código, grafo de llamadas y lookup de implementaciones (wrapper de `open-codebase-index`, instalado on-demand en `~/.frida/npm`). Si el paquete no está instalado, las tools responden con la guía de instalación."
},
"frida.codebaseIndex.keepOtherPlatforms": {
  "type": "boolean",
  "default": false,
  "markdownDescription": "Conserva los binarios nativos (`.node`) de otras plataformas tras la instalación on-demand. Por defecto se podan (solo queda el de tu plataforma) para ahorrar disco."
},
"frida.codebaseIndex.embeddings.provider": {
  "type": "string",
  "enum": ["auto", "ollama", "custom"],
  "default": "auto",
  "markdownDescription": "Proveedor de embeddings del índice. `auto` intenta Ollama → OpenAI (si guardaste la key de OpenAI en Frida) → Google. `ollama` fuerza local (cero datos salen del equipo). `custom` usa el endpoint OpenAI-compatible configurado abajo."
},
"frida.codebaseIndex.embeddings.custom.baseUrl": {
  "type": "string",
  "default": "",
  "markdownDescription": "Endpoint OpenAI-compatible para embeddings (`POST {baseUrl}/embeddings`). Vacío = no configurado."
},
"frida.codebaseIndex.embeddings.custom.model": {
  "type": "string",
  "default": "",
  "markdownDescription": "Modelo de embeddings del endpoint custom. Vacío = el default del upstream."
},
```

#### 4. Tests de constantes

**File**: `test/frida-codebase-index/constants.test.ts`
**Changes**: NEW — tests del pin exacto, entry, natives, plataformas y mapping. El reader de settings NO se testea: importa `vscode` (sin harness; 0 mocks de vscode en `test/`).

```typescript
// Tests de las constantes de frida-codebase-index (pin, entry, mapping, plataforma).
// settings.ts NO se testea aquí: importa `vscode` (sin harness; 0 mocks de vscode
// en test/); el espejo de package.json lo verifica la MV del slice.
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  CODEBASE_INDEX_PACKAGE,
  CODEBASE_INDEX_PIN,
  CODEBASE_INDEX_SPEC,
  CODEBASE_INDEX_PI_ENTRY,
  upstreamEntryPath,
  upstreamNativeDir,
  BUNDLED_NATIVES,
  currentPlatformNative,
  FRIDA_TO_UPSTREAM_TOOLS,
} from "../../src/tools/frida-codebase-index/constants";

describe("frida-codebase-index constants", () => {
  it("el pin es exacto (sin rango): un solo seam con el upstream", () => {
    expect(CODEBASE_INDEX_PIN).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CODEBASE_INDEX_SPEC).toBe(
      `${CODEBASE_INDEX_PACKAGE}@${CODEBASE_INDEX_PIN}`,
    );
  });

  it("el entry apunta a la extensión Pi del paquete (manifest pi.extensions)", () => {
    expect(CODEBASE_INDEX_PI_ENTRY).toBe(path.join("dist", "pi-extension.js"));
    const p = upstreamEntryPath("/home/u/.frida");
    expect(p).toBe(
      path.join(
        "/home/u/.frida",
        "npm",
        "node_modules",
        CODEBASE_INDEX_PACKAGE,
        "dist",
        "pi-extension.js",
      ),
    );
    expect(upstreamNativeDir("/home/u/.frida")).toBe(
      path.join(
        "/home/u/.frida",
        "npm",
        "node_modules",
        CODEBASE_INDEX_PACKAGE,
        "native",
      ),
    );
  });

  it("los 5 natives bundled cubren las plataformas del upstream (research §C)", () => {
    expect(BUNDLED_NATIVES).toHaveLength(5);
    for (const n of BUNDLED_NATIVES)
      expect(n).toMatch(
        /^codebase-index-native\.(darwin-arm64|darwin-x64|linux-arm64-gnu|linux-x64-gnu|win32-x64-msvc)\.node$/,
      );
  });

  it("cada plataforma soportada resuelve su native (incluye win32-x64-msvc — bug corregido)", () => {
    expect(currentPlatformNative("darwin", "arm64")).toBe(
      "codebase-index-native.darwin-arm64.node",
    );
    expect(currentPlatformNative("darwin", "x64")).toBe(
      "codebase-index-native.darwin-x64.node",
    );
    expect(currentPlatformNative("linux", "arm64")).toBe(
      "codebase-index-native.linux-arm64-gnu.node",
    );
    expect(currentPlatformNative("linux", "x64")).toBe(
      "codebase-index-native.linux-x64-gnu.node",
    );
    expect(currentPlatformNative("win32", "x64")).toBe(
      "codebase-index-native.win32-x64-msvc.node",
    );
    // Plataformas SIN prebuild → undefined → guía accionable.
    expect(currentPlatformNative("freebsd", "x64")).toBeUndefined();
  });

  it("la plataforma actual del runner resuelve native (delata CI sin prebuild)", () => {
    expect(currentPlatformNative()).toBeDefined();
  });

  it("el mapping Frida→upstream cubre las 6 tools MVP+ (ADR-0036 D1)", () => {
    expect(Object.keys(FRIDA_TO_UPSTREAM_TOOLS).sort()).toEqual([
      "call_graph",
      "implementation_lookup",
      "index_codebase",
      "index_status",
      "semantic_context",
      "semantic_search",
    ]);
    expect(FRIDA_TO_UPSTREAM_TOOLS.semantic_context).toBe("codebase_context");
    expect(FRIDA_TO_UPSTREAM_TOOLS.semantic_search).toBe("codebase_search");
  });
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck de la extensión pasa: `npx tsc -p tsconfig.json --noEmit`
- [ ] Tests del slice pasan: `npx vitest run test/frida-codebase-index/constants.test.ts`
- [ ] El espejo package.json contiene las 5 props nuevas: `grep -c "frida.codebaseIndex" package.json` devuelve >= 5

#### Manual Verification

- [ ] La Settings UI nativa de VS Code muestra las props `frida.codebaseIndex.*` con defaults correctos (enabled=true, provider=auto) sin warnings de esquema

---

## Phase 2: Installer on-demand + poda de natives

### Overview

`ensureInstalled()`: spawn `npm install open-codebase-index@<pin> --prefix ~/.frida/npm --legacy-peer-deps --no-audit --no-fund`, verificación del entry, poda de natives ajenos a la plataforma, marker de versión instalada (package.json del paquete), idempotencia. Errores siempre con guía accionable (`CodebaseIndexInstallError`).

**Depende de**: Fase 1 (constantes).

### Changes Required

#### 1. Installer on-demand

**File**: `src/tools/frida-codebase-index/installer.ts`
**Changes**: NEW — `ensureInstalled()`, `installedVersion()`, `isInstalledAtPin()`, `pruneOtherPlatformNatives()`, `defaultRun` (win32 usa shell para npm.cmd), `withTimeout`, `manualCmd()` (guías con prefix absoluto — cmd.exe/PowerShell no expanden `~`). Limitaciones documentadas: withTimeout no mata el proceso npm huérfano al expirar; npm sin package.json en el prefix sólo warning (exit 0).

```typescript
/**
 * frida-codebase-index — installer on-demand (issue #25, ADR-0036, D2).
 *
 * PI_OFFLINE (src/pi-session.ts:194) desactiva el auto-install del SDK → el host
 * instala. Spawn de npm con el MISMO mecanismo que el PackageManager del SDK
 * (npm install <spec> --prefix <agentDir>/npm --legacy-peer-deps —
 * package-manager.js:1475-1481) y poda post-install de los natives de otras
 * plataformas (~4/5 del disco en uso; research §C). Errores siempre con guía
 * accionable (D6, lección del revert 7500370).
 *
 * Limitaciones conocidas: withTimeout no mata el proceso npm huérfano al
 * expirar (defaultRun no expone el child); npm sin package.json en el prefix
 * sólo warning (exit 0) — no replicamos ensureNpmProject del SDK.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BUNDLED_NATIVES,
  CODEBASE_INDEX_PACKAGE,
  CODEBASE_INDEX_PIN,
  CODEBASE_INDEX_SPEC,
  currentPlatformNative,
  upstreamEntryPath,
  upstreamNativeDir,
} from "./constants";

/** Error de instalación con guía accionable (D6: nunca errores opacos). */
export class CodebaseIndexInstallError extends Error {
  /** Pasos concretos para resolver (se muestra al usuario en el tab/guía). */
  readonly guide: string;
  constructor(message: string, guide: string) {
    super(message);
    this.name = "CodebaseIndexInstallError";
    this.guide = guide;
  }
}

/** Ejecutable/resultado inyectable para tests. */
export interface InstallDeps {
  npmBin?: string;
  /** Spawn inyectable: resuelve código de salida o rechaza (ENOENT npm ausente). */
  run?: (
    bin: string,
    args: string[],
  ) => Promise<{ code: number | null; stderr: string }>;
  /** Timeout del spawn (ms). Default 10 min (tarball ~256 MB). */
  timeoutMs?: number;
}

/** Versión instalada del paquete en ~/.frida/npm (lee su package.json). */
export function installedVersion(agentDir: string): string | undefined {
  const pkgJson = path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    "package.json",
  );
  try {
    const raw = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
      version?: string;
    };
    return typeof raw.version === "string" ? raw.version : undefined;
  } catch {
    return undefined;
  }
}

/** ¿El paquete está instalado con el pin actual y entry válido? */
export function isInstalledAtPin(agentDir: string): boolean {
  return (
    installedVersion(agentDir) === CODEBASE_INDEX_PIN &&
    fs.existsSync(upstreamEntryPath(agentDir))
  );
}

/** Ejecuta un comando (impl real por defecto; win32 usa shell para npm.cmd). */
async function defaultRun(bin: string, args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(bin, args, {
        shell: process.platform === "win32",
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", reject); // ENOENT: npm ausente
      child.on("close", (code) => resolve({ code, stderr }));
    },
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`timeout tras ${ms}ms`), {
            code: "ETIMEOUT",
          }),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Poda best-effort de los natives de otras plataformas (research §C). Nunca
 * lanza: dejar natives extra sólo cuesta disco, no funcionalidad. Devuelve los
 * eliminados. Platform/arch inyectables (tests).
 */
export function pruneOtherPlatformNatives(
  agentDir: string,
  opts: {
    keepOtherPlatforms?: boolean;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
): string[] {
  if (opts.keepOtherPlatforms) return [];
  const keep = currentPlatformNative(opts.platform, opts.arch);
  if (!keep) return []; // sin prebuild para esta plataforma: no podamos nada
  const dir = upstreamNativeDir(agentDir);
  const removed: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (
        entry !== keep &&
        (BUNDLED_NATIVES as readonly string[]).includes(entry)
      ) {
        fs.rmSync(path.join(dir, entry));
        removed.push(entry);
      }
    }
  } catch {
    /* best-effort: dir ausente o ilegible */
  }
  return removed;
}

export interface EnsureInstalledResult {
  alreadyInstalled: boolean;
  pruned: string[];
}

/** Comando manual equivalente, con prefix ABSOLUTO entre comillas (cmd.exe y
 *  PowerShell no expanden ~ en argumentos de comandos nativos — win32). */
function manualCmd(agentDir: string): string {
  return `npm install ${CODEBASE_INDEX_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`;
}

/**
 * Garantiza que open-codebase-index@PIN esté instalado en <agentDir>/npm.
 * Idempotente: si ya está al pin con entry válido, no toca nada. Tras instalar
 * poda natives ajenos salvo keepOtherPlatforms. Falla con
 * CodebaseIndexInstallError (guía accionable) si npm falta/timeout/install falla.
 */
export async function ensureInstalled(
  agentDir: string,
  opts: {
    keepOtherPlatforms?: boolean;
    deps?: InstallDeps;
    onProgress?: (line: string) => void;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
): Promise<EnsureInstalledResult> {
  if (isInstalledAtPin(agentDir)) return { alreadyInstalled: true, pruned: [] };
  const { npmBin = "npm", run = defaultRun, timeoutMs = 10 * 60_000 } =
    opts.deps ?? {};
  opts.onProgress?.(
    `Instalando ${CODEBASE_INDEX_SPEC} en ${path.join(agentDir, "npm")} (descarga ~256 MB)…`,
  );
  fs.mkdirSync(path.join(agentDir, "npm"), { recursive: true });
  let res: { code: number | null; stderr: string };
  try {
    res = await withTimeout(
      run(npmBin, [
        "install",
        CODEBASE_INDEX_SPEC,
        "--prefix",
        path.join(agentDir, "npm"),
        "--legacy-peer-deps",
        "--no-audit",
        "--no-fund",
      ]),
      timeoutMs,
    );
  } catch (e: any) {
    if (e?.code === "ETIMEOUT") {
      throw new CodebaseIndexInstallError(
        `La instalación excedió ${Math.round(timeoutMs / 60_000)} min.`,
        "Reintenta con mejor red, o corre manualmente: " + manualCmd(agentDir),
      );
    }
    throw new CodebaseIndexInstallError(
      `npm no está disponible (${e?.message ?? e}).`,
      "Instala Node.js 20+ (incluye npm) o corre manualmente: " + manualCmd(agentDir),
    );
  }
  if (res.code !== 0 || !fs.existsSync(upstreamEntryPath(agentDir))) {
    throw new CodebaseIndexInstallError(
      `npm install falló (exit ${res.code}). ${res.stderr.slice(0, 500)}`,
      "Revisa la salida (red/proxy corporativo es la causa típica). Comando manual: " +
        manualCmd(agentDir),
    );
  }
  const pruned = pruneOtherPlatformNatives(agentDir, opts);
  opts.onProgress?.(
    pruned.length
      ? `Poda: ${pruned.length} natives de otras plataformas eliminados.`
      : "Sin poda (keepOtherPlatforms o plataforma sin prebuild).",
  );
  return { alreadyInstalled: false, pruned };
}
```

#### 2. Tests del installer

**File**: `test/frida-codebase-index/installer.test.ts`
**Changes**: NEW — tests con `run()` inyectado que simula npm escribiendo DONDE npm escribiría (`<prefix>/node_modules/...`): idempotencia, éxito con poda, keepOtherPlatforms, npm ausente, install fallido, prune sin prebuild. fs real contra agentDir temporal (mkdtemp).

```typescript
// Tests del installer on-demand: idempotencia, éxito con poda, npm ausente,
// install fallido, keepOtherPlatforms. run() inyectado simula npm (crea los
// archivos como lo haría npm: bajo <prefix>/node_modules/...); fs real contra
// agentDir temporal.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CodebaseIndexInstallError,
  ensureInstalled,
  installedVersion,
  isInstalledAtPin,
  pruneOtherPlatformNatives,
} from "../../src/tools/frida-codebase-index/installer";
import {
  BUNDLED_NATIVES,
  CODEBASE_INDEX_PIN,
  CODEBASE_INDEX_SPEC,
  upstreamNativeDir,
} from "../../src/tools/frida-codebase-index/constants";

let agentDir: string;

/** Simula un npm exitoso: crea package.json + entry + los 5 natives DONDE npm
 *  los pondría: bajo `<prefix>/node_modules/open-codebase-index/` (semántica
 *  npm del --prefix recibido — NO la semántica agentDir de upstreamEntryPath,
 *  que ya antepondría npm/ una segunda vez). */
function fakeNpmOk(bin: string, args: string[]) {
  expect(args[0]).toBe("install");
  expect(args[1]).toBe(CODEBASE_INDEX_SPEC);
  const prefix = args[args.indexOf("--prefix") + 1];
  const pkgRoot = path.join(prefix, "node_modules", "open-codebase-index");
  fs.mkdirSync(path.join(pkgRoot, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgRoot, "dist", "pi-extension.js"),
    "// fake entry",
  );
  fs.writeFileSync(
    path.join(pkgRoot, "package.json"),
    JSON.stringify({
      name: "open-codebase-index",
      version: CODEBASE_INDEX_PIN,
    }),
  );
  fs.mkdirSync(path.join(pkgRoot, "native"), { recursive: true });
  for (const n of BUNDLED_NATIVES)
    fs.writeFileSync(path.join(pkgRoot, "native", n), "");
  return Promise.resolve({ code: 0, stderr: "" });
}

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-oci-"));
});
afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("frida-codebase-index installer", () => {
  it("idempotente: ya instalado al pin + entry → no llama npm", async () => {
    fakeNpmOk("npm", [
      "install",
      CODEBASE_INDEX_SPEC,
      "--prefix",
      path.join(agentDir, "npm"),
    ]);
    expect(isInstalledAtPin(agentDir)).toBe(true);
    let called = 0;
    const res = await ensureInstalled(agentDir, {
      deps: {
        run: () => {
          called++;
          return fakeNpmOk("npm", []);
        },
      },
    });
    expect(called).toBe(0);
    expect(res.alreadyInstalled).toBe(true);
    expect(installedVersion(agentDir)).toBe(CODEBASE_INDEX_PIN);
  });

  it("instala y poda los 4 natives ajenos (darwin-arm64)", async () => {
    const res = await ensureInstalled(agentDir, {
      deps: { run: fakeNpmOk },
      platform: "darwin",
      arch: "arm64",
    });
    expect(res.alreadyInstalled).toBe(false);
    expect(res.pruned).toHaveLength(4);
    const left = fs.readdirSync(upstreamNativeDir(agentDir));
    expect(left).toEqual(["codebase-index-native.darwin-arm64.node"]);
  });

  it("keepOtherPlatforms conserva los 5 natives", async () => {
    const res = await ensureInstalled(agentDir, {
      deps: { run: fakeNpmOk },
      keepOtherPlatforms: true,
    });
    expect(res.pruned).toHaveLength(0);
    expect(fs.readdirSync(upstreamNativeDir(agentDir))).toHaveLength(5);
  });

  it("npm ausente (ENOENT) → CodebaseIndexInstallError con guía manual", async () => {
    const enoent = Object.assign(new Error("spawn npm ENOENT"), {
      code: "ENOENT",
    });
    await expect(
      ensureInstalled(agentDir, {
        deps: { run: () => Promise.reject(enoent) },
      }),
    ).rejects.toMatchObject({
      name: "CodebaseIndexInstallError",
      guide: expect.stringContaining("npm install"),
    });
  });

  it("install fallido (exit 1) → error con guía", async () => {
    await expect(
      ensureInstalled(agentDir, {
        deps: {
          run: () => Promise.resolve({ code: 1, stderr: "E404 not found" }),
        },
      }),
    ).rejects.toBeInstanceOf(CodebaseIndexInstallError);
  });

  it("prune standalone sin prebuild (freebsd) no elimina nada", () => {
    fs.mkdirSync(upstreamNativeDir(agentDir), { recursive: true });
    for (const n of BUNDLED_NATIVES)
      fs.writeFileSync(path.join(upstreamNativeDir(agentDir), n), "");
    const removed = pruneOtherPlatformNatives(agentDir, {
      platform: "freebsd",
      arch: "x64",
    });
    expect(removed).toHaveLength(0);
    expect(fs.readdirSync(upstreamNativeDir(agentDir))).toHaveLength(5);
  });
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck de la extensión pasa: `npx tsc -p tsconfig.json --noEmit`
- [ ] Tests del installer pasan: `npx vitest run test/frida-codebase-index/installer.test.ts`
- [ ] Tests del Slice 1 siguen verdes (sin regresión): `npx vitest run test/frida-codebase-index/constants.test.ts`

#### Manual Verification

- [ ] (Spot-check opcional) Con npm real: `ensureInstalled` contra un agentDir temporal descarga y deja solo 1 native — la validación end-to-end completa es el PoC del Slice 5 en el extension host

---

## Phase 3: Shim ExtensionAPI + wrapper de 6 tools con degradación

### Overview

`createCaptureShim`: implementación mínima de `ExtensionAPI` que captura `registerTool` en un mapa (y absorbe `registerCommand`/`on`/`setSessionName` como no-ops loggeados). `loadUpstreamTools()` importa el paquete vía `import()` nativo con `pathToFileURL` y ejecuta su factory contra el shim. `createFridaCodebaseIndex(deps)`: factory embebida **async** que resuelve install state, carga tools del upstream vía shim, re-registra las 6 renombradas con firma execute del SDK y degradación accionable en 3 ramas; publica estado vía `onStateChange`.

**Depende de**: Fases 1-2 (constantes + installer).

### Changes Required

#### 1. Shim ExtensionAPI

**File**: `src/tools/frida-codebase-index/shim.ts`
**Changes**: NEW — `CaptureShim` (Proxy get-trap para keys no implementadas, log de diagnóstico), `CapturedTool`, `CodebaseIndexLoadError` con guía, `loadUpstreamTools()`.

```typescript
/**
 * frida-codebase-index — shim ExtensionAPI para capturar las tools del upstream
 * (issue #25, ADR-0036, D1 "wrapper fino").
 *
 * La extensión Pi del upstream (dist/pi-extension.js) es una factory estándar
 * `(pi: ExtensionAPI) => ...` que registra sus 16 tools vía pi.registerTool. En
 * vez de dejar que el resourceLoader las registre TODAS con nombres upstream,
 * Frida corre la factory contra ESTE shim: captura las tools en un Map y absorbe
 * el resto del contrato (registerCommand/on/setSessionName) como no-ops
 * loggeados. El wrapper (index.ts) re-registra solo el subconjunto elegido con
 * nombres Frida.
 *
 * NOTA jiti: NO cargamos el paquete vía jiti (bug de import.meta.url en ESM,
 * src/pi-session.ts:323-324) — usamos import() nativo al entry absoluto vía
 * pathToFileURL (patrón frida-lens + sdk-passthrough.test.ts). Los accesos a
 * keys del API no implementadas se loggean (Proxy get-trap) para diagnosticar
 * en el PoC qué contrato extra usa el upstream, y devuelven undefined.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { CODEBASE_INDEX_SPEC } from "./constants";

/** Tool capturado del upstream (passthrough del objeto registrado).
 *  execute usa la convención del SDK: (toolCallId, params, signal, onUpdate, ctx). */
export interface CapturedTool {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: any,
    signal: any,
    onUpdate: any,
    ctx: any,
  ) => Promise<any> | any;
  [key: string]: unknown;
}

/** Error de carga del paquete upstream con guía accionable (D6). */
export class CodebaseIndexLoadError extends Error {
  readonly guide: string;
  constructor(message: string, guide: string) {
    super(message);
    this.name = "CodebaseIndexLoadError";
    this.guide = guide;
  }
}

export interface CaptureShim {
  /** El objeto `pi` que se pasa a la factory del upstream. */
  api: Record<string, unknown>;
  /** Tools capturadas por nombre upstream. */
  tools: Map<string, CapturedTool>;
  /** Eventos/commands absorbidos (diagnóstico del PoC). */
  absorbed: { commands: string[]; events: string[]; unknownKeys: string[] };
}

/** Crea el shim. `onLog` para diagnóstico (PoC/Debug). */
export function createCaptureShim(
  onLog?: (line: string) => void,
): CaptureShim {
  const tools = new Map<string, CapturedTool>();
  const absorbed = {
    commands: [] as string[],
    events: [] as string[],
    unknownKeys: [] as string[],
  };
  const log = (line: string) => onLog?.(line);

  const base: Record<string, unknown> = {
    registerTool(tool: CapturedTool) {
      if (tool && typeof tool.name === "string") {
        tools.set(tool.name, tool);
      }
      return tool;
    },
    registerCommand(name: string) {
      absorbed.commands.push(String(name));
      log(`[codebase-index shim] command absorbido: ${name}`);
    },
    on(event: string) {
      absorbed.events.push(String(event));
      log(`[codebase-index shim] event absorbido: ${event}`);
      return () => {}; // unsubscribe no-op
    },
    setSessionName(name: string) {
      log(`[codebase-index shim] setSessionName absorbido: ${name}`);
    },
    getAllTools() {
      return [...tools.values()];
    },
  };

  // Proxy: keys no implementadas del ExtensionAPI → undefined + log (el PoC
  // delata qué contrato extra usa el upstream sin crashear la carga).
  const api = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        if (!absorbed.unknownKeys.includes(prop)) {
          absorbed.unknownKeys.push(prop);
          log(`[codebase-index shim] key no implementada accedida: ${prop}`);
        }
        return undefined;
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return { api, tools, absorbed };
}

/**
 * Importa la extensión Pi del paquete instalado (import() nativo con
 * pathToFileURL) y corre su factory contra el shim. Devuelve las tools
 * capturadas. Errores → CodebaseIndexLoadError con guía (ABI del native,
 * plataforma sin prebuild, paquete corrupto).
 */
export async function loadUpstreamTools(
  entryPath: string,
  onLog?: (line: string) => void,
): Promise<Map<string, CapturedTool>> {
  let mod: any;
  try {
    mod = await import(pathToFileURL(entryPath).href);
  } catch (e: any) {
    throw new CodebaseIndexLoadError(
      `No se pudo cargar ${path.basename(entryPath)}: ${e?.message ?? e}`,
      "El módulo nativo (.node) puede ser incompatible con tu plataforma/ABI, o la instalación quedó corrupta. Reinstala: elimina ~/.frida/npm/node_modules/open-codebase-index y usa el botón Instalar del tab Index, o ejecuta: npm install " +
        CODEBASE_INDEX_SPEC +
        " --prefix ~/.frida/npm --legacy-peer-deps",
    );
  }
  const factory = mod?.default ?? mod;
  if (typeof factory !== "function") {
    throw new CodebaseIndexLoadError(
      `El entry no exporta una factory (default): ${typeof factory}`,
      "El paquete instalado no tiene la forma esperada (¿versión distinta del pin?). Reinstala al pin con el botón Instalar del tab Index.",
    );
  }
  const shim = createCaptureShim(onLog);
  try {
    await factory(shim.api);
  } catch (e: any) {
    throw new CodebaseIndexLoadError(
      `La factory del upstream falló al registrar tools: ${e?.message ?? e}`,
      "Revisa el log de diagnóstico (keys no implementadas puede indicar contrato nuevo del upstream). Reinstala al pin desde el tab Index.",
    );
  }
  return shim.tools;
}
```

#### 2. Factory del wrapper (6 tools Frida)

**File**: `src/tools/frida-codebase-index/index.ts`
**Changes**: NEW — `createFridaCodebaseIndex()` factory async (devuelve la promesa de carga — el loader hace `await factory(api)`), `passthroughTool` (reenvío de los 5 args), `callGraphTool` (fusiona `call_graph_path` vía `mode:"path"`), `guideTool`/`guideResult` (degradación D6), `withEmbeddingsGuide` (traduce errores del upstream), `missingPackageGuide()` (prefix absoluto, win32), `FRIDA_DESCRIPTIONS`, `CodebaseIndexState`. Todos los tool builders setean `label` (requerido por `ToolDefinition` del SDK).

```typescript
/**
 * frida-codebase-index — factory del wrapper (issue #25, ADR-0036).
 *
 * Registra las 6 tools Frida (D3) respaldadas por el upstream SI está instalado
 * al pin; si no, las registra en MODO GUÍA (D6, patrón missing-binary de
 * frida-agent-browser run.ts:152-170): responden con los pasos para instalar.
 * Envuelve errores del upstream con guías: embeddings (research §G), índice
 * ausente, y genérica honesta.
 *
 * CONTRATO execute (SDK): execute(toolCallId, params, signal, onUpdate, ctx) —
 * ver types.d.ts:357 y frida-supi-web/index.ts:154-160. El passthrough reenvía
 * los 5 args tal cual al tool upstream (misma convención al ser extensión pi).
 * La factory DEVUELVE la promesa de carga para que el await factory(api) del
 * loader (loader.js:390) espere el import() completo — sin race de registro.
 */
import * as path from "node:path";

import {
  CODEBASE_INDEX_FACTORY_NAME,
  CODEBASE_INDEX_SPEC,
  FRIDA_TO_UPSTREAM_TOOLS,
  upstreamEntryPath,
} from "./constants";
import { isInstalledAtPin } from "./installer";
import { type CapturedTool, loadUpstreamTools } from "./shim";

export interface CreateCodebaseIndexOpts {
  agentDir: string;
  /** Log de diagnóstico del shim (PoC/Debug). */
  onLog?: (line: string) => void;
}

/** Guía de paquete ausente, con prefix ABSOLUTO entre comillas (cmd.exe y
 *  PowerShell no expanden ~ en argumentos de comandos nativos — win32). */
function missingPackageGuide(agentDir: string): string {
  return [
    "frida-codebase-index: el paquete upstream no está instalado.",
    "",
    "Para activarlo (descarga única de ~256 MB; luego se poda a ~1/5 del disco):",
    "  1. Abre el tab Index del panel de configuración de Frida y pulsa Instalar, o",
    "  2. ejecuta en tu terminal:",
    `     npm install ${CODEBASE_INDEX_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`,
    "Después ejecuta /reload de Frida o reinicia la sesión.",
  ].join("\n");
}

const EMBEDDINGS_GUIDE = [
  "El índice requiere un proveedor de embeddings (nada sale de tu equipo con Ollama):",
  "  - Ollama local: instala Ollama (https://ollama.com) y ejecuta `ollama pull nomic-embed-text`.",
  "  - OpenAI: si ya guardaste una API key de OpenAI en Frida, se usa automáticamente.",
  "  - Custom: configura frida.codebaseIndex.embeddings.custom.baseUrl en los settings de VS Code.",
].join("\n");

const INDEX_GUIDE = [
  "El índice de código aún no existe o está incompleto para esta consulta.",
  "Ejecuta primero la tool index_codebase (indexación incremental) y reintenta.",
  "Si index_codebase falla por embeddings, verá la guía del proveedor.",
].join("\n");

/** Shape del resultado de guía (AgentToolResult: content + details + isError). */
type GuideToolResult = {
  content: { type: "text"; text: string }[];
  details: unknown;
  isError: boolean;
};

/** Resultado de guía con details obligatorio (AgentToolResult, CONTEXT.md:982). */
function guideResult(
  text: string,
  failureCategory = "codebase-index-guide",
): GuideToolResult {
  return {
    content: [{ type: "text", text }],
    details: { failureCategory },
    isError: true,
  };
}

/** Traduce errores del upstream a respuestas con guía (D6). */
function withEmbeddingsGuide(e: unknown): GuideToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no embedding-capable provider/i.test(msg)) {
    return guideResult(
      `frida-codebase-index: ${msg}\n\n${EMBEDDINGS_GUIDE}`,
      "codebase-index-embeddings",
    );
  }
  if (
    /(no index|not indexed|index not found|index is empty|index_codebase)/i.test(
      msg,
    )
  ) {
    return guideResult(
      `frida-codebase-index: ${msg}\n\n${INDEX_GUIDE}`,
      "codebase-index-missing-index",
    );
  }
  return guideResult(
    `frida-codebase-index: ${msg}\n\nSi persiste, revisa el estado en el tab Index del panel de configuración de Frida.`,
    "codebase-index-error",
  );
}

/** Descripción Frida para cada tool (ajustada al renombrado, ADR-0036 D1). */
const FRIDA_DESCRIPTIONS: Record<string, string> = {
  semantic_context:
    "Búsqueda de código por significado con paquete de evidencia acotado y bajo en tokens (deduplicado, diverso por archivo). Punto de entrada recomendado para preguntas del repositorio.",
  semantic_search:
    "Búsqueda semántica/híbrida (significado + palabras clave) que devuelve código fuente completo con filtros de archivo/directorio.",
  call_graph:
    "Grafo de llamadas: callers/callees directos de un símbolo, o la ruta de llamadas más corta entre dos símbolos con mode:'path'.",
  implementation_lookup:
    "Localiza la definición autoritativa de un símbolo, prefiriendo implementación sobre tests/docs/fixtures.",
  index_codebase:
    "Crea/actualiza el índice de código (incremental por defecto; force:true para rebuild total).",
  index_status:
    "Reporta el estado del índice: readiness, chunks, compatibilidad y proveedor de embeddings.",
};

/** Tool Frida en modo guía (paquete ausente o tool upstream faltante). */
function guideTool(fridaName: string, guideText: string) {
  return {
    name: fridaName,
    label: fridaName,
    description: FRIDA_DESCRIPTIONS[fridaName] ?? fridaName,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    async execute(
      _toolCallId: string,
      _params: any,
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      return guideResult(guideText);
    },
  };
}

/** Registra la tool Frida como passthrough del tool upstream capturado
 *  (reenvío posicional de los 5 args del contrato execute del SDK). */
function passthroughTool(fridaName: string, upstream: CapturedTool) {
  return {
    name: fridaName,
    label: fridaName,
    description: FRIDA_DESCRIPTIONS[fridaName] ?? upstream.description,
    parameters: upstream.parameters ?? {
      type: "object",
      properties: {},
    },
    async execute(
      toolCallId: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      try {
        return await upstream.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          ctx,
        );
      } catch (e) {
        return withEmbeddingsGuide(e);
      }
    },
  };
}

/**
 * call_graph Frida = call_graph upstream + call_graph_path upstream vía
 * mode:'path' (D3). Schema fusionado; sin call_graph_path capturado,
 * mode:'path' degrada con guía.
 */
function callGraphTool(
  callGraph: CapturedTool,
  pathTool: CapturedTool | undefined,
) {
  const baseParams = (callGraph.parameters as Record<string, any>) ?? {
    type: "object",
    properties: {},
  };
  const merged = {
    ...baseParams,
    properties: {
      ...(baseParams.properties ?? {}),
      mode: {
        type: "string",
        enum: ["direct", "path"],
        description:
          "'direct' (default): callers/callees directos. 'path': ruta de llamadas más corta entre from y to (call_graph_path del upstream).",
      },
    },
  };
  return {
    name: "call_graph",
    label: "call_graph",
    description: FRIDA_DESCRIPTIONS.call_graph,
    parameters: merged,
    async execute(
      toolCallId: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      try {
        const { mode: _mode, ...rest } = params ?? {};
        if (params?.mode === "path") {
          if (!pathTool) {
            return guideResult(
              "frida-codebase-index: esta versión del paquete no expone call_graph_path. Actualiza el paquete desde el tab Index.",
              "codebase-index-missing-tool",
            );
          }
          return await pathTool.execute(
            toolCallId,
            rest,
            signal,
            onUpdate,
            ctx,
          );
        }
        return await callGraph.execute(
          toolCallId,
          rest,
          signal,
          onUpdate,
          ctx,
        );
      } catch (e) {
        return withEmbeddingsGuide(e);
      }
    },
  };
}

/** Estado del wrapper para el host (tab Index del webview, Slice 5). */
export interface CodebaseIndexState {
  installed: boolean;
  /** Tools upstream capturadas (nombres upstream) — vacío si no instalado. */
  capturedTools: string[];
}

/**
 * Factory embebida para extensionFactories (src/pi-session.ts). DEVUELVE la
 * promesa de carga: el loader hace await factory(api) y así espera el import()
 * completo antes de dar la sesión por lista.
 */
export function createFridaCodebaseIndex(
  opts: CreateCodebaseIndexOpts & {
    onStateChange?: (s: CodebaseIndexState) => void;
  },
) {
  const { agentDir, onLog, onStateChange } = opts;
  return async (pi: any) => {
    const register = (tool: unknown) => {
      try {
        pi.registerTool(tool);
      } catch (e: any) {
        onLog?.(
          `[codebase-index] registerTool ${String((tool as any)?.name)} falló: ${e?.message ?? e}`,
        );
      }
    };

    if (!isInstalledAtPin(agentDir)) {
      for (const fridaName of Object.keys(FRIDA_TO_UPSTREAM_TOOLS)) {
        register(guideTool(fridaName, missingPackageGuide(agentDir)));
      }
      onStateChange?.({ installed: false, capturedTools: [] });
      return;
    }

    try {
      const tools = await loadUpstreamTools(
        upstreamEntryPath(agentDir),
        onLog,
      );
      const capturedNames: string[] = [];
      for (const [fridaName, upstreamName] of Object.entries(
        FRIDA_TO_UPSTREAM_TOOLS,
      )) {
        const upstream = tools.get(upstreamName);
        if (!upstream) {
          register(
            guideTool(
              fridaName,
              `frida-codebase-index: el paquete instalado no expone la tool upstream '${upstreamName}'. Reinstala al pin desde el tab Index.`,
            ),
          );
          continue;
        }
        capturedNames.push(upstreamName);
        if (fridaName === "call_graph") {
          register(
            callGraphTool(upstream, tools.get("call_graph_path")),
          );
        } else {
          register(passthroughTool(fridaName, upstream));
        }
      }
      onStateChange?.({ installed: true, capturedTools: capturedNames });
    } catch (e: any) {
      const guideText = `${e?.message ?? e}\n\n${e?.guide ?? ""}`.trim();
      for (const fridaName of Object.keys(FRIDA_TO_UPSTREAM_TOOLS)) {
        register(guideTool(fridaName, guideText));
      }
      onStateChange?.({ installed: false, capturedTools: [] });
    }
  };
}

export { CODEBASE_INDEX_FACTORY_NAME };
```

#### 3. Tests del shim

**File**: `test/frida-codebase-index/shim.test.ts`
**Changes**: NEW — captura vía registerTool (convención SDK execute(toolCallId, params, signal, onUpdate, ctx)), absorción de commands/events, Proxy get-trap una-sola-vez, y `loadUpstreamTools` contra un entry `.mjs` REAL en temp (import() con pathToFileURL).

```typescript
// Tests del shim: captura vía registerTool (convención SDK execute(toolCallId,
// params, signal, onUpdate, ctx)), absorción de commands/events, Proxy get-trap,
// y loadUpstreamTools contra un entry .mjs REAL en temp (import() con
// pathToFileURL).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createCaptureShim,
  loadUpstreamTools,
} from "../../src/tools/frida-codebase-index/shim";

let tmp: string;

const FAKE_ENTRY = `
export default function (pi) {
  pi.registerTool({
    name: "codebase_search",
    description: "semantic search",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    async execute(toolCallId, params) {
      return { content: [{ type: "text", text: "id=" + toolCallId + " hit:" + params.query }] };
    },
  });
  pi.registerTool({
    name: "call_graph_path",
    async execute() { return { content: [{ type: "text", text: "path" }] }; },
  });
  pi.registerCommand("index", {});
  pi.on("session_start", async () => {});
  pi.setSessionName("oci-ok");
}
`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-shim-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createCaptureShim", () => {
  it("captura tools por nombre y absorbe commands/events sin crashear", () => {
    const shim = createCaptureShim();
    const api = shim.api as any;
    api.registerTool({
      name: "codebase_search",
      description: "s",
      parameters: { type: "object" },
      async execute() {},
    });
    api.registerTool({ name: "call_graph_path", async execute() {} });
    api.registerCommand("index", {});
    const unsub = api.on("session_start", async () => {});
    expect(typeof unsub).toBe("function");
    api.setSessionName("oci-ok");
    expect(shim.tools.size).toBe(2);
    expect(shim.tools.get("codebase_search")?.description).toBe("s");
    expect(shim.absorbed.commands).toEqual(["index"]);
    expect(shim.absorbed.events).toEqual(["session_start"]);
  });

  it("keys no implementadas devuelven undefined y se registran una sola vez", () => {
    const logs: string[] = [];
    const shim = createCaptureShim((l) => logs.push(l));
    expect((shim.api as any).projectRoot).toBeUndefined();
    expect((shim.api as any).projectRoot).toBeUndefined();
    expect(shim.absorbed.unknownKeys).toEqual(["projectRoot"]);
    expect(logs.filter((l) => l.includes("projectRoot"))).toHaveLength(1);
  });
});

describe("loadUpstreamTools", () => {
  it("importa un entry real (.mjs) y captura sus tools con la convención SDK", async () => {
    const entry = path.join(tmp, "pi-extension.mjs");
    fs.writeFileSync(entry, FAKE_ENTRY);
    const tools = await loadUpstreamTools(entry);
    expect(tools.size).toBe(2);
    const res = await tools
      .get("codebase_search")!
      .execute("id-1", { query: "hola" }, undefined, undefined, {});
    expect(res.content[0].text).toBe("id=id-1 hit:hola");
  });

  it("entry inexistente → CodebaseIndexLoadError", async () => {
    await expect(
      loadUpstreamTools(path.join(tmp, "no-existe.mjs")),
    ).rejects.toMatchObject({ name: "CodebaseIndexLoadError" });
  });

  it("entry sin factory → error con guía que menciona el pin", async () => {
    const entry = path.join(tmp, "not-a-factory.mjs");
    fs.writeFileSync(entry, "export default { not: 'a factory' };\n");
    await expect(loadUpstreamTools(entry)).rejects.toMatchObject({
      guide: expect.stringContaining("pin"),
    });
  });

  it("factory que lanza → error con guía de diagnóstico", async () => {
    const entry = path.join(tmp, "throws.mjs");
    fs.writeFileSync(
      entry,
      "export default function (pi) { throw new Error('boom'); }\n",
    );
    await expect(loadUpstreamTools(entry)).rejects.toMatchObject({
      guide: expect.stringContaining("keys no implementadas"),
    });
  });
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck de la extensión pasa: `npx tsc -p tsconfig.json --noEmit`
- [ ] Tests del shim pasan: `npx vitest run test/frida-codebase-index/shim.test.ts`
- [ ] Tests de Slices 1-2 siguen verdes: `npx vitest run test/frida-codebase-index/`

#### Manual Verification

- [ ] (Diferido al PoC del Slice 5 con el paquete real 0.23.0) la captura registra las tools upstream esperadas — el log del shim (absorbed.unknownKeys) delata cualquier contrato extra del upstream

---

## Phase 4: Registro en sesión + host setup (auth sync + gitignore)

### Overview

Efectos de lado del host ANTES de crear la sesión: `syncOpenAiKeyToAuthJson(agentDir, key)` (merge defensivo read-modify-write de `auth.json`, guard absoluto `existing !== undefined`, chmodSync 0o600) y `ensureGitignore(workspacePath)` para `.codebase-index/`. Registro de la factory en `extensionFactories` de `src/pi-session.ts` (después de `frida-agent-browser`, main-only) con gate inline que PROPAGA la promesa — NO `toggleable()`.

**Depende de**: Fases 1-3 (módulo completo del wrapper).

### Changes Required

#### 1. Host setup (auth sync + gitignore)

**File**: `src/tools/frida-codebase-index/host-setup.ts`
**Changes**: NEW — `syncOpenAiKeyToAuthJson()` (D4: expone la OpenAI key de Frida al detector del upstream vía `~/.frida/auth.json`; NUNCA pisa una entrada `openai` existente del usuario), `ensureGitignore()` (añade `.codebase-index/` al .gitignore del workspace si no está), `SyncOpenAiKeyResult`.

```typescript
/**
 * frida-codebase-index — host setup (issue #25, ADR-0036, D4).
 *
 * Dos efectos de lado del host ANTES de crear la sesión:
 *
 * 1. syncOpenAiKeyToAuthJson: si el usuario guardó la OpenAI key en Frida
 *    (SecretStorage frida.openaiKey, issue #43), la expone al detector de
 *    embeddings del upstream escribiendo authData["openai"]={type:"api",key}
 *    en <agentDir>/auth.json (research §F). Merge defensivo read-modify-write:
 *    NUNCA pisa una entrada `openai` existente del usuario — sea cual sea su
 *    shape (api con key, oauth, null tombstone, o cualquier otro): la suya
 *    manda — y nunca tira el resto del archivo (github-copilot oauth vive
 *    ahí). Best-effort: fallos se loggean, no rompen la sesión.
 * 2. ensureGitignore: añade `.codebase-index/` al .gitignore del workspace si
 *    no está (storage del upstream DENTRO del repo — research §D), para que el
 *    índice no aparezca como ruido en el SCM. Sin .gitignore lo crea.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CODEBASE_INDEX_STORAGE_DIR } from "./constants";

export interface SyncOpenAiKeyResult {
  written: boolean;
  /** already-present: el usuario ya tiene CUALQUIER auth openai propia (la suya
   *  manda). no-key: no hay OpenAI key guardada en Frida. */
  skipped?: "already-present" | "no-key";
}

/**
 * Expone la OpenAI key de Frida al detector del upstream vía auth.json del
 * agentDir. Idempotente y no destructivo. NOTA de carrera: el CLI `pi` también
 * escribe auth.json — ventana de carrera mínima (read-modify-write sin lock) y
 * el peor caso es re-escribir la misma entrada o perder una auth añadida
 * EXACTAMENTE entre read y write (no hemos visto locks en el SDK; aceptamos el
 * riesgo documentándolo).
 */
export function syncOpenAiKeyToAuthJson(
  agentDir: string,
  openAiKey: string | undefined,
  onLog?: (line: string) => void,
): SyncOpenAiKeyResult {
  if (!openAiKey) return { written: false, skipped: "no-key" };
  const authPath = path.join(agentDir, "auth.json");
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* ausente o inválido → empezamos un objeto nuevo */
  }
  const existing = data.openai;
  // NUNCA pisamos una entrada openai existente del usuario — sea cual sea su
  // shape (api con key, oauth, null tombstone, o cualquier otro): la suya manda
  // (D4 absoluto; un null puede ser un provider deliberadamente desactivado).
  if (existing !== undefined) {
    return { written: false, skipped: "already-present" };
  }
  data.openai = { type: "api", key: openAiKey };
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
    // chmod explícito (el mode flag de writeFileSync sólo aplica en creación;
    // auth.json ya suele existir con github-copilot oauth — patrón
    // ApprovalLogger, gates/approval-logger.ts:104).
    fs.chmodSync(authPath, 0o600);
    return { written: true };
  } catch (e: any) {
    onLog?.(`[codebase-index] syncOpenAiKey falló: ${e?.message ?? e}`);
    return { written: false };
  }
}

/** Añade `.codebase-index/` al .gitignore del workspace si no está. Devuelve
 *  true si escribió. Best-effort: fallos silenciosos (no rompen la sesión). */
export function ensureGitignore(
  workspacePath: string,
  onLog?: (line: string) => void,
): boolean {
  const giPath = path.join(workspacePath, ".gitignore");
  const entry = `${CODEBASE_INDEX_STORAGE_DIR}/`;
  try {
    if (fs.existsSync(giPath)) {
      const cur = fs.readFileSync(giPath, "utf8");
      const lines = cur.split("\n").map((l) => l.trim());
      if (
        lines.includes(entry.trim()) ||
        lines.includes(CODEBASE_INDEX_STORAGE_DIR)
      ) {
        return false;
      }
      const next = cur.endsWith("\n")
        ? `${cur}${entry}\n`
        : `${cur}\n${entry}\n`;
      fs.writeFileSync(giPath, next);
      return true;
    }
    fs.writeFileSync(giPath, `${entry}\n`);
    return true;
  } catch (e: any) {
    onLog?.(`[codebase-index] ensureGitignore falló: ${e?.message ?? e}`);
    return false;
  }
}
```

#### 2. Registro en la sesión

**File**: `src/pi-session.ts`
**Changes**: MODIFY — 4 inserciones: (a) imports, (b) 2 props opcionales en `CreateFridaSessionOptions`, (c) host-setup gateado tras poblar keyHolders, (d) entrada en `extensionFactories` (después de `frida-agent-browser`, main-only) con gate inline que PROPAGA la promesa.

```typescript
// (a) Añadir a los imports de providers/tools existentes:
import { OPENAI_PROVIDER } from "./providers/openai-provider";
import {
 createFridaCodebaseIndex,
 CODEBASE_INDEX_FACTORY_NAME,
} from "./tools/frida-codebase-index";
import {
 ensureGitignore,
 syncOpenAiKeyToAuthJson,
} from "./tools/frida-codebase-index/host-setup";

// (b) Añadir a CreateFridaSessionOptions:
 /** ¿Está activo frida-codebase-index? (frida.codebaseIndex.enabled, default true). */
 codebaseIndexEnabled?: () => boolean;
 /** Estado del wrapper (installed/capturedTools) para el tab Index del webview. */
 onCodebaseIndexState?: (
  s: import("./tools/frida-codebase-index").CodebaseIndexState,
 ) => void;

// (c) En createFridaSession, DESPUÉS de poblar keyHolders (bloque ADR-0017) y
// ANTES de crear el loader:
 // D4 (ADR-0036) — frida-codebase-index: exponer la OpenAI key de Frida (si
 // existe) al detector de embeddings del upstream vía ~/.frida/auth.json
 // (merge defensivo, la auth propia del usuario manda), y gitignore del
 // storage del índice (.codebase-index/ dentro del workspace). Best-effort.
 if (opts.codebaseIndexEnabled?.() ?? true) {
  syncOpenAiKeyToAuthJson(
   opts.agentDir,
   keyHolders[OPENAI_PROVIDER],
   (line) => console.warn(line),
  );
  ensureGitignore(opts.cwd, (line) => console.warn(line));
 }

// (d) En extensionFactories, DESPUÉS de la entrada frida-agent-browser:
  // frida-codebase-index (ADR-0036): búsqueda semántica + call graph vía
  // wrapper del paquete upstream open-codebase-index instalado on-demand
  // en ~/.frida/npm. La factory es ASYNC y el loader awaita su retorno
  // (loader.js:389) para que el import() del paquete complete antes de
  // dar la sesión por lista — por eso NO usamos toggleable() (su wrapper
  // síncrono descartaría la promesa y re-introduciría la race de registro
  // documentada en el Slice 3). Gate manual: sólo registra si enabled.
  // Si falta el paquete/Ollama, las 6 tools se registran en modo guía
  // accionable (D6). Main only (igual que frida-agent-browser).
  {
   name: CODEBASE_INDEX_FACTORY_NAME,
   factory: (pi: any) =>
    (opts.codebaseIndexEnabled?.() ?? true)
     ? createFridaCodebaseIndex({
       agentDir: opts.agentDir,
       onStateChange: opts.onCodebaseIndexState,
      })(pi)
     : undefined,
  },
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck de la extensión pasa: `npx tsc -p tsconfig.json --noEmit`
- [ ] Tests de Slices 1-3 siguen verdes: `npx vitest run test/frida-codebase-index/`
- [ ] El wiring existe: `grep -c "frida-codebase-index" src/pi-session.ts` devuelve >= 4

#### Manual Verification

- [ ] Con la OpenAI key guardada en Frida: tras recargar, `~/.frida/auth.json` contiene `"openai": {"type":"api","key":"..."}` y el resto del archivo (github-copilot) intacto; con CUALQUIER entrada openai previa del usuario, NO se sobreescribe
- [ ] El `.gitignore` del workspace gana `.codebase-index/` sin duplicar la entrada tras recargas sucesivas

---

## Phase 5: Tab "Index" del webview + comando VS Code

### Overview

Tab "Index" del SettingsHub: estado del paquete (con versión), acciones Instalar/Indexar/Rebuild/Estado del índice con progreso en vivo (lastLine), filas informativas de embeddings. Handler `codebase_index_action` en `src/extension.ts` (los últimos tres ejecutan el tool upstream capturado DIRECTO desde el host vía el mismo shim), publisher `postCodebaseIndexState()`, comando VS Code `frida.codebaseIndex` con flush pendiente en `webview_ready`.

**Depende de**: Fases 1-4 (estado publicado por la Fase 4). Dentro de la fase, el comando VS Code y el tab son independientes entre sí pero ambos dependen del estado publicado.

### Changes Required

#### 1. Tab "Index" del SettingsHub

**File**: `webview/components/IndexTab.tsx`
**Changes**: NEW — estado del paquete (con versión), acciones Instalar/Indexar/Rebuild/Estado del índice con progreso en vivo (lastLine), filas informativas de embeddings.

```tsx
// Tab "Index" del SettingsHub: estado y acciones de frida-codebase-index
// (instalación on-demand del paquete upstream, indexación, rebuild, estado).
// El estado llega por InMessage codebase_index_state; las acciones salen por
// codebase_index_action y las ejecuta el host (src/extension.ts).
import { Database, Download, Hammer, RefreshCw } from "lucide-react";
import type { OutMessage, State } from "../types";

export function IndexTab({
  state,
  post,
}: {
  state: State;
  post: (m: OutMessage) => void;
}) {
  const ci = state.codebaseIndex;
  return (
    <div className="cfg-resources">
      <div className="cfg-section">
        <Database size={13} /> Índice de código (semántico + call graph)
      </div>
      <div className="cfg-row-desc" style={{ marginBottom: 8 }}>
        Búsqueda por significado, grafo de llamadas y lookup de implementaciones
        (6 tools del agente). Requiere un paquete on-demand (~256 MB, se poda a
        ~1/5 del disco) y un proveedor de embeddings (Ollama local, tu key de
        OpenAI, o endpoint custom en settings frida.codebaseIndex.*).
      </div>
      <div className="cfg-res-actions">
        {!ci?.installed && (
          <button
            className="pc-save"
            disabled={!!ci?.busy}
            onClick={() =>
              post({ type: "codebase_index_action", action: "install" })
            }
          >
            <Download size={13} />{" "}
            {ci?.busy === "install" ? "Instalando…" : "Instalar paquete"}
          </button>
        )}
        {ci?.installed && (
          <>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "index" })
              }
            >
              <RefreshCw size={13} />{" "}
              {ci?.busy === "index" ? "Indexando…" : "Indexar (incremental)"}
            </button>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "rebuild" })
              }
            >
              <Hammer size={13} /> Rebuild completo
            </button>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "status" })
              }
            >
              <Database size={13} /> Estado del índice
            </button>
          </>
        )}
      </div>
      {ci?.lastLine && <div className="cfg-row-desc">{ci.lastLine}</div>}
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Paquete upstream</div>
          <div className="cfg-row-desc">
            {ci?.installed
              ? `Instalado${ci.version ? ` (v${ci.version})` : ""} (${ci.capturedTools?.length ?? 0} tools capturadas)`
              : "No instalado — las tools del agente responden con la guía de instalación"}
          </div>
        </div>
      </div>
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Embeddings</div>
          <div className="cfg-row-desc">
            Ollama local (`ollama pull nomic-embed-text`), tu key de OpenAI ya
            guardada en Frida, o endpoint custom. Sin índice, las tools muestran
            la guía del proveedor.
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### 2. Registro del tab en el hub

**File**: `webview/components/SettingsHub.tsx`
**Changes**: MODIFY — (a) `"codebaseIndex"` en la unión `SettingsTab`, (b) entrada `TABS` (icono Database, tras "usage"), (c) render del tab en el body, (d) import de `Database` de lucide-react, (e) import del componente `IndexTab`.

```tsx
// (a) Añadir a la unión SettingsTab:
 | "codebaseIndex";

// (b) Añadir a TABS (tras "usage"):
 { id: "codebaseIndex", label: "Index", icon: Database },

// (c) Añadir al render del body (tras el bloque tab === "usage"):
  {tab === "codebaseIndex" && <IndexTab state={state} post={post} />}

// (d) Añadir al import de lucide-react: Database
// (e) Añadir al import de componentes: import { IndexTab } from "./IndexTab";
```

#### 3. Tipos del webview

**File**: `webview/types.ts`
**Changes**: MODIFY — `CodebaseIndexUiState` + campo en `State`; InMessages `codebase_index_state`/`open_settings`; OutMessage `codebase_index_action` (install|index|rebuild|status).

```typescript
// (a) Añadir al interface State (junto a toolToggles):
 /** Estado del índice de código (frida-codebase-index) para el tab Index. */
 codebaseIndex?: CodebaseIndexUiState;

// (b) Añadir la interfaz cerca de ToolToggles:
/** Estado publicado por el host para el tab "Index" del SettingsHub. */
export interface CodebaseIndexUiState {
 /** Paquete upstream instalado al pin (y tools capturadas). */
 installed: boolean;
 /** Versión instalada del paquete upstream. */
 version?: string;
 capturedTools?: string[];
 /** Acción en curso (botones deshabilitados). */
 busy?: "install" | "index" | null;
 /** Última línea de progreso/resultado/error (guía incluida). */
 lastLine?: string;
}

// (c) Añadir a InMessage:
 | { type: "open_settings"; tab?: string }
 | { type: "codebase_index_state"; state: CodebaseIndexUiState }

// (d) Añadir a OutMessage:
 | { type: "codebase_index_action"; action: "install" | "index" | "rebuild" | "status" }
```

#### 4. Reducer del estado del tab

**File**: `webview/store.ts`
**Changes**: MODIFY — case del reducer para `codebase_index_state` (sin esto el mensaje cae en `default: return state` y el estado del tab nunca llega al UI).

```typescript
// En el reducer (reduce ~:221), añadir el case (mismo patrón spread que tool_toggles):
 case "codebase_index_state":
  return { ...state, codebaseIndex: msg.state };
```

#### 5. Handler open_settings + re-monte del hub

**File**: `webview/App.tsx`
**Changes**: MODIFY — handler de `open_settings` + re-monte del hub en el tab pedido (key + initialTab). Import del tipo `SettingsTab`.

```tsx
// (a) Añadir al import de SettingsHub:
import type { SettingsTab } from "./components/SettingsHub";

// (b) Añadir state junto a configOpen:
 const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);

// (c) En el handler de InMessage (if-chain ~114-127), añadir ANTES del dispatch:
 if (msg.type === "open_settings") {
  setConfigOpen(true);
  setSettingsTab(msg.tab);
  return; // no despachar al reducer
 }

// (d) El render del SettingsHub pasa key/initialTab (key fuerza re-monte con el
//     nuevo tab cuando el hub ya estaba abierto — initialTab sólo aplica al montar):
 {configOpen && (
  <SettingsHub
   key={settingsTab ?? "default"}
   state={state}
   post={post}
   onClose={() => {
    setConfigOpen(false);
    setSettingsTab(undefined);
   }}
   initialTab={(settingsTab ?? "providers") as SettingsTab}
  />
 )}
```

#### 6. Handler de acciones + comando + estado

**File**: `src/extension.ts`
**Changes**: MODIFY — (a) imports nuevos, (b) estado del tab + `postCodebaseIndexState()` + `ciSummarize()` + refresh de `ciUi` post-install (`isInstalledAtPin`), (c) opts en AMBAS llamadas `createFridaSession`, (d) case `codebase_index_action` en `handleWebviewMessage`, (e) comando `frida.codebaseIndex` con flush pendiente (y limpieza del flag tras el post directo), (f) flush en `webview_ready`.

```typescript
// (a) Imports nuevos:
import {
 readCodebaseIndexConfig,
 isCodebaseIndexEnabled,
} from "./settings";
import { ensureInstalled, installedVersion, isInstalledAtPin } from "./tools/frida-codebase-index/installer";
import { loadUpstreamTools } from "./tools/frida-codebase-index/shim";
import { upstreamEntryPath } from "./tools/frida-codebase-index/constants";

// (b) Estado del tab (junto a los demás caches, cerca de requestDumpPath):
 // Estado de frida-codebase-index para el tab Index del webview (S5).
 let ciUi: import("./tools/frida-codebase-index").CodebaseIndexState = {
  installed: false,
  capturedTools: [],
 };
 let ciBusy: "install" | "index" | null = null;
 let ciLastLine: string | undefined;
 // Tab pendiente del comando frida.codebaseIndex: el post() inmediato se
 // pierde en arranque frío (el listener del webview monta en webview_ready).
 let pendingSettingsTab: string | undefined;

 function postCodebaseIndexState(): void {
  post({
   type: "codebase_index_state",
   state: {
    ...ciUi,
    version: ciUi.installed ? installedVersion(defaultAgentDir()) : undefined,
    busy: ciBusy,
    lastLine: ciLastLine,
   },
  });
 }

 /** Resume el resultado de un tool upstream (content[0].text, primeras líneas). */
 function ciSummarize(res: any): string {
  const t = res?.content?.[0]?.text;
  if (typeof t === "string") return t.split("\n").slice(0, 12).join("\n");
  return JSON.stringify(res).slice(0, 400);
 }

// (c) En AMBAS llamadas createFridaSession (~747 ensureSession y ~3632 switchSession),
// añadir a los opts:
  codebaseIndexEnabled: isCodebaseIndexEnabled,
  onCodebaseIndexState: (s) => {
   ciUi = s;
   postCodebaseIndexState();
  },

// (d) En handleWebviewMessage, añadir el case (junto a set_tool_toggle ~2095):
 case "codebase_index_action": {
  const action = msg.action as "install" | "index" | "rebuild" | "status";
  ciBusy = action === "install" ? "install" : "index";
  ciLastLine = undefined;
  postCodebaseIndexState();
  try {
   if (action === "install") {
    await ensureInstalled(defaultAgentDir(), {
     keepOtherPlatforms: readCodebaseIndexConfig().keepOtherPlatforms,
     onProgress: (line) => {
      ciLastLine = line;
      postCodebaseIndexState();
     },
    });
    ciLastLine =
     "Instalado. Recarga la sesión (Frida: Recargar extensiones y recursos) para activar las tools.";
    // Refresh inmediato del estado instalado (sin esperar recarga de
    // sesión): el tab debe dejar de mostrar "No instalado".
    ciUi = {
     installed: isInstalledAtPin(defaultAgentDir()),
     capturedTools: ciUi.capturedTools,
    };
   } else {
    // index/rebuild/status: ejecutamos el tool upstream capturado DIRECTO
    // desde el host (mismo shim que el wrapper) — sin depender del
    // agente. ctx mínimo con cwd del workspace.
    const tools = await loadUpstreamTools(
     upstreamEntryPath(defaultAgentDir()),
    );
    const toolName = action === "status" ? "index_status" : "index_codebase";
    const t = tools.get(toolName);
    if (!t) throw new Error(`${toolName} no disponible en el paquete`);
    const res = await t.execute(
     `host-${action}`,
     { force: action === "rebuild" },
     undefined,
     undefined,
     { cwd: workspaceCwd() },
    );
    ciLastLine = ciSummarize(res);
   }
  } catch (e: any) {
   ciLastLine = e?.guide ?? e?.message ?? String(e);
  }
  ciBusy = null;
  postCodebaseIndexState();
  break;
 }

// (e) En el registro de comandos (~4139+), añadir:
 vscode.commands.registerCommand("frida.codebaseIndex", () => {
  pendingSettingsTab = "codebaseIndex";
  void vscode.commands
   .executeCommand("frida.openPanel")
   .then(() => {
    // Si el webview ya está listo llega directo; si no, lo flushea
    // webview_ready (f).
    post({ type: "open_settings", tab: "codebaseIndex" });
    // El post directo ya cubrió la apertura en caliente: limpiamos el
    // pendiente para que un re-mount posterior NO reabra el tab solo.
    pendingSettingsTab = undefined;
   });
 }),

// (f) En webview_ready (donde ya se postea postToolToggles), añadir:
  postCodebaseIndexState();
  if (pendingSettingsTab) {
   post({ type: "open_settings", tab: pendingSettingsTab });
   pendingSettingsTab = undefined;
  }
```

#### 7. Declaración del comando VS Code

**File**: `package.json`
**Changes**: MODIFY — `contributes.commands` con `frida.codebaseIndex` (junto a los demás frida.*).

```jsonc
// contributes.commands (junto a los demás frida.*):
  {
    "command": "frida.codebaseIndex",
    "title": "Frida: Codebase Index"
  },
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck de la extensión pasa: `npx tsc -p tsconfig.json --noEmit`
- [ ] Typecheck del webview pasa: `npx tsc -p tsconfig.webview.json --noEmit`
- [ ] Todos los tests del módulo pasan: `npx vitest run test/frida-codebase-index/`
- [ ] El comando está declarado: `grep -c "frida.codebaseIndex" package.json` devuelve >= 6 (5 settings + 1 comando)

#### Manual Verification

- [ ] PoC end-to-end (cierra la Open Question #2 del research): con Ollama corriendo, tab Index → Instalar (progreso visible) → recargar sesión → Indexar → "Índice listo (N chunks)"; en el chat "¿dónde se valida X?" hace que el agente use semantic_context/semantic_search y responda con símbolos reales
- [ ] Sin Ollama y sin key OpenAI: Indexar muestra la guía del proveedor (no error opaco); las tools del agente responden con la misma guía
- [ ] `call_graph({symbol:"sendUserMessage"})` devuelve callers con archivo:línea en este repo
- [ ] Sin paquete instalado: el comando frida.codebaseIndex abre el hub en el tab Index; las 6 tools del agente responden con la guía de instalación
- [ ] Medir y anotar: tamaño de `~/.frida/npm/node_modules/open-codebase-index` post-poda y de `.codebase-index/` del workspace tras indexar (Verification Note "Storage estimado")

---

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc                    | codebase-loc              | severity   | dimension     | finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | recommendation                                                                                                                                                                                                                                     | resolution         |
| -------- | --------------------------- | ------------------------- | ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| code     | Phase 2 §1 (installer.ts)   | <n/a>                     | concern    | code-quality  | Los comandos manuales de fallback (`MANUAL_CMD`, y `MISSING_PACKAGE_GUIDE` en Phase 3) embeben `~/.frida/npm`, que cmd.exe y PowerShell no expanden en argumentos de comandos nativos: la guía de degradación (mostrada justo cuando el spawn de auto-install falló) produce un comando roto en win32 — plataforma que el plan soporta explícitamente vía `PLATFORM_NATIVE["win32-x64"]`                                                                                                                                                                                                                                                            | Resolver el home dir con `os.homedir()` e interpolar el prefix absoluto en las cadenas de guía mostradas a usuarios win32                                                                                                                             | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): MANUAL_CMD→manualCmd(agentDir) y MISSING_PACKAGE_GUIDE→missingPackageGuide(agentDir), prefix absoluto path.join(agentDir,"npm") entre comillas (agentDir del runtime en vez de os.homedir(): ya resuelve el home real) |
| code     | Phase 5 §5 (App.tsx)        | webview/App.tsx:848       | concern    | code-quality  | `setSettingsTab(msg.tab)` nunca se resetea al cerrar el hub: tras un uso del comando `frida.codebaseIndex`, cada apertura posterior vía el ícono de engranaje (`setConfigOpen(true)`) re-entra al hub en el tab "Index" en vez de "providers", porque `key={settingsTab ?? "default"}` / `initialTab` conservan el tab obsoleto                                                                                                                                                                                       | Resetear el tab en el handler de cierre: `onClose={() => { setConfigOpen(false); setSettingsTab(undefined); }}`                                                                                                                               | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): onClose resetea settingsTab a undefined junto a setConfigOpen(false) |
| code     | Phase 5 §6 (extension.ts)  | src/extension.ts:1871     | concern    | code-quality  | En el comando `frida.codebaseIndex`, el `post({ type: "open_settings", … })` directo dentro del `.then()` nunca limpia `pendingSettingsTab`: el flag queda seteado para siempre tras una apertura en caliente, y un re-mount posterior del webview (dispose + resolve de la sidebar) auto-abre el tab Index vía el flush de `webview_ready` sin que el usuario lo pida                                                                                                                                                            | Limpiar `pendingSettingsTab` una vez confirmada la entrega del post directo (p.ej. revisar el thenable de `postMessage`) y dejarlo seteado sólo para el path de arranque frío cubierto por el flush                                                            | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): pendingSettingsTab = undefined dentro del .then() tras el post directo; el flush de webview_ready queda sólo para arranque frío |
| code     | Phase 5 §6 (extension.ts)  | src/extension.ts:2095     | concern    | code-quality  | Tras un `ensureInstalled` exitoso el handler sólo setea `ciLastLine` ("Instalado. Recarga…") pero nunca actualiza `ciUi.installed`: `postCodebaseIndexState()` sigue reportando `installed: false` hasta recargar la sesión, y el tab renderiza "No instalado" + botón Instalar junto a la línea contradictoria "Instalado"                                                                                                                                                                                             | Tras un install exitoso, refrescar `ciUi` desde `isInstalledAtPin(defaultAgentDir())` (añadirlo al import de Phase 5 §6(a)) antes del `postCodebaseIndexState()` final                                                                              | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): tras install exitoso, ciUi se refresca con isInstalledAtPin(defaultAgentDir()) (import añadido a §6(a)) antes del post final |
| code     | Phase 1 §2 (settings.ts)   | src/settings.ts:1         | suggestion | codebase-fit  | Todos los fences MODIFY (settings.ts, pi-session.ts, extension.ts, webview/store.ts, App.tsx, SettingsHub.tsx) usan indentación de 2 espacios mientras todos los archivos target en HEAD están indentados con tabs, produciendo indentación mixta dentro de los archivos modificados                                                                                                                                                                                                                                            | Re-indentar los snippets insertados a tabs para matchear el código circundante en cada target MODIFY                                                                                                                                             | applied: los 7 fences MODIFY (settings.ts, pi-session.ts, SettingsHub.tsx, types.ts, store.ts, App.tsx, extension.ts) re-indentados a tabs (2 espacios→1 tab); NEW files quedan a 2 espacios (biome normaliza al crearlos, como anticipa el diseño) |
| code     | Phase 3 §2 (index.ts)      | node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:339 | suggestion | codebase-fit | `guideTool`/`passthroughTool`/`callGraphTool` registran tools sin `label`, que el `ToolDefinition` del SDK declara requerido ("Human-readable label for UI") y toda tool embebida sibling setea (p.ej. `pi.registerTool({ name, label, … })` en src/tools/frida-supi-web/index.ts:101) — compila sólo porque el wrapper tipa `pi` como `any`                                                                                                            | Añadir un campo `label` (espejando el nombre Frida de la tool) a los tres tool builders de Phase 3 §2                                                                                                                                             | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): label añadido a guideTool/passthroughTool/callGraphTool, espejando el nombre Frida de la tool |
| code     | Phase 5 §7 (package.json)  | package.json:23           | suggestion | codebase-fit | El comando nuevo usa `"title": "Codebase Index", "category": "Frida"` mientras los 20 comandos siblings en `contributes.commands` usan el prefijo `"Frida: …"` en title sin `category`, así que ordena/renderiza distinto en la paleta de comandos                                                                                                                                                                                                                             | Usar `"title": "Frida: Codebase Index"` y eliminar el campo `category` para matchear la convención sibling                                                                                                                                     | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md): title "Frida: Codebase Index" sin category — revierte la elección "cosmetic" del Developer Context del diseño (category por orden alfabético), ratificado en triage |

_Coverage review: sin hallazgos — todos los intents de verificación del `## Verification Notes` y las lecciones de precedentes del diseño aterrizan en un bullet de `### Success Criteria` de alguna fase o como espejo visible en el código (las per-slice Manual Verification pasaron verbatim)._

## Testing Strategy

### Automated

- Typecheck de la extensión: `npx tsc -p tsconfig.json --noEmit` (todas las fases)
- Typecheck del webview: `npx tsc -p tsconfig.webview.json --noEmit` (Fase 5)
- Tests del módulo: `npx vitest run test/frida-codebase-index/` (constantes, installer con mocks, shim con factory fake)

### Manual Testing Steps

1. **PoC crítico (Open Question #2 del research)**: el native `.node` del upstream debe cargar en el extension host de VS Code — validar empíricamente en Fase 5: instalar, abrir Frida, `index_status` responde sin crash de require.
2. Upstream de fuente TS: el paquete instalado en `~/.frida/npm` queda FUERA de `tsconfig.json` — verificar que `npx tsc -p tsconfig.json --noEmit` no lo audita (lección `31a3170`).
3. npm spawn: usar `--legacy-peer-deps` (igual que el SDK, `package-manager.js:1475-1481`) para evitar conflicto con peerDeps del paquete.
4. Verificar que `import()` nativo del entry del paquete no tropieza con el bug de `import.meta.url` bajo jiti (por eso NO usamos jiti — patrón frida-lens `pi-session.ts:326-343`).
5. Tras indexar, `.codebase-index/` no debe aparecer como ruido en el SCM de VS Code (gitignore automático).
6. Storage estimado: medir tamaño post-poda y del índice del propio repo en la validación manual.

## Performance Considerations

- Carga lazy: el wrapper sólo hace `import()` del paquete cuando la feature está enabled Y el paquete está instalado; el arranque de sesión no paga el costo si está desactivada (patrón fail-silent frida-lens invertido en accionable).
- Instalación: ~256 MB de descarga única (tarball npm), disco post-poda ~1/5 (sólo el native de la plataforma + JS).
- Indexación inicial: costosa (parse + embeddings) pero incremental después (content-hash + batchs de 64 archivos/8 MiB — research §E); el agente puede seguir chateando mientras (la indexación corre en el proceso del host, no bloquea el loop del chat).
- 6 descripciones de tools en system prompt (~aprox 600 tokens) vs 16 de la delegación pura.

## Migration Notes

No aplica: feature nueva, sin datos previos. Desinstalación limpia: borrar `~/.frida/npm/node_modules/open-codebase-index` y `.codebase-index/` del repo.

## Developer Context

Step 5 (triage 2026-08-15): los 7 hallazgos del artifact-code-reviewer se triagiaron como **applied** (artifact-coverage-reviewer: sin hallazgos). Seis tienen root-cause en el `## Architecture` del diseño y se aplicaron plan-local — si se desea sincronizar el diseño fuente, es follow-up sobre `.rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md`. Detalles clave:

- code-1: las guías manuales usan prefix absoluto vía `path.join(agentDir, "npm")` (el agenteDir del runtime ya resuelve el home — `os.homedir()` resultó innecesario). La guía de `CodebaseIndexLoadError` en shim.ts mantiene la mención literal `~/.frida/npm` (fuera del alcance del hallazgo triaged; vía primaria ahí es el botón Instalar).
- code-5: fences MODIFY re-indentados a tabs; archivos NEW quedan a 2 espacios (biome normaliza al crearlos — anticipado en el Developer Context del diseño).
- code-7: título del comando estandarizado al patrón sibling `"Frida: Codebase Index"` sin `category`, revirtiendo la elección deliberada del diseño (ratificado en triage).

## References

- Design: `.rpiv/artifacts/designs/2026-08-14_23-33-43_frida-codebase-index.md`
- Research: `.rpiv/artifacts/research/2026-08-14_23-26-53_frida-codebase-index.md`
- Issue #25: <https://github.com/efuentesp/frida-code-vsix/issues/25>
- ADR-0036: `docs/adr/0036-frida-codebase-index-busqueda-semantica-call-graph.md`
- Upstream: <https://github.com/Helweg/open-codebase-index> (MIT, v0.23.0)
