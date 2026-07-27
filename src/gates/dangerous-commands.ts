// Detección de comandos bash destructivos para el gate de aprobación.
//
// Alcance: DISUASIVO. Bloquea SIN preguntar los patrones claramente
// destructivos e irreversibles a nivel sistema/usuario (borrar raíz o home,
// fork bomb, formatear disco, escribir a dispositivo crudo). Es un subconjunto
// conservador y poco propenso a falsos positivos: NO incluimos `rm -rf *`
// (común y legítimo en dirs de build) ni `curl|bash` (subjetivo). Añadir más
// patrones es trivial desde la lista RULES de abajo.
//
// Matching deliberadamente simple (contains/regex sobre el comando normalizado),
// sin parsing del shell. Un comando encadenado (`foo && rm -rf /`) se pesca
// porque evaluamos el string entero, no solo el primer comando.

export interface CommandCheck {
  /** true si el comando es destructivo y debe bloquearse sin preguntar. */
  denied: boolean;
  /** Motivo legible para el modelo cuando denied=true. */
  reason?: string;
  /** Patrón que disparó el bloqueo (para auditoría). */
  pattern?: string;
}

/** Patrones configurables por el usuario (capas que se SUMAN a los defaults). */
export interface DangerousCommandOptions {
  /** Substrings adicionales que bloquean el comando (sensibles a mayúsculas). */
  extraSubstrings?: string[];
}

interface Rule {
  /** Identificador corto del patrón (para el log). */
  id: string;
  /** Regex aplicada sobre el comando normalizado (minúsculas, espacios colapsados). */
  test: RegExp;
  /** Qué peligro representa. */
  description: string;
}

// Ordenado de más específico a más genérico. La normalización colapsa
// secuencias de espacios, así `rm  -rf  /` pesca igual que `rm -rf /`.
const RULES: Rule[] = [
  {
    id: "rm-rf-root",
    // rm -rf /, rm -rf /*, con o sin sudo, con flags extra (-f, -r, --no-preserve-root).
    test: /\brm\s+(?:-[a-z]*r[a-z]*\s+(?:-[a-z]+\s+)*|(?:--no-preserve-root\s+)*)?(?:-[a-z]*\s+)*\/\s*\*?$/,
    description: "borrar recursivamente desde la raíz del sistema de archivos",
  },
  {
    id: "rm-rf-home",
    // rm -rf ~ / rm -rf $HOME / rm -rf "$HOME"  (flags en cualquier caso: -r/-R/-rf/-fr)
    // El lookahead impide matchear ~/foo (borrar un subpath, no el home entero).
    test: /\brm\s+(?:-[A-Za-z]*[rR][A-Za-z]*\s+(?:-[A-Za-z]+\s+)*)?(?:~|~\/|\$HOME|"\$HOME"|'\$HOME')(?![^\s;&|])/,
    description: "borrar recursivamente el directorio home del usuario",
  },
  {
    id: "fork-bomb",
    // :(){ :|:& };:  y variantes con espacios.
    test: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    description: "ejecutar una fork bomb (denegación de servicio)",
  },
  {
    id: "mkfs",
    // mkfs, mkfs.ext4, mkfs -t xfs /dev/...
    test: /\bmkfs(?:\.\w+)?\b/,
    description: "formatear un sistema de archivos (destruye el contenido del dispositivo)",
  },
  {
    id: "dd-to-device",
    // dd if=... of=/dev/sdX  |  of=/dev/nvme  |  of=/dev/disk
    test: /\bdd\b.*\bof=\/dev\/(?:sd|nvme|disk|hd|vd)/,
    description: "escribir directamente a un dispositivo de bloque (disco crudo)",
  },
  {
    id: "truncate-device",
    // Redirección a dispositivo de bloque: > /dev/sda , echo x > /dev/nvme0n1 , >> /dev/disk
    test: />\s*\/dev\/(?:sd|nvme|disk|hd|vd)/,
    description: "truncar o sobrescribir un dispositivo de bloque",
  },
  {
    id: "chmod-777-root",
    // chmod -R 777 /  (permisos abiertos recursivos desde raíz; -R en mayúsculas)
    test: /\bchmod\s+(?:-[A-Za-z]*[rR][A-Za-z]*\s+)*777\s+\/\s*$/,
    description: "abrir permisos (777) recursivamente desde la raíz",
  },
];

/**
 * Decide si un comando bash es destructivo y debe bloquearse sin preguntar.
 *
 * Normaliza el comando (colapsa espacios, sin alterar mayúsculas porque $HOME y
 * rutas son sensibles a eso — salvo que el shell sea case-insensitive, lo que
 * aquí no asumimos) y aplica cada regla. Devuelve el primer match.
 *
 * @param raw comando tal como viene en event.input.command (puede ser undefined).
 * @param opts patrones configurables por el usuario (substrings extra).
 */
export function isDangerousBash(
  raw: string | undefined | null,
  opts: DangerousCommandOptions = {},
): CommandCheck {
  if (!raw || typeof raw !== "string") return { denied: false };

  const command = raw.trim();
  if (!command) return { denied: false };

  // Colapsa secuencias de espacios/tabs para que `rm  -rf  /` sea igual a `rm -rf /`.
  const norm = command.replace(/\s+/g, " ");

  // 0) Substrings configurables por el usuario (capa extra; sensible a mayúsculas,
  //    sobre el comando normalizado). Se comprueba primero para que el usuario
  //    pueda añadir bloqueos sin pelear con las regex de arriba.
  if (opts.extraSubstrings) {
    for (const sub of opts.extraSubstrings) {
      if (sub && sub.length > 0 && norm.includes(sub)) {
        return {
          denied: true,
          pattern: "user-substring",
          reason: motivoUsuario(sub),
        };
      }
    }
  }

  for (const rule of RULES) {
    if (rule.test.test(norm)) {
      return {
        denied: true,
        pattern: rule.id,
        reason: motivo(rule.description),
      };
    }
  }

  return { denied: false };
}

/** Mensaje disuasivo (no engañoso) para el modelo cuando se bloquea un comando. */
function motivo(que: string): string {
  return (
    `Este comando es destructivo (${que}) y se bloqueó por seguridad sin pedir ` +
    "confirmación. Si de verdad necesitas ejecutar algo así, explícaselo al " +
    "usuario en tu respuesta y deja que lo corra él mismo fuera del agente."
  );
}

/** Mensaje para un bloqueo por substring configurado por el usuario. */
function motivoUsuario(sub: string): string {
  return (
    `Este comando contiene \`${sub}\`, marcado como peligroso por tu configuración ` +
    "(`frida.gates.dangerousCommandSubstrings`), y se bloqueó. Si es un falso " +
    "positivo, ajusta ese setting o pídele al usuario que lo ejecute fuera del agente."
  );
}
