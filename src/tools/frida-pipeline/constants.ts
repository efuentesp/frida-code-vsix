// frida-pipeline — constantes de namespace (coexistencia con rpiv-pi).
//
// Todos los customType y flags usan prefijo `frida-*` (no `rpiv-*`) para que,
// si un usuario carga AMBOS paquetes en la misma sesión Pi, los mensajes
// ocultos no colisionen (ADR-0021 §Coexistencia). Espejo exacto de
// rpiv-core/constants.ts, sólo cambiando el prefijo.

/** Flag de debug (espejo de `rpiv-debug`). Cuando está activo, los mensajes
 *  ocultos de guidance/git-context se muestran en el transcript (display:true). */
export const FLAG_DEBUG = "frida-debug";

/** customType del bloque de git context (branch + commit + user). */
export const MSG_TYPE_GIT_CONTEXT = "frida-git-context";

/** customType del bloque de guidance (AGENTS.md / CLAUDE.md / architecture.md). */
export const MSG_TYPE_GUIDANCE = "frida-guidance";

/** customType del pipeline pointer (índice de skills para session_start).
 *  Fase 4 lo usará; se define aquí para que el namespace quede completo. */
export const MSG_TYPE_PIPELINE_INDEX = "frida-pipeline-index";

/** Timeout para las llamadas a `git` vía pi.exec (milisegundos). Si git tarda
 *  más (repo enorme, disco lento), el contexto de git se omite silenciosamente. */
export const GIT_EXEC_TIMEOUT_MS = 5000;

/** Directorio raíz de Frida (no `.rpiv/`). Namespace de artefactos y guidance. */
export const FRIDA_DIR = ".frida";

/** Subdirectorio de guidance dentro de `.frida/`. */
export const GUIDANCE_SUBDIR = "guidance";

/** Subdirectorio de artefactos dentro de `.frida/`. */
export const ARTIFACTS_SUBDIR = "artifacts";

/** Nombre del archivo de arquitectura en cada nivel de guidance. */
export const ARCHITECTURE_MD = "architecture.md";
