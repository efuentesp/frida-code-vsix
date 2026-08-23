/**
 * Smoke E2E del port frida-agent-browser contra el binario REAL.
 *
 * Gated: sólo corre con FRIDA_AB_SMOKE_E2E=1 para que `npm test` no lance
 * navegadores. Verifica el riesgo de drift binario: compilar argv → spawn
 * real → parsear el envelope --json con las capas del port (exactamente lo
 * que haría el tool en producción).
 *
 * Ejecutar (el filtro evita escribir el path con el nombre del binario):
 *   FRIDA_AB_SMOKE_E2E=1 npx vitest run smoke.e2e
 *
 * Tras un bump del binario global (npm i -g agent-browser@X), correr este
 * smoke ANTES de cualquier otra cosa: si falla el parseo, el contrato del
 * binario divergió del port (ver baseline.ts / upstream-pi.json).
 */
import { describe, it, expect } from "vitest";
import { resolveAgentBrowserInput } from "../../src/tools/frida-agent-browser/compile";
import {
	parseAgentBrowserOutput,
	runAgentBrowser,
} from "../../src/tools/frida-agent-browser/run";
import { checkBinaryBaseline } from "../../src/tools/frida-agent-browser/baseline";

const RUN = process.env.FRIDA_AB_SMOKE_E2E === "1";

/** Compila (args mode) → corre binario real → parsea con la capa del port. */
async function runReal(args: string[], timeoutMs = 30_000) {
	const resolved = resolveAgentBrowserInput({ args });
	if ("error" in resolved) throw new Error(resolved.error);
	const finalArgs = [...resolved.args, "--json"];
	const run = await runAgentBrowser({
		args: finalArgs,
		cwd: process.cwd(),
		timeoutMs,
	});
	return {
		run,
		result: parseAgentBrowserOutput({
			stdout: run.stdout,
			stderr: run.stderr,
			exitCode: run.exitCode,
			mode: resolved.mode,
			args: resolved.args,
			cwd: process.cwd(),
		}),
	};
}

describe.skipIf(!RUN)("smoke e2e: binario real + capas del port", () => {
	it("open about:blank → snapshot -i se compilan, corren y PARSEAN correctamente", async () => {
		// 1) Baseline informativo: ¿qué versión corre y cuánto diverge?
		const baseline = await checkBinaryBaseline({ force: true });
		console.log(
			`[smoke] binario=${baseline.version ?? "?"} contrato=${baseline.contract} drift=${baseline.drift}`,
		);

		// 2) open
		const open = await runReal(["open", "about:blank"], 60_000);
		expect(open.run.exitCode).toBe(0);
		expect(open.result.isError).toBeFalsy();
		expect(open.run.stdout.trim()).not.toBe("");

		// 3) snapshot interactivo (el path crítico del port: @refs)
		const snap = await runReal(["snapshot", "-i"]);
		expect(snap.run.exitCode).toBe(0);
		expect(snap.result.isError).toBeFalsy();
		expect(snap.result.content[0]?.type).toBe("text");
		const d = snap.result.details as { command?: string };
		expect(d.command).toBe("snapshot");

		console.log("[smoke] snapshot OK — envelope parseado por el port");
	}, 120_000);

	it("close limpia la sesión upstream", async () => {
		const close = await runReal(["close"]);
		// close puede devolver 0 o ya-stderr si no había sesión; no debe CROsar el parseo.
		expect(typeof close.run.exitCode).toBe("number");
		expect(close.result.content.length).toBeGreaterThan(0);
	}, 30_000);
});
