/**
 * frida-git-sync constants.
 *
 * Porte nativo de `@jachy/pi-git-sync` (ADR-0010, ADR-0026). Los paths usan el
 * agentDir propio de frida (`~/.frida`) en vez de `~/.pi/agent`.
 */
import { join } from "node:path";
import { homedir } from "node:os";

/** Directorio raíz del agente de frida (~/.frida). */
export const FRIDA_AGENT_DIR = join(homedir(), ".frida");

/** Clon local por defecto del repo de configuración sincronizada. */
export const FRIDA_CONFIG_REPO = join(FRIDA_AGENT_DIR, "config-repo");

/**
 * Directorio de estado local de la sincronización (baseline, lock, backups,
 * package-trust). Se ubica dentro del agentDir, igual que en el upstream.
 */
export const FRIDA_SYNC_STATE_DIR = join(FRIDA_AGENT_DIR, ".pi-sync");

/** Prefijo de namespace para mensajes custom de frida-git-sync. */
export const MSG_TYPE_GIT_SYNC = "frida-git-sync";
