import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { preparePiLensConfig } from "../src/pilens-config";

// D16 — pilens-config: el merge debe (a) partir de la config del usuario si
// existe, (b) preservar sus campos (ignore, format.mode, …) y (c) forzar SOLO
// format.enabled=false y autofix.enabled=false. Sin config de usuario, escribe
// justo esos dos campos. Nunca lanza.

describe("preparePiLensConfig (D16)", () => {
  let tmp: string;

  beforeEach(() => {
    // dir temporal: globalStorage (salida) + un "home" falso para la config del usuario
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pilens-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fuerza format.enabled=false y autofix.enabled=false sin config de usuario", () => {
    const globalStorage = path.join(tmp, "globalStorage");
    const userCfg = path.join(tmp, "user-config.json"); // no existe

    const out = preparePiLensConfig(globalStorage, userCfg);
    expect(out).toBe(path.join(globalStorage, "pilens-config.json"));

    const written = JSON.parse(fs.readFileSync(out, "utf-8"));
    expect(written.format).toEqual({ enabled: false });
    expect(written.autofix).toEqual({ enabled: false });
  });

  it("preserva los campos del usuario y solo sobreescribe los dos flags", () => {
    const globalStorage = path.join(tmp, "globalStorage");
    const userCfg = path.join(tmp, "user-config.json");
    fs.writeFileSync(
      userCfg,
      JSON.stringify({
        ignore: ["**/*.snap", "dist/**"],
        format: { enabled: true, mode: "immediate" },
        autofix: { enabled: true },
        widget: { visible: false },
        contextInjection: { enabled: false },
      }),
      "utf-8",
    );

    const out = preparePiLensConfig(globalStorage, userCfg);
    const written = JSON.parse(fs.readFileSync(out, "utf-8"));

    // Conserva lo ajeno a format/autofix.
    expect(written.ignore).toEqual(["**/*.snap", "dist/**"]);
    expect(written.widget).toEqual({ visible: false });
    expect(written.contextInjection).toEqual({ enabled: false });

    // Fuerza los dos flags D16, preservando sub-campos (mode).
    expect(written.format).toEqual({ enabled: false, mode: "immediate" });
    expect(written.autofix).toEqual({ enabled: false });
  });

  it("si la config del usuario es inválida, parte de vacío sin lanzar", () => {
    const globalStorage = path.join(tmp, "globalStorage");
    const userCfg = path.join(tmp, "user-config.json");
    fs.writeFileSync(userCfg, "{ no es json valido", "utf-8");

    const out = preparePiLensConfig(globalStorage, userCfg);
    const written = JSON.parse(fs.readFileSync(out, "utf-8"));
    expect(written.format).toEqual({ enabled: false });
    expect(written.autofix).toEqual({ enabled: false });
  });

  it("ignora una config de usuario que no es objeto (ej. array)", () => {
    const globalStorage = path.join(tmp, "globalStorage");
    const userCfg = path.join(tmp, "user-config.json");
    fs.writeFileSync(userCfg, JSON.stringify(["no", "es", "objeto"]), "utf-8");

    const out = preparePiLensConfig(globalStorage, userCfg);
    const written = JSON.parse(fs.readFileSync(out, "utf-8"));
    expect(written.format).toEqual({ enabled: false });
    expect(written.autofix).toEqual({ enabled: false });
  });

  it("crea el directorio de salida si no existe", () => {
    const globalStorage = path.join(tmp, "globalStorage", "anidado", "profundo");
    const out = preparePiLensConfig(globalStorage, path.join(tmp, "no-existe.json"));
    expect(fs.existsSync(out)).toBe(true);
  });
});
