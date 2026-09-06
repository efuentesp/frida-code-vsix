// Detección de comandos bash destructivos para el gate de aprobación.
//
// Alcance: DISUASIVO. Bloquea SIN preguntar los patrones claramente
// destructivos e irreversibles a nivel sistema/usuario (borrar raíz o home,
// fork bomb, formatear disco, escribir a dispositivo crudo). Es un subconjunto
// conservador y poco propenso a falsos positivos: NO incluimos `rm -rf *`
// (común y legítimo en dirs de build) ni `curl|bash` (subjetivo). Añadir más
// patrones es trivial desde la lista RULES de abajo.
//
// Capas (#196, paridad deny-dangerous de davidondrej/skills):
//  0) extraSubstrings del usuario (literal, sobre el comando normalizado).
//  1) extraPatterns del usuario: regex POSIX-ERE (p. ej. del denylist
//     compartido multi-agente ~/.agents/hooks/dangerous-patterns.txt) con
//     conversión de clases POSIX, flag `m` y FAIL-OPEN por patrón: una regex
//     inválida se SALTA, nunca rompe el gate (el wrapper tool_call sigue
//     fail-closed). Se evalúan sobre el comando CRUDO multilínea, con la misma
//     semántica de `grep -E` (anclas ^ por línea).
//  2) RULES hardcodeadas (sobre el comando normalizado).
//
// Matching deliberadamente simple (contains/regex sobre el comando),
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
  /**
   * Regex POSIX-ERE adicionales que bloquean el comando (una por entrada).
   * Se convierten las clases POSIX comunes (`[[:space:]]` → `\s`, …) y se
   * compilan con flag `m` sobre el comando CRUDO. Un patrón inválido se SALTA
   * (fail-open por patrón): NO debe romper el gate. Origen típico: el setting
   * `frida.gates.dangerousCommandPatterns` o el denylist compartido
   * `~/.agents/hooks/dangerous-patterns.txt` (multi-agente, ver #196).
   */
  extraPatterns?: string[];
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
    description:
      "formatear un sistema de archivos (destruye el contenido del dispositivo)",
  },
  {
    id: "dd-to-device",
    // dd if=... of=/dev/sdX  |  of=/dev/nvme  |  of=/dev/disk
    test: /\bdd\b.*\bof=\/dev\/(?:sd|nvme|disk|hd|vd)/,
    description:
      "escribir directamente a un dispositivo de bloque (disco crudo)",
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
  // --- #196: patrones adoptados del guard multi-agente de davidondrej/skills
  // (grupos 3, 2b, 9 y 10): irreversibles o exfiltración de credenciales.
  {
    id: "sudo-rm",
    // sudo rm …  (cualquier rm con privilegios de admin; el prefijo de comando
    // se ancla a posición de comando para no pescar `echo sudo rm`)
    test: /(?:^|[;&|])\s*sudo\s+(?:-[a-zA-Z]+\s+)*rm(?:\s|$)/,
    description: "ejecutar rm con privilegios de administrador (sudo rm)",
  },
  {
    id: "diskutil-destructive",
    // diskutil eraseDisk|partitionDisk|zeroDisk|secureErase|apfs delete|erase…
    test: /(?:^|[;&|])\s*diskutil\s+(?:erase\w*|partitionDisk|zeroDisk|secureErase|apfs\s+(?:delete|erase)\w*)/,
    description: "borrar, particionar o limpiar un disco con diskutil",
  },
  {
    id: "gh-repo-delete",
    // gh repo delete …  (irreversible: borra el repo remoto)
    test: /(?:^|[;&|])\s*gh\s+repo\s+delete(?:\s|$)/,
    description: "eliminar un repositorio de GitHub (irreversible)",
  },
  {
    id: "gh-auth-token",
    // gh auth token  (imprime el token: exfiltración a logs/sesión)
    test: /(?:^|[;&|])\s*gh\s+auth\s+token(?:\s|$)/,
    description: "imprimir el token de GitHub CLI (exfiltración de credencial)",
  },
  {
    id: "git-reflog-destroy",
    // git reflog expire --expire=now | git gc --prune=now|all
    // (destruye la red de seguridad del historial local)
    test: /(?:^|[;&|])\s*git\s+(?:reflog\s+expire[^;&|]*--expire(?:-unreachable)?(?:=|\s+)(?:now|all)|gc[^;&|]*--prune(?:=|\s+)(?:now|all))/,
    description:
      "destruir el reflog / poda total (historial local irrecuperable)",
  },
  {
    id: "password-manager-cli",
    // CLIs distintivos de gestores de contraseñas: bloqueo directo.
    test: /(?:^|[;&|])\s*(?:bw|bws|lpass|keepassxc-cli|rbw|nordpass)(?:\s|$)/,
    description: "usar el CLI de un gestor de contraseñas",
  },
  {
    id: "pass-cli",
    // pass <cualquier argumento> en posición de comando. `pass` a secas o como
    // substring de otra palabra (passwd) NO matchea. Paridad grupo 10 upstream.
    test: /(?:^|[;&|])\s*pass\s+\S/,
    description: "usar el CLI `pass` (gestor de contraseñas)",
  },
  {
    id: "op-cli",
    // op con sus subcomandos reales (read/run/inject/…). `op` a secas NO
    // matchea (palabra común). Paridad grupo 10 upstream.
    test: /(?:^|[;&|])\s*op\s+(?:read|run|inject|item|document|vault|connect|service-account|events-api|signin)(?:\s|$)/,
    description: "usar el CLI `op` de 1Password",
  },
  {
    id: "keychain-dump",
    // security find-generic-password | find-internet-password | dump-keychain
    test: /(?:^|[;&|])\s*security\s+(?:-[a-zA-Z]+\s+)*(?:find-generic-password|find-internet-password|dump-keychain)(?:\s|$)/,
    description: "volcar credenciales del keychain de macOS",
  },
  {
    id: "gpg-export-secret-keys",
    // gpg --export-secret-keys / --export-secret-subkeys (a stdout o archivo)
    test: /--export-secret-(?:sub)?keys?(?:\s|=|$)/,
    description: "exportar llaves privadas GPG",
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

  // 0b) Regex POSIX-ERE configurables (#196): sobre el comando CRUDO con flag
  //     `m` (anclas ^ por línea, semántica grep -E). Fail-open por patrón: una
  //     regex inválida se salta — un archivo de patrones roto NO puede tumbar
  //     todas las llamadas bash (el wrapper tool_call sigue fail-closed).
  if (opts.extraPatterns) {
    for (const rawPattern of opts.extraPatterns) {
      if (!rawPattern) continue;
      let re: RegExp;
      try {
        re = new RegExp(ereToJs(rawPattern), "m");
      } catch {
        continue; // patrón inválido → ignorar, seguir con el resto
      }
      if (re.test(command)) {
        return {
          denied: true,
          pattern: "user-pattern",
          reason: motivoPatron(rawPattern),
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

/** Mensaje para un bloqueo por regex ERE configurable (#196). */
function motivoPatron(pattern: string): string {
  return (
    `Este comando coincide con el patrón \`${pattern}\`, marcado como peligroso ` +
    "por tu configuración (`frida.gates.dangerousCommandPatterns` o el denylist " +
    "compartido `frida.gates.dangerousCommandDenylistPath`), y se bloqueó. No lo " +
    "reintentes ni intentes esquivar el guard: explícale el bloqueo al usuario."
  );
}

/**
 * Traduce las clases de caracteres POSIX más comunes de un ERE a su
 * equivalente JS (paridad con los adapters de davidondrej/skills: el archivo
 * compartido está escrito para `grep -E`). Sólo las clases que aparecen en el
 * denylist upstream; POSIX completo no hace falta.
 */
export function ereToJs(pattern: string): string {
  return pattern
    .replace(/\[\[:space:\]\]/g, "\\s")
    .replace(/\[\[:alpha:\]\]/g, "[A-Za-z]")
    .replace(/\[\[:digit:\]\]/g, "\\d")
    .replace(/\[\[:alnum:\]\]/g, "[A-Za-z0-9]")
    .replace(/\[\[:upper:\]\]/g, "[A-Z]")
    .replace(/\[\[:lower:\]\]/g, "[a-z]");
}
