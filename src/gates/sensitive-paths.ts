// Detección de paths sensibles para el gate de aprobación (Prioridad 1).
//
// Alcance: DISUASIVO contra fuga accidental por egress (ADR-0001), no candado.
// Un desarrollador puede evadirlo a mano (curl, navegador…); lo que evitamos
// es que el modelo lea/suba por accidente un secreto al router. Por eso se
// bloquea con un reason claro que llega al modelo, sin prometer seguridad dura.
//
// El matching es deliberadamente simple y robusto (sin resolver a absoluto ni
// resolver symlinks): opera sobre el path crudo del input comparando basename y
// segmentos. Esto pesca las formas comunes (./.env, config/.env.local,
// ~/.ssh/config, ~/.gnupg/…) sin depender del cwd ni del SO.

/** Resultado de la verificación de un path. */
export interface PathCheck {
  /** true si el path coincide un patrón sensible y debe bloquearse. */
  denied: boolean;
  /** Motivo legible para el modelo cuando denied=true. Vacío si no. */
  reason?: string;
}

/** Patrones configurables por el usuario (capas que se SUMAN a los defaults). */
export interface SensitivePathOptions {
  /** Extensiones adicionales a bloquear (sin punto; se comparan en minúsculas). */
  extraExtensions?: string[];
  /** Basenames exactos adicionales a bloquear (en minúsculas al comparar). */
  extraBasenames?: string[];
  /** Basenames a PERMITIR (allowlist propia; se comprueban antes de bloquear). */
  extraAllow?: string[];
}

const ALLOW = new Set<string>([
  // Plantillas de entorno: no son secretos, son ejemplos versionados.
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.defaults",
]);

// Extensiones/basenames de material criptográfico y secretos.
const SENSITIVE_BASENAMES = new Set<string>([
  ".env",
  // Claves privadas SSH por defecto.
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  "id_dsa",
  // Otros formatos de clave/credencial.
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".htpasswd",
]);

// Extensiones de clave/certificado PEM y derivados.
const SENSITIVE_EXTENSIONS = new Set<string>([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".keystore",
  ".jks",
]);

// Segmentos de directorio sensibles: el path los contiene (como segmento entre
// separadores) → bloquear. Cubre ~/.ssh, ~/.gnupg y .aws, en cualquier forma.
const SENSITIVE_SEGMENTS = new Set<string>([
  ".ssh",
  ".gnupg",
  ".aws",
  ".docker",
]);

// Archivo concreto del git que puede guardar credenciales (helpers store/basic).
const GIT_CONFIG_BASENAME = ".gitconfig";

/**
 * Decide si un path del input de un tool es sensible y debe bloquearse.
 *
 * Opera sobre el path crudo (relativo, absoluto o con ~) sin resolver: compara
 * el basename (extensión y nombre exacto) y los segmentos de directorio. Las
 * plantillas allowlist (.env.example y similares) se permiten explícitamente
 * antes que el resto de reglas.
 *
 * @param raw path tal como viene en event.input.path (puede ser undefined).
 * @param opts patrones configurables por el usuario (capas extra sobre los defaults).
 */
export function isSensitivePath(
  raw: string | undefined | null,
  opts: SensitivePathOptions = {},
): PathCheck {
  if (!raw || typeof raw !== "string") return { denied: false };

  const path = raw.trim();
  if (!path) return { denied: false };

  // Normalización mínima para comparar: separadores a '/' y minúsculas para el
  // basename/extensión (los secretos en mayúsculas son los mismos secretos).
  const norm = path.replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);

  // Allowlist (defaults + extra del usuario) se comprueba PRIMERO: una excepción
  // explícita anula cualquier bloqueo, igual que .env.example anula la familia .env.
  if (ALLOW.has(basename)) return { denied: false };
  if (opts.extraAllow) {
    for (const a of opts.extraAllow) {
      if (a && a.toLowerCase() === basename) return { denied: false };
    }
  }

  // 2) Basename exacto sensible (.env, id_rsa, .npmrc, …) + extras del usuario.
  if (SENSITIVE_BASENAMES.has(basename) || hasExtra(opts.extraBasenames, basename)) {
    return { denied: true, reason: motivo(`el archivo \`${basename}\``) };
  }

  // 3) Variante de .env con sufijo (.env.local, .env.production, …) que NO esté
  //    en el allowlist. Cubre la familia sin enumerarla.
  if (basename.startsWith(".env.") && basename.length > ".env.".length) {
    return { denied: true, reason: motivo(`un archivo de entorno (\`${basename}\`)`) };
  }

  // 4) Extensión de clave/certificado (defaults + extras del usuario).
  const dot = basename.lastIndexOf(".");
  if (dot > 0) {
    const ext = basename.slice(dot);
    if (SENSITIVE_EXTENSIONS.has(ext) || hasExtraExt(opts.extraExtensions, ext)) {
      return { denied: true, reason: motivo(`un archivo de clave/credencial (\`${basename}\`)`) };
    }
  }

  // 5) Clave SSH por prefijo (id_rsa, id_ed25519 con sufijo .pub se permite:
  //    la pública no es secreto).
  if (/^id_(rsa|ecdsa|ed25519|dsa)$/.test(basename) || /^id_(rsa|ecdsa|ed25519|dsa)_/.test(basename)) {
    return { denied: true, reason: motivo("una clave privada SSH") };
  }

  // 6) Segmento de directorio sensible (~/.ssh, ~/.gnupg, .aws, …).
  const segments = lower.split("/").filter((s) => s.length > 0);
  for (const seg of SENSITIVE_SEGMENTS) {
    if (segments.includes(seg)) {
      return { denied: true, reason: motivo(`un directorio sensible (\`~/${seg}/\`)`) };
    }
  }

  // 7) .gitconfig (credenciales de helpers store/basic).
  if (basename === GIT_CONFIG_BASENAME) {
    return { denied: true, reason: motivo("la configuración global de git (posibles credenciales)") };
  }

  // Caso .git/config explícito (repo local con credenciales).
  if (segments.includes(".git") && basename === "config") {
    return { denied: true, reason: motivo("la configuración de git del repo (posibles credenciales)") };
  }

  return { denied: false };
}

/** Mensaje disuasivo (no engañoso) para el modelo cuando se bloquea un path. */
function motivo(que: string): string {
  return (
    `${que} coincide con un patrón sensible (secretos/credenciales) y se bloqueó ` +
    "para evitar su exposición. Si de verdad necesitas acceder a este archivo, " +
    "pídeselo explícitamente al usuario en tu respuesta en vez de intentar leerlo."
  );
}

/** ¿Coincide el basename con alguno de los extras del usuario? (case-insensitive) */
function hasExtra(extras: string[] | undefined, basename: string): boolean {
  if (!extras) return false;
  for (const e of extras) {
    if (e && e.toLowerCase() === basename) return true;
  }
  return false;
}

/** ¿Coincide la extensión (con punto) con alguno de los extras del usuario? */
function hasExtraExt(extras: string[] | undefined, ext: string): boolean {
  if (!extras) return false;
  for (const e of extras) {
    const norm = e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`;
    if (norm === ext) return true;
  }
  return false;
}
