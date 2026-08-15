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
