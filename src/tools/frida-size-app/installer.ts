/**
 * frida-size-app — installer del binario scc (issue #139, M10 Pista M).
 *
 * Descarga scc@PIN (GitHub Releases) al agentDir con sha256 verificado ANTES
 * de extraer (orden espejo frida-cc-plugins/fetch.ts:339-343), extracción
 * tar.gz mínima sobre node:zlib (NO existe primitiva tar en el árbol — más
 * simple que zip: bloques de 512 bytes sin central directory, gzip aporta el
 * CRC) o unzipSync existente para los assets win32 .zip, copia a
 * <agentDir>/bin/scc + chmod 0o755 (no-win32) + marker de pin. Errores
 * siempre con guía accionable (D6/lessons 34d496a/7500370); la instalación
 * NUNCA bloquea ni crashea la sesión (el disparo fire-and-forget vive en la
 * factory, molde frida-hermes-memory/index.ts:181-190).
 *
 * Todo inyectable para tests sin red (deps.fetchArchive + deps.digests +
 * platform/arch), molde installer.test.ts de codebase-index.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { unzipSync } from "../frida-cc-plugins/fetch";
import {
 SCC_DIGESTS,
 SCC_PIN,
 SCC_RELEASE_BASE,
 currentSccAsset,
 isTarAsset,
 sccAssetUrl,
 sccBinPath,
 sccMarkerPath,
} from "./constants";

/** Máximo tamaño de asset (paridad frida-cc-plugins: 256 MiB). */
const MAX_SCC_ASSET_BYTES = 256 * 1024 * 1024;

/** Error de instalación con guía accionable (nunca errores opacos). */
export class SccInstallError extends Error {
 /** Pasos concretos para resolver manualmente. */
 readonly guide: string;
 constructor(message: string, guide: string) {
  super(message);
  this.name = "SccInstallError";
  this.guide = guide;
 }
}

/** Contenido del marker de instalación. */
export interface SccMarker {
 pin: string;
 asset: string;
 sha256: string;
}

/** Lee el marker; undefined si ausente/corrupto (= no instalado). */
export function readSccMarker(agentDir: string): SccMarker | undefined {
 try {
  const raw = JSON.parse(
   fs.readFileSync(sccMarkerPath(agentDir), "utf8"),
  ) as Partial<SccMarker>;
  if (
   typeof raw.pin === "string" &&
   typeof raw.asset === "string" &&
   typeof raw.sha256 === "string"
  ) {
   return { pin: raw.pin, asset: raw.asset, sha256: raw.sha256 };
  }
 } catch {
  /* ausente o corrupto → no instalado */
 }
 return undefined;
}

/**
 * ¿scc está instalado AL PIN con binario presente? Sonda SÍNCRONA — la usa
 * resolve() del patrón (que es síncrona por contrato del motor) y la factory
 * para el gate del fire-and-forget (D2). arch inyectable para tests (el
 * marker debe matchear el asset de ESTA plataforma-arquitectura).
 */
export function isSccInstalledAtPin(
 agentDir: string,
 platform: NodeJS.Platform = process.platform,
 arch: string = process.arch,
): boolean {
 const marker = readSccMarker(agentDir);
 return (
  marker?.pin === SCC_PIN &&
  marker.asset === currentSccAsset(platform, arch) &&
  fs.existsSync(sccBinPath(agentDir, platform))
 );
}

// ─── Tar.gz mínimo (ustar + GNU LongName; gzip aporta el CRC) ────────────

function readString(buf: Buffer, off: number, len: number): string {
 const nul = buf.indexOf(0, off);
 const end = nul === -1 || nul > off + len ? off + len : nul;
 return buf.toString("utf-8", off, end);
}

function readOctal(buf: Buffer, off: number, len: number): number {
 const s = readString(buf, off, len).replace(/[\s\0]/g, "");
 return s ? parseInt(s, 8) : 0;
}

/**
 * Descomprime un tar.gz (ustar/GNU) en destDir y devuelve los archivos
 * escritos. Protegido contra tar-slip (nombres absolutos o con ..). No
 * valida checksums de header: gzip ya garantiza la integridad del stream
 * completo (mismo razonamiento que unzipSync sobre el CRC del zip).
 * Exportada para tests directos.
 */
export function extractTarGz(tarGz: Buffer, destDir: string): string[] {
 const tar = zlib.gunzipSync(tarGz);
 const written: string[] = [];
 fs.mkdirSync(destDir, { recursive: true });
 let off = 0;
 let longName: string | null = null;
 while (off + 512 <= tar.length) {
  const header = tar.subarray(off, off + 512);
  if (header.every((b) => b === 0)) break; // dos bloques de ceros = fin
  const name = readString(header, 0, 100);
  const size = readOctal(header, 124, 12);
  const typeflag = String.fromCharCode(header[156] || 0x30);
  const prefix = readString(header, 345, 155);
  const data = tar.subarray(off + 512, off + 512 + size);
  off += 512 + Math.ceil(size / 512) * 512;
  const fullName = longName ?? (prefix ? `${prefix}/${name}` : name);
  longName = null;
  if (typeflag === "L") {
   // GNU LongName: el data ES el nombre de la SIGUIENTE entrada.
   longName = data.toString("utf-8").replace(/\0+$/, "");
   continue;
  }
  if (typeflag === "x" || typeflag === "g") continue; // pax: ignorar
  if (typeflag === "5" || fullName.endsWith("/")) continue; // directorio
  // tar-slip: nombres absolutos o con .. → rechazar.
  const safe = path.normalize(fullName).replace(/^([/\\])+/, "");
  if (safe.startsWith("..") || path.isAbsolute(fullName)) {
   throw new Error(`tar: entrada insegura '${fullName}' (tar-slip)`);
  }
  const outPath = path.join(destDir, safe);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, data);
  written.push(safe);
 }
 return written;
}

// ─── Descarga https (copia del patrón https-only de frida-cc-plugins) ────

/** Descarga https con redirects solo-https y límite de tamaño. */
async function defaultFetchArchive(url: string): Promise<Buffer> {
 if (!/^https:\/\//.test(url)) {
  throw new Error(`scc: la url debe ser https://: ${url}`);
 }
 const { get } = await import("node:https");
 const chunks: Buffer[] = [];
 let total = 0;
 return new Promise<Buffer>((resolve, reject) => {
  get(url, { timeout: 120_000 }, (res) => {
   if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
    const loc = res.headers.location;
    if (
     loc &&
     res.statusCode >= 300 &&
     res.statusCode < 400 &&
     /^https:\/\//.test(new URL(loc, url).href)
    ) {
     defaultFetchArchive(new URL(loc, url).href).then(resolve, reject);
     return;
    }
    reject(new Error(`scc: HTTP ${res.statusCode} para ${url}`));
    return;
   }
   res.on("data", (c: Buffer) => {
    total += c.length;
    if (total > MAX_SCC_ASSET_BYTES) {
     reject(new Error(`scc: descarga supera ${MAX_SCC_ASSET_BYTES} bytes`));
     res.destroy();
     return;
    }
    chunks.push(c);
   });
   res.on("end", () => resolve(Buffer.concat(chunks)));
   res.on("error", reject);
  }).on("error", reject);
 });
}

// ─── ensureBinary ──────────────────────────────────────────────────────────

/** Deps inyectables para tests (sin red). digests override permite al test
 *  fijar el sha del asset FIXTURE (el real de SCC_DIGESTS no matchea un
 *  tarball sintético) — documentado como test seam. */
export interface SccInstallDeps {
 /** Impl real: GET https → Buffer (https-only + redirects https + límite). */
 fetchArchive?: (url: string) => Promise<Buffer>;
 /** Tabla asset→sha256 (default SCC_DIGESTS). */
 digests?: Readonly<Record<string, string>>;
}

export interface EnsureBinaryResult {
 alreadyInstalled: boolean;
 asset: string;
 sha256: string;
}

/** Guía manual equivalente (descarga + verificación + colocación). */
function manualGuide(asset: string | undefined): string {
 const url = asset
  ? sccAssetUrl(asset)
  : `${SCC_RELEASE_BASE}/<asset-de-tu-plataforma>`;
 return [
  `Descarga manual: ${url}`,
  `Verifica el sha256 contra ${SCC_RELEASE_BASE}/checksums.txt y coloca el binario en <agentDir>/bin/ (chmod +x en Unix).`,
  "O simplemente reintenta más tarde: la descarga se dispara sola al iniciar la sesión.",
 ].join("\n");
}

/** Localiza el ejecutable dentro del extraído (goreleaser lo deja en la
 *  raíz; tolera un dir de primer nivel). */
function findSccExecutable(
 dir: string,
 platform: NodeJS.Platform,
): string | undefined {
 const exe = platform === "win32" ? "scc.exe" : "scc";
 const root = path.join(dir, exe);
 if (fs.existsSync(root)) return root;
 try {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
   const nested = path.join(dir, entry.name, exe);
   if (fs.existsSync(nested)) return nested;
  }
 } catch {
  /* dir ausente */
 }
 return undefined;
}

/**
 * Garantiza scc@PIN en <agentDir>/bin con sha256 verificado. Idempotente por
 * isSccInstalledAtPin. Orden: sha ANTES de extraer (V7) → extraer a staging
 * → localizar binario → copiar + chmod → marker (nada a medias: si algo
 * falla, ni binario ni marker quedan).
 */
export async function ensureBinary(
 agentDir: string,
 opts: {
  deps?: SccInstallDeps;
  onProgress?: (line: string) => void;
  platform?: NodeJS.Platform;
  arch?: string;
 } = {},
): Promise<EnsureBinaryResult> {
 const platform = opts.platform ?? process.platform;
 const arch = opts.arch ?? process.arch;
 if (isSccInstalledAtPin(agentDir, platform, arch)) {
  const marker = readSccMarker(agentDir)!;
  return { alreadyInstalled: true, asset: marker.asset, sha256: marker.sha256 };
 }
 const asset = currentSccAsset(platform, arch);
 if (!asset) {
  throw new SccInstallError(
   `scc v${SCC_PIN} no distribuye binario para ${platform}-${arch}.`,
   manualGuide(undefined),
  );
 }
 const digests = opts.deps?.digests ?? SCC_DIGESTS;
 const expected = digests[asset];
 if (!expected) {
  throw new SccInstallError(
   `frida-size-app: sin digest para ${asset} — bump incompleto (edita JUNTOS SCC_PIN + SCC_ASSETS + SCC_DIGESTS).`,
   manualGuide(asset),
  );
 }
 const fetchFn = opts.deps?.fetchArchive ?? defaultFetchArchive;
 opts.onProgress?.(`Descargando scc v${SCC_PIN} (${asset}, ~7 MB)…`);
 let buf: Buffer;
 try {
  buf = await fetchFn(sccAssetUrl(asset));
 } catch (e: any) {
  throw new SccInstallError(
   `descarga de scc v${SCC_PIN} falló: ${e?.message ?? e}`,
   manualGuide(asset),
  );
 }
 const actual = crypto.createHash("sha256").update(buf).digest("hex");
 if (actual !== expected.toLowerCase()) {
  throw new SccInstallError(
   `scc: integridad sha256 no coincide para ${asset} (esperado ${expected.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…)`,
   manualGuide(asset),
  );
 }
 const staging = path.join(agentDir, "bin", ".scc-staging");
 fs.rmSync(staging, { recursive: true, force: true });
 const binPath = sccBinPath(agentDir, platform);
 try {
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  if (isTarAsset(asset)) extractTarGz(buf, staging);
  else unzipSync(buf, staging);
  const exe = findSccExecutable(staging, platform);
  if (!exe) {
   throw new SccInstallError(
    `no se encontró el ejecutable scc dentro de ${asset} (¿asset corrupto o estructura inesperada del release?).`,
    manualGuide(asset),
   );
  }
  fs.copyFileSync(exe, binPath);
  if (platform !== "win32") fs.chmodSync(binPath, 0o755);
  fs.writeFileSync(
   sccMarkerPath(agentDir),
   JSON.stringify({ pin: SCC_PIN, asset, sha256: actual }, null, 2) + "\n",
  );
 } finally {
  fs.rmSync(staging, { recursive: true, force: true });
 }
 opts.onProgress?.(`scc v${SCC_PIN} instalado en ${binPath}`);
 return { alreadyInstalled: false, asset, sha256: actual };
}
