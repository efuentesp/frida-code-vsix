import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * D16 — pi-lens: capa semántica del *agente*, distinta del LSP del editor.
 *
 * pi-lens ya se descubre y carga por ADR-0005. Por defecto **auto-formatea y
 * auto-fixea** los archivos que el agente toca, lo que (a) duplica el formateo
 * on-save de VS Code y (b) muta archivos **fuera** del gate de aprobación (D7).
 * Aquí desactivamos esas mutaciones, dejando activos los tools orientados al
 * agente (module_report, read_symbol, ast_grep, symbol_search, lsp_navigation,
 * read-guard, etc.) y el LSP propio de pi-lens (consulta puntual del modelo).
 *
 * Mecanismo: pi-lens lee su config global de `process.env.PI_LENS_CONFIG_PATH`
 * si está definido, y si no, de `~/.pi-lens/config.json`. Seteando esa variable
 * apuntando a un archivo propio de Frida (en globalStorageUri) aislamos la
 * configuración: **solo afecta al extension host de VS Code**, no al `pi` CLI
 * del usuario (que corre en otro proceso y sigue leyendo su `~/.pi-lens/...`).
 *
 * Respetamos la config del usuario (ej. `ignore`): hacemos merge y SOLO forzamos
 * `format.enabled = false` y `autofix.enabled = false`.
 *
 * Nunca lanza: si algo falla, dejamos que pi-lens use su config por defecto.
 */

/** Path de la config global de pi-lens DEL USUARIO (la que lee el CLI `pi`). */
function userGlobalConfigPath(): string {
  return path.join(os.homedir(), ".pi-lens", "config.json");
}

/**
 * Escribe `<globalStoragePath>/pilens-config.json` = merge de la config del
 * usuario con `format.enabled=false` y `autofix.enabled=false`, y devuelve su
 * path absoluto (para asignarlo a `process.env.PI_LENS_CONFIG_PATH`).
 *
 * Idempotente: se regenera en cada `createFridaSession`, así que los cambios del
 * usuario a su config global se reflejan al (re)abrir sesión.
 */
export function preparePiLensConfig(
  globalStoragePath: string,
  userConfigPath: string = userGlobalConfigPath(),
): string {
  const outPath = path.join(globalStoragePath, "pilens-config.json");

  let userConfig: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(userConfigPath, "utf-8");
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      userConfig = parsed as Record<string, unknown>;
    }
  } catch {
    /* no existe o es inválida → partimos de {} */
  }

  // Shallow-merge preservando sub-objetos (mode, maxFixes, …) y forzando solo
  // los dos campos que D16 requiere.
  const merged: Record<string, unknown> = { ...userConfig };
  merged.format = { ...(isObject(userConfig.format) ? userConfig.format : {}), enabled: false };
  merged.autofix = { ...(isObject(userConfig.autofix) ? userConfig.autofix : {}), enabled: false };

  try {
    fs.mkdirSync(globalStoragePath, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  } catch {
    /* si no se puede escribir, devolvemos igual el path: pi-lens caerá a su
       config por defecto (format/autofix ON) — no rompemos la sesión. */
  }
  return outPath;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
