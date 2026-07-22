// Smoke test HEADLESS (sin VS Code, sin red, sin key).
// Verifica el riesgo #1: ¿modelRuntime.getModel("softtek-devengine","gpt-5.4-mini")
// resuelve tras el registerProvider de la factory? Si la sesión se crea, sí.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createFridaSession } from "../src/pi-session";
import { SOFTTEK_MODEL, SOFTTEK_PROVIDER, SOFTTEK_PROVIDER_CONFIG } from "../src/providers/softtek-provider";

(async () => {
  const tmpSessionDir = path.join(os.tmpdir(), "frida-smoke-sessions");
  fs.mkdirSync(tmpSessionDir, { recursive: true });

  try {
    const frida = await createFridaSession({
      cwd: process.cwd(),
      agentDir: path.join(os.homedir(), ".pi", "agent"),
      sessionDir: tmpSessionDir,
      getKey: () => undefined, // getModel no requiere auth
      onUnauthorized: () => {},
      onPendingApprovals: () => {},
    });
    console.log("✅ Sesión creada → el modelo SÍ se resolvió tras registerProvider.");
    console.log("   sessionId:", frida.session.sessionId);
    try { frida.session.dispose?.(); } catch { /* noop */ }
  } catch (e: any) {
    console.log("❌ Falló la creación de sesión:");
    console.log("   ", e?.stack || e?.message || e);
    process.exitCode = 1;
  }

  // Verificación del gate de auth: ¿setRuntimeApiKey hace que getAuth resuelva?
  try {
    const mr = await ModelRuntime.create();
    mr.registerProvider(SOFTTEK_PROVIDER, SOFTTEK_PROVIDER_CONFIG);
    const m = mr.getModel(SOFTTEK_PROVIDER, SOFTTEK_MODEL);
    if (!m) throw new Error("getModel devolvió undefined");

    const withoutKey = await mr.getAuth(m).catch((e: any) => "THROW: " + e.message);
    console.log("   getAuth SIN key:", JSON.stringify(withoutKey));

    await mr.setRuntimeApiKey(SOFTTEK_PROVIDER, "fake-key-123");
    const withKey = await mr.getAuth(m).catch((e: any) => "THROW: " + e.message);
    const resolved = withKey && typeof withKey === "object" && (withKey as any).auth?.apiKey;
    console.log("   getAuth CON setRuntimeApiKey:", resolved ? `apiKey resuelto (='${(withKey as any).auth.apiKey}')` : JSON.stringify(withKey));
    console.log(resolved ? "✅ setRuntimeApiKey resuelve el auth → es el fix correcto." : "❌ setRuntimeApiKey NO resolvió el auth.");
    if (!resolved) process.exitCode = 1;
  } catch (e: any) {
    console.log("❌ Check de auth gate falló:", e?.message || e);
    process.exitCode = 1;
  }
})();
