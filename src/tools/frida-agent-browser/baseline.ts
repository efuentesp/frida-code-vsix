/**
 * frida-agent-browser — chequeo de baseline del binario upstream (endurecimiento).
 *
 * Problema que ataca: el port replica el contrato de una versión concreta de
 * `agent-browser` (PORTED_BINARY_CONTRACT) pero consume el binario global desde
 * PATH sin pinearlo. Cuando el binario se actualiza (p. ej. 0.33.1 → 0.34.0),
 * el drift es silencioso: el tool puede parsear mal o comportarse raro sin
 * ningún aviso. Principio: el drift debe ser VISIBLE (fallar ruidosamente),
 * no bloqueante de entrada (el port nunca tuvo pin exacto).
 *
 * Diseño:
 *  - `agent-browser --version` es una inspección inofensiva (la permite hasta
 *    el bash-guard) y su salida es texto plano → un spawn barato.
 *  - El resultado se cachea por proceso: un solo spawn extra por sesión.
 *  - Clasificación de drift: match | patch | minor | major | unknown.
 *    - patch  → silencioso (el port nació con drift de patch; no es señal).
 *    - minor/major → notice visible en el content del resultado + details.baseline.
 *    - unknown (binario ausente / salida no parseable) → sin notice; el camino
 *      "missing-binary" ya reporta lo suyo.
 */

import { AGENT_BROWSER_BINARY, PORTED_BINARY_CONTRACT } from "./constants";
import { runAgentBrowser } from "./run";

export type BinaryDrift = "match" | "patch" | "minor" | "major" | "unknown";

export interface BaselineResult {
	binary: string;
	/** Versión reportada por `agent-browser --version` (primer x.y.z del stdout). */
	version?: string;
	/** Contrato del binario contra el que se porteó esta extensión. */
	contract: string;
	drift: BinaryDrift;
	/** Presente sólo cuando el drift es minor/major: texto para el agente. */
	notice?: string;
}

export interface LooseSemver {
	major: number;
	minor: number;
	patch: number;
}

/** Extrae el primer x.y.z del texto (tolera "0.34.0", "agent-browser 0.34.0\n", "v0.33.1"). */
export function parseLooseSemver(text: string): LooseSemver | undefined {
	const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
	if (!m) return undefined;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Clasifica cuánto diverge el binario real del contrato portado. */
export function classifyDrift(contract: string, actual: string): BinaryDrift {
	const c = parseLooseSemver(contract);
	const a = parseLooseSemver(actual);
	if (!c || !a) return "unknown";
	if (c.major !== a.major) return "major";
	if (c.minor !== a.minor) return "minor";
	if (c.patch !== a.patch) return "patch";
	return "match";
}

function buildNotice(version: string, drift: BinaryDrift): string {
	return `[agent-browser baseline] binary ${version} vs ported contract ${PORTED_BINARY_CONTRACT} (${drift} drift). Parsing/behavior may diverge: if results look wrong, sync the port with pi-agent-browser-native (see upstream-pi.json ledger; scripts/upstream-drift.mjs detects drift).`;
}

/** Cache por proceso: el chequeo es barato pero no gratis (un spawn). */
let cachedBaseline: BaselineResult | undefined;

/** Reinicia el cache (para tests). */
export function resetBaselineCache(): void {
	cachedBaseline = undefined;
}

/**
 * Corre `agent-browser --version` y clasifica el drift contra el contrato
 * portado. Inyecta `runFn` para tests (mismo seam que el resto del tool).
 * Nunca lanza: cualquier fallo del spawn → drift "unknown" sin notice.
 */
export async function checkBinaryBaseline(
	dep: { runFn?: typeof runAgentBrowser; force?: boolean } = {},
): Promise<BaselineResult> {
	if (cachedBaseline && !dep.force) return cachedBaseline;

	const doRun = dep.runFn ?? runAgentBrowser;
	let version: string | undefined;
	try {
		const run = await doRun({
			args: ["--version"],
			cwd: process.cwd(),
			timeoutMs: 5_000,
		});
		const parsed = parseLooseSemver(run.stdout);
		if (parsed) {
			version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
		}
	} catch {
		/* binario lento/roto → unknown sin notice */
	}

	const drift: BinaryDrift = version
		? classifyDrift(PORTED_BINARY_CONTRACT, version)
		: "unknown";
	const result: BaselineResult = {
		binary: AGENT_BROWSER_BINARY,
		version,
		contract: PORTED_BINARY_CONTRACT,
		drift,
		notice:
			version && (drift === "minor" || drift === "major")
				? buildNotice(version, drift)
				: undefined,
	};
	cachedBaseline = result;
	return result;
}
