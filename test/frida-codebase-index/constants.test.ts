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
