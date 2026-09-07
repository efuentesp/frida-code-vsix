// frida-shunt (#202): factory del gate de lecturas costosas.
//
// Extensión embebida mínima: un solo handler `tool_call` que consulta
// src/gates/expensive-reads.ts y bloquea con la escalera de delegación.
//
// Convivencia en el bus tool_call (verificado contra el runner del SDK,
// emitToolCall: los handlers corren en orden de registro y el primer block
// cortocircuita):
//   1. frida-permission-system (candado: seguridad SIEMPRE primero)
//   2. frida-shunt (router de costo)
// Así un `rm -rf /` nunca recibe un redirect pedagógico: lo bloquea el
// candado. Y una lectura grande legítima de seguridad pasa el candado y
// sólo entonces se redirige.
//
// FAIL-OPEN: cualquier error del gate se traga — un router de costo jamás
// debe romper el tool (a diferencia del candado, que es fail-closed).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateExpensiveRead } from "../../gates/expensive-reads";

export interface ShuntGateDeps {
	/** Setting frida.shunt.enabled (vivo). */
	isEnabled: () => boolean;
	/** Setting frida.shunt.minLines (vivo). */
	getMinLines: () => number;
	/** CWD del workspace (resuelve paths relativos del input). */
	getCwd: () => string;
	/** Diagnóstico (canal Frida Abort, prefijo [shunt]). */
	diag?: (msg: string) => void;
}

export function createShuntGate(deps: ShuntGateDeps) {
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event: any) => {
			// Early-out barato: disabled o tool sin interés (ni read ni bash).
			if (!deps.isEnabled()) return;
			const tool = String(event?.toolName ?? "");
			if (tool !== "read" && tool !== "bash") return;
			try {
				const redirect = evaluateExpensiveRead(tool, event?.input, {
					enabled: true,
					minLines: deps.getMinLines(),
					cwd: deps.getCwd(),
				});
				if (redirect) {
					deps.diag?.(
						`[shunt] redirect ${redirect.detail} → escalera (pi-lens / subagent smol / offset-limit)`,
					);
					return { block: true as const, reason: redirect.reason };
				}
			} catch {
				/* fail-open: router de costo, no candado */
			}
			return;
		});
	};
}
