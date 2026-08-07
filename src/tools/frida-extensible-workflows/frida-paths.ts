// frida-extensible-workflows — rutas propias de Frida (ADR-0010).
//
// Pi usa agentDir ~/.pi/agent; Frida usa ~/.frida (desacoplado, ADR-0010).
// Este módulo centraliza el agentDir de Frida para que el núcleo vendorizado
// y los adaptadores (Fase 2+) apunten a ~/.frida en vez de ~/.pi.
//
// NOTA: pi-session.ts ya define defaultAgentDir() → ~/.frida. Para el núcleo
// headless (sin importar el extension host) replicamos la misma lógica aquí;
// los adaptadores de Fase 2 reusarán el defaultAgentDir() de pi-session.ts
// cuando estén dentro del extension host.

import { join } from "node:path";
import { homedir } from "node:os";

/** agentDir propio de Frida: ~/.frida (ADR-0010). */
export function fridaDefaultAgentDir(home: string = homedir()): string {
	return join(home, ".frida");
}

/**
 * Sobrescribe HOME para que persistence.ts (que usa homedir() por defecto)
 * escriba bajo el árbol de Frida. Los tests pasan un home temporal; en
 producción el extension host pasa el real (→ ~/.frida).
 */
export function fridaHome(home?: string): string {
	return home ?? homedir();
}
