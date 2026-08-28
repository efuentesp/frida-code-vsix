// frida-size-app — constantes del binario scc (issue #139, M10 Pista M).
//
// Primera dependencia binaria NO-npm del repo: scc (Go, MIT, 270+ lenguajes)
// se pinnea al agentDir (<agentDir>/bin/scc) con checksum sha256 verificado
// — la reproducibilidad del número (misma versión = mismos números entre
// máquinas) es el argumento de auditoría de la preventa. Espejo estructural
// de frida-codebase-index/constants.ts (#25): pin deliberado + tabla
// plataforma→asset EXPLÍCITA (los sufijos NO son derivables uniformemente —
// lección copiada de PLATFORM_NATIVE, que rompió win32-x64 con endsWith) +
// digests del checksums.txt del release.
//
// Bump deliberado de pin: editar JUNTOS SCC_PIN + SCC_ASSETS + SCC_DIGESTS,
// verificado contra el release real (disciplina "subir versión es
// deliberado", molde CODEBASE_INDEX_PIN en codebase-index/constants.ts:9).

import * as path from "node:path";

/** Pin EXACTO de scc (GitHub Releases de boyter/scc). v4.0.0 (2026-08-24)
 *  es la ÚNICA versión con --hotspots/--coupling/--by-author/--cognitive
 *  (las familias churn/coupling/autores del FRD no existen en v3.4.0). */
export const SCC_PIN = "4.0.0";

/** URL base de descarga del release pineado. */
export const SCC_RELEASE_BASE = `https://github.com/boyter/scc/releases/download/v${SCC_PIN}`;

/** Tabla explícita plataforma→asset con claves NODE (`${platform}-${arch}`,
 *  p. ej. "linux-ia32"): Node reporta `ia32` para x86 de 32 bits, pero el
 *  ASSET del release dice `_i386` (nomenclatura goreleaser, amd64→x86_64,
 *  SO con mayúscula inicial, SIN versión embebida) — la clave es Node, el
 *  valor es el nombre real del asset. Matrix completa del release v4.0.0. */
export const SCC_ASSETS: Readonly<Record<string, string>> = {
 "darwin-arm64": "scc_Darwin_arm64.tar.gz",
 "darwin-x64": "scc_Darwin_x86_64.tar.gz",
 "linux-arm64": "scc_Linux_arm64.tar.gz",
 "linux-x64": "scc_Linux_x86_64.tar.gz",
 "linux-ia32": "scc_Linux_i386.tar.gz",
 "win32-arm64": "scc_Windows_arm64.zip",
 "win32-ia32": "scc_Windows_i386.zip",
 "win32-x64": "scc_Windows_x86_64.zip",
};

/** sha256 por asset, del checksums.txt del release v4.0.0 (obtenido y
 *  verificado contra el release real en el design de M10; formato
 *  sha256sum). El par PIN+DIGESTS es el contrato de reproducibilidad. */
export const SCC_DIGESTS: Readonly<Record<string, string>> = {
 "scc_Darwin_arm64.tar.gz":
  "02cfdfcaf5baf7f6595746efdfcc6301fce89cfc6a5bf8b52ed78064937fd933",
 "scc_Darwin_x86_64.tar.gz":
  "8ee6d4ed42a89d9e5f71fe3e06a48d575050d264d48cbf33babbcac0a32d7ac5",
 "scc_Linux_arm64.tar.gz":
  "a73d5378017abb1d86da8c19a73ede2878c3f7369e9ea6987827cd710aa14657",
 "scc_Linux_i386.tar.gz":
  "f846ef3bd52ac452d5cad8632479282a82f2e6353f773c63f7816b01319fc78a",
 "scc_Linux_x86_64.tar.gz":
  "b8535fb0714dd33c5434c24de181e4d1a632e6a1f869e1985bbd10ad8b838545",
 "scc_Windows_arm64.zip":
  "c3508b4b77dc1dbdff46bcf3abb8ace40dd1a310cbe9cbaf8e72fc9a64b279fa",
 "scc_Windows_i386.zip":
  "09791bff87cc28f052c239aa68387b87ca6cfe8834589c3244aeb68668e20303",
 "scc_Windows_x86_64.zip":
  "bfd4f956f6c23917fee3a0ed0d950b80ee914fb4555effe9c6abbe0c30f1ec2f",
};

/** Asset de la plataforma indicada (default: la actual). undefined si no
 *  hay build (p. ej. linux-musl, freebsd) → el caller degrada con guía
 *  accionable (molde currentPlatformNative, codebase-index/constants.ts). */
export function currentSccAsset(
 platform: NodeJS.Platform = process.platform,
 arch: string = process.arch,
): string | undefined {
 return SCC_ASSETS[`${platform}-${arch}`];
}

/** URL de descarga del asset. */
export function sccAssetUrl(asset: string): string {
 return `${SCC_RELEASE_BASE}/${asset}`;
}

/** ¿El asset es tar.gz (Unix) o zip (win32)? Decide la vía de extracción. */
export function isTarAsset(asset: string): boolean {
 return asset.endsWith(".tar.gz");
}

/** Directorio bin del agentDir (<agentDir>/bin). */
export function sccBinDir(agentDir: string): string {
 return path.join(agentDir, "bin");
}

/** Ruta absoluta del binario scc pineado. En win32 el asset empaqueta
 *  scc.exe. El script del workflow lo invoca por ruta ABSOLUTA (SCC_BIN
 *  interpolada host-side) — jamás del PATH (reproducibilidad del pin). */
export function sccBinPath(
 agentDir: string,
 platform: NodeJS.Platform = process.platform,
): string {
 return path.join(
  sccBinDir(agentDir),
  platform === "win32" ? "scc.exe" : "scc",
 );
}

/** Marker de instalación (pin + asset + sha instalados). scc no tiene
 *  package.json — el marker ES la versión instalada (análogo funcional de
 *  installedVersion de codebase-index). */
export function sccMarkerPath(agentDir: string): string {
 return path.join(sccBinDir(agentDir), "scc.marker.json");
}

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const SIZE_APP_FACTORY_NAME = "frida-size-app";
