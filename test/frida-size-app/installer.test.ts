// frida-size-app — tests del installer del binario scc (#139, M10).
//
// Molde: test/frida-codebase-index/installer.test.ts (deps inyectables sin
// red; NO aísla HOME — el installer no lee HOME) + test/frida-cc-plugins/
// phase2.test.ts:403-435 (negativo de integridad sha256 con estado
// inmutable). Los fixtures de archivo se construyen EN el test: gzip calcula
// su propio CRC (más simple que makeZip) y el zip win32 es stored mínimo
// (CRC32 + central directory) que ejercita el unzipSync REAL.

import { createHash } from "node:crypto";
import {
 existsSync,
 mkdirSync,
 mkdtempSync,
 readFileSync,
 rmSync,
 statSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
 SCC_ASSETS,
 SCC_DIGESTS,
 SCC_PIN,
 sccBinPath,
 sccMarkerPath,
} from "../../src/tools/frida-size-app/constants";
import {
 ensureBinary,
 extractTarGz,
 isSccInstalledAtPin,
 readSccMarker,
} from "../../src/tools/frida-size-app/installer";

// ─── Fixtures de archivo (tar.gz ustar y zip stored mínimos) ──────────────

/** Header ustar de 512 bytes con checksum válido (aunque el parser no lo
 *  valide, lo producimos correcto por si el formato evoluciona). */
function tarHeader(name: string, size: number): Buffer {
 const h = Buffer.alloc(512);
 h.write(name.slice(0, 100), 0, 100, "utf-8");
 h.write("0000755\0", 100, 8, "utf-8"); // mode
 h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf-8");
 h.write("0", 156, 1, "utf-8"); // typeflag: archivo regular
 h.write("ustar\0", 257, 6, "utf-8");
 h.write("00", 263, 2, "utf-8");
 h.write("        ", 148, 8, "utf-8"); // checksum como espacios
 let sum = 0;
 for (const b of h) sum += b;
 h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf-8");
 return h;
}

/** tar.gz con N archivos (data padded a 512 + 2 bloques de fin). */
function makeTarGz(entries: Array<{ name: string; data: Buffer }>): Buffer {
 const parts: Buffer[] = [];
 for (const e of entries) {
  parts.push(tarHeader(e.name, e.data.length));
  parts.push(e.data);
  const pad = (512 - (e.data.length % 512)) % 512;
  if (pad) parts.push(Buffer.alloc(pad));
 }
 parts.push(Buffer.alloc(1024));
 return zlib.gzipSync(Buffer.concat(parts));
}

const CRC_TABLE = (() => {
 const t = new Uint32Array(256);
 for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  t[n] = c >>> 0;
 }
 return t;
})();

function crc32(buf: Buffer): number {
 let c = 0xffffffff;
 for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
 return (c ^ 0xffffffff) >>> 0;
}

/** Zip stored mínimo (local + central + EOCD) compatible con unzipSync. */
function makeStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
 const locals: Buffer[] = [];
 const centrals: Buffer[] = [];
 let offset = 0;
 for (const e of entries) {
  const nameB = Buffer.from(e.name, "utf-8");
  const crc = crc32(e.data);
  const local = Buffer.alloc(30 + nameB.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0x21, 12); // date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(e.data.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(nameB.length, 26);
  nameB.copy(local, 30);
  locals.push(local, e.data);
  const central = Buffer.alloc(46 + nameB.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); // flags
  central.writeUInt16LE(0, 10); // method
  central.writeUInt16LE(0, 12); // time
  central.writeUInt16LE(0x21, 14); // date
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(e.data.length, 20);
  central.writeUInt32LE(e.data.length, 24);
  central.writeUInt16LE(nameB.length, 28);
  central.writeUInt32LE(offset, 42);
  nameB.copy(central, 46);
  centrals.push(central);
  offset += 30 + nameB.length + e.data.length;
 }
 const cd = Buffer.concat(centrals);
 const eocd = Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50, 0);
 eocd.writeUInt16LE(entries.length, 8);
 eocd.writeUInt16LE(entries.length, 10);
 eocd.writeUInt32LE(cd.length, 12);
 eocd.writeUInt32LE(offset, 16);
 return Buffer.concat([...locals, cd, eocd]);
}

/** Fixture: marker al pin + binario presente (= ya instalado). */
function fixtureSccAtPin(agentDir: string, asset: string): void {
 const platform = (
  asset.includes("Windows") ? "win32" : "darwin"
 ) as NodeJS.Platform;
 mkdirSync(join(agentDir, "bin"), { recursive: true });
 writeFileSync(sccBinPath(agentDir, platform), "#!/bin/sh\necho scc\n");
 writeFileSync(
  sccMarkerPath(agentDir),
  JSON.stringify({ pin: SCC_PIN, asset, sha256: "0".repeat(64) }),
 );
}

let agentDir: string;

beforeEach(() => {
 agentDir = mkdtempSync(join(tmpdir(), "size-scc-"));
});

afterEach(() => {
 rmSync(agentDir, { recursive: true, force: true });
});

describe("frida-size-app installer · binario scc@pin (#139)", () => {
 it("SCC_DIGESTS cubre exactamente SCC_ASSETS (guardián del bump deliberado)", () => {
  const assets = new Set(Object.values(SCC_ASSETS));
  const digests = new Set(Object.keys(SCC_DIGESTS));
  expect(assets.size).toBe(8);
  expect(digests.size).toBe(assets.size);
  for (const a of assets) expect(digests.has(a), a).toBe(true);
 });

 it("idempotente: marker al pin + binario → no descarga", async () => {
  fixtureSccAtPin(agentDir, "scc_Darwin_arm64.tar.gz");
  let fetched = 0;
  const res = await ensureBinary(agentDir, {
   platform: "darwin",
   arch: "arm64",
   deps: {
    fetchArchive: async () => {
     fetched++;
     throw new Error("no debía descargar");
    },
   },
  });
  expect(res.alreadyInstalled).toBe(true);
  expect(fetched).toBe(0);
  expect(isSccInstalledAtPin(agentDir, "darwin", "arm64")).toBe(true);
 });

 it("instala tar.gz (darwin-arm64): sha ok → binario ejecutable + marker al pin", async () => {
  const tarGz = makeTarGz([
   { name: "scc", data: Buffer.from("#!/bin/sh\necho scc-mock\n") },
   { name: "README.md", data: Buffer.from("# scc mock\n") },
  ]);
  const sha = createHash("sha256").update(tarGz).digest("hex");
  const res = await ensureBinary(agentDir, {
   platform: "darwin",
   arch: "arm64",
   deps: {
    fetchArchive: async () => tarGz,
    digests: { "scc_Darwin_arm64.tar.gz": sha },
   },
  });
  expect(res.alreadyInstalled).toBe(false);
  expect(res.asset).toBe("scc_Darwin_arm64.tar.gz");
  const bin = sccBinPath(agentDir, "darwin");
  expect(existsSync(bin), bin).toBe(true);
  expect(statSync(bin).mode & 0o111).not.toBe(0); // ejecutable
  expect(readFileSync(bin, "utf8")).toContain("scc-mock");
  const marker = readSccMarker(agentDir);
  expect(marker?.pin).toBe(SCC_PIN);
  expect(marker?.sha256).toBe(sha);
  // El staging se limpia.
  expect(existsSync(join(agentDir, "bin", ".scc-staging"))).toBe(false);
 });

 it("instala zip (win32-x64): unzipSync → scc.exe, sin chmod", async () => {
  const zip = makeStoredZip([
   { name: "scc.exe", data: Buffer.from("MZ scc mock") },
  ]);
  const sha = createHash("sha256").update(zip).digest("hex");
  const res = await ensureBinary(agentDir, {
   platform: "win32",
   arch: "x64",
   deps: {
    fetchArchive: async () => zip,
    digests: { "scc_Windows_x86_64.zip": sha },
   },
  });
  expect(res.asset).toBe("scc_Windows_x86_64.zip");
  expect(existsSync(sccBinPath(agentDir, "win32"))).toBe(true);
 });

 it("sha256 incorrecto → rechaza y NO deja nada a medias (V7)", async () => {
  const tarGz = makeTarGz([{ name: "scc", data: Buffer.from("malvado") }]);
  await expect(
   ensureBinary(agentDir, {
    platform: "darwin",
    arch: "arm64",
    deps: {
     fetchArchive: async () => tarGz,
     digests: { "scc_Darwin_arm64.tar.gz": "0".repeat(64) },
    },
   }),
  ).rejects.toMatchObject({
   name: "SccInstallError",
   message: expect.stringMatching(/sha256|integridad/),
  });
  expect(existsSync(sccBinPath(agentDir, "darwin"))).toBe(false);
  expect(readSccMarker(agentDir)).toBeUndefined();
 });

 it("tar-slip: extractTarGz rechaza entradas '../' (paridad zip-slip)", () => {
  const tarGz = makeTarGz([{ name: "../evil.sh", data: Buffer.from("x") }]);
  expect(() => extractTarGz(tarGz, join(agentDir, "out"))).toThrow(
   /insegura|tar-slip/,
  );
 });

 it("plataforma sin asset (freebsd) → SccInstallError con guía manual", async () => {
  await expect(
   ensureBinary(agentDir, { platform: "freebsd", arch: "x64" }),
  ).rejects.toMatchObject({
   name: "SccInstallError",
   guide: expect.stringContaining("Descarga manual"),
  });
 });

 it("fallo de red → SccInstallError con guía (nunca opaco)", async () => {
  await expect(
   ensureBinary(agentDir, {
    platform: "darwin",
    arch: "arm64",
    deps: {
     fetchArchive: async () => {
      throw new Error("HTTP 502");
     },
    },
   }),
  ).rejects.toMatchObject({
   name: "SccInstallError",
   guide: expect.stringContaining("Descarga manual"),
  });
 });
});
