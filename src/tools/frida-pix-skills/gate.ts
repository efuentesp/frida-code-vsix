// frida-pix-skills — Política de bloqueo de directivas (mapeo a frida gates).
//
// Reemplaza la dependencia de @xynogen/pix-gate del upstream por el gate
// DISUASIVO de Frida (src/gates/dangerous-commands.ts). Misma filosofía que
// pix-skills: las directivas `` !`cmd` `` de las skills se gatean SIN diálogo,
// auto-denegando cualquier comando peligroso. Aquí "peligroso" = lo que el gate
// de Frida ya considera destructivo (rm -rf /, mkfs, dd a dispositivo, fork
// bomb, etc.) + los metacaracteres de shell (encadenamiento/expansión).
//
// Diferencia intencional vs pix-skills: el upstream respeta las reglas extra
// del usuario desde ~/.pi/agent/pix.json (buildRules(loadUserConfig())). Frida
// guarda esos patrones en el setting `frida.gates.dangerousCommandSubstrings`,
// que lee el HOST (no está disponible en el runtime del tool de pi). Para
// mantener el tool autónomo y simple, aquí se gatea con las REGLAS POR DEFECTO
// del gate de Frida. Las directivas típicas (git status, git diff) nunca las
// disparan; el subconjunto destructivo real sí queda cubierto.

import { isDangerousBash } from "../../gates/dangerous-commands";
import { findCommandDirectives, hasShellMeta } from "./directive";

/**
 * Clasifica un comando de directiva contra la política de seguridad.
 * Devuelve un `reason` cuando el comando es INSEGURO, o null cuando es seguro.
 */
export function directiveBlockReason(command: string): string | null {
	if (hasShellMeta(command)) {
		return "shell metacharacters not allowed in skill commands";
	}
	const check = isDangerousBash(command);
	if (check.denied) {
		// El reason de frida ya es un mensaje disuasivo apropiado para el modelo.
		return check.reason ?? "blocked by Frida safety gate";
	}
	return null;
}

export interface UnsafeDirective {
	command: string;
	reason: string;
}

/** Devuelve cada directiva insegura hallada en el contenido de una skill. */
export function scanUnsafeDirectives(content: string): UnsafeDirective[] {
	const unsafe: UnsafeDirective[] = [];
	for (const d of findCommandDirectives(content)) {
		const reason = directiveBlockReason(d.command);
		if (reason) unsafe.push({ command: d.command, reason });
	}
	return unsafe;
}
