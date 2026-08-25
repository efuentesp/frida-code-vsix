// frida-app-walkthrough — integración end-to-end del patrón sobre el motor
// real (runWorkflowInStore + RunStore). Issue #133, M8 Pista M.
//
// Doble mock (molde test/frida-tea/e2e.test.ts):
//   1. Binario `agent-browser` falsificado en el PATH del tmpdir: app demo
//      determinista de 5 pantallas con estado en disco (transiciones por
//      click, formularios que reescriben la query, validación que deja
//      mensaje de error). Envelopes {success, data} como el binario real.
//   2. Spawner mock por anclas (bloques runtime del script generado):
//      intérprete (## Snapshot actual), escritores (## Tu documento) y
//      juez (## Entregables a auditar). Los escritores ESCRIBEN archivos
//      reales (#83: el mentiroso no pasa; mocks honestos, lesson bffd6f1).
//
// Cobertura (D5): dedup por origin, corte por maxScreens, gates `test -s`,
// inventario determinista — más cortes time (D6, con `date` falsificado),
// gate de sesión viva (D12) y evidencia de validación (D11).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	existsSync,
	chmodSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { resolveCheckpoint } from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { APP_WALKTHROUGH_PATTERN } from "../../src/tools/frida-app-walkthrough";

const REAL_HOME = process.env.HOME;
const REAL_PATH = process.env.PATH;

/** App demo del mock: 5 pantallas bajo esta base. */
const BASE = "https://app.ejemplo.com";

let home: string;
let cwd: string;
let binDir: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "walk-e2e-home-"));
	cwd = mkdtempSync(join(tmpdir(), "walk-e2e-cwd-"));
	binDir = join(cwd, ".mock-bin");
	writeBrowserMock();
	process.env.HOME = home;
	// El sandbox hereda el env del proceso (execution.ts: spawn con
	// env: { ...process.env }): el mock gana al binario real en PATH.
	process.env.PATH = binDir + ":" + REAL_PATH;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	if (REAL_PATH) process.env.PATH = REAL_PATH;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

/**
	* Binario mock de agent-browser: app demo determinista de 5 pantallas con
	* estado en disco (cada comando del sandbox es un proceso nuevo). Tour
	* cableado: inicio → productos (form agrega ?q=) → producto/1 → productos →
	* carrito → perfil (validación con error). El estado vive en <bin>/state.
	*/
const BROWSER_MOCK = `#!/usr/bin/env bash
# mock agent-browser (e2e frida-app-walkthrough) — envelopes como el real.
DIR="$(cd "$(dirname "$0")" && pwd)"
STATE="$DIR/state"
mkdir -p "$STATE"

# Modo sesión muerta (gate D12): todo comando falla.
if [ -f "$STATE/dead" ]; then
		printf '{"success":false,"error":{"message":"session not found"}}\\n'
		exit 1
fi

shift 2 # --session <nombre>
cmd="$1"
shift   # el resto ignora el --json final

path() { printf '%s' "$1" | sed 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*##; s/[?#].*$//'; }
cur() { if [ -f "$STATE/current" ]; then cat "$STATE/current"; else printf '%s' 'https://app.ejemplo.com/inicio'; fi }
setcur() { printf '%s' "$1" > "$STATE/current"; }

title_for() {
		case "$(path "$1")" in
				/inicio) printf 'Inicio' ;;
				/productos) printf 'Productos' ;;
				/producto/1) printf 'Producto Detalle' ;;
				/carrito) printf 'Carrito' ;;
				/perfil) printf 'Perfil' ;;
				*) printf 'Pantalla' ;;
		esac
}

body_for() {
		case "$(path "$1")" in
				/inicio) printf 'Menu [ref=e1] Productos [ref=e2] Carrito [ref=e3] Perfil' ;;
				/productos) printf 'Buscador [ref=e4] Buscar [ref=e5] Detalle [ref=e1] Pagina2 [ref=e6]' ;;
				/producto/1) printf 'Volver [ref=e1] AgregarAlCarrito [ref=e2]' ;;
				/carrito) printf 'Seguir [ref=e1] FinalizarCompra [ref=e2]' ;;
				/perfil) printf 'Nombre [ref=e3] Guardar [ref=e4] ERROR El nombre es obligatorio' ;;
				*) printf '(vacia)' ;;
		esac
}

next_for() {
		case "$(path "$1") $2" in
				"/inicio @e1") printf 'https://app.ejemplo.com/productos' ;;
				"/inicio @e2") printf 'https://app.ejemplo.com/carrito' ;;
				"/inicio @e3") printf 'https://app.ejemplo.com/perfil' ;;
				"/productos @e1") printf 'https://app.ejemplo.com/producto/1' ;;
				"/productos @e5") printf 'https://app.ejemplo.com/productos?q=laptop' ;;
				"/productos @e6") printf 'https://app.ejemplo.com/productos?page=2' ;;
				"/producto/1 @e1") printf 'https://app.ejemplo.com/productos' ;;
				"/carrito @e1") printf 'https://app.ejemplo.com/productos' ;;
				*) printf '%s' "$1" ;;
		esac
}

case "$cmd" in
		open)
				setcur "$1"
				printf '{"success":true}\\n'
				;;
		get)
				if [ "$1" = "url" ]; then
						printf '{"success":true,"data":"%s"}\\n' "$(cur)"
				else
						printf '{"success":true,"data":"%s"}\\n' "$(title_for "$(cur)")"
				fi
				;;
		snapshot)
				printf '{"success":true,"data":{"url":"%s","body":"%s","refs":[{"ref":"e1","role":"link"}]}}\\n' "$(cur)" "$(body_for "$(cur)")"
				;;
		click)
				setcur "$(next_for "$(cur)" "$1")"
				printf '{"success":true}\\n'
				;;
		fill)
				printf '{"success":true}\\n'
				;;
		wait)
				printf '{"success":true}\\n'
				;;
		screenshot)
				printf 'png-mock-e2e' > "$1"
				printf '{"success":true}\\n'
				;;
		*)
				printf '{"success":false,"error":{"message":"comando no soportado: %s"}}\\n' "$cmd"
				exit 1
				;;
esac
`;

/** date falsificado (D6): cada llamada a epoch avanza +30 s (contador). */
const FAKE_DATE_MOCK = `#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
case "$*" in
		*%Y*)
				printf '2026-08-24 12:00:00 +0000\\n'
				;;
		*)
				n=0
				if [ -f "$D/date.n" ]; then n=$(cat "$D/date.n"); fi
				n=$((n + 1))
				printf '%s' "$n" > "$D/date.n"
				printf '%s\\n' $((1750000000 + n * 30))
				;;
esac
`;

function writeBrowserMock(): void {
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "agent-browser"), BROWSER_MOCK, "utf-8");
	chmodSync(join(binDir, "agent-browser"), 0o755);
}

function writeFakeDate(): void {
	writeFileSync(join(binDir, "date"), FAKE_DATE_MOCK, "utf-8");
	chmodSync(join(binDir, "date"), 0o755);
}

/** Escribe un artefacto en el cwd de la corrida (contrato #83: los mocks
	* escriben archivos reales como los agentes con file tools). */
function writeArtifact(base: string, rel: string, content = "# doc\n"): void {
	const p = join(base, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, content, "utf-8");
}

interface SpawnOptions {
	/** Escritor que NUNCA escribe (claim sin archivo, incluso al reintentar). */
	liarDoc?: string;
	/** Escritor que solo escribe en el reintento (ancla FALLA ANTERIOR). */
	flakyDoc?: string;
	/** Decisión del juez mock. */
	judgeDecision?: "PASS" | "CONCERNS" | "FAIL";
}

/**
	* Spawner mock por anclas de runtime context (molde tea e2e). El intérprete
	* decide por canon de pantalla (mismo criterio de dedup que el script); los
	* escritores escriben archivos reales; el juez responde según opts.
	*/
const makeSpawn = (
	opts: SpawnOptions = {},
	seen: string[] = [],
	artifactsCwd: string = cwd,
) =>
	(async (prompt: string) => {
		seen.push(prompt);
		// Intérprete del explore — ancla: bloque "## Snapshot actual".
		if (prompt.includes("## Snapshot actual")) {
			const origin = prompt.match(/origin: (\S+)/)?.[1] ?? "";
			const canon = origin.split("#")[0].split("?")[0];
			const isNew = prompt.includes("NUEVA — registrada");
			const interp = (nextAction: unknown, purpose: string) => ({
				purpose,
				userRoles: ["usuario autenticado"],
				mainElements: ["menu"],
				nextAction,
			});
			if (canon === BASE + "/inicio") {
				return interp({ kind: "click", ref: "@e1", description: "ir a productos" }, "Portada");
			}
			if (canon === BASE + "/productos") {
				if (isNew) {
					return interp({ kind: "form", ref: "@e5", fields: [{ selector: "@e4", value: "laptop" }], description: "buscar laptop" }, "Listado");
				}
				if (prompt.includes("P03")) {
					return interp({ kind: "goto", url: BASE + "/carrito", description: "ir a carrito" }, "Listado");
				}
				return interp({ kind: "click", ref: "@e1", description: "abrir detalle" }, "Listado");
			}
			if (canon === BASE + "/producto/1") {
				return interp({ kind: "click", ref: "@e1", description: "volver al listado" }, "Detalle");
			}
			if (canon === BASE + "/carrito") {
				return interp({ kind: "goto", url: BASE + "/perfil", description: "ir a perfil" }, "Carrito");
			}
			if (canon === BASE + "/perfil") {
				return isNew
					? interp({ kind: "validate", ref: "@e4", fields: [{ selector: "@e3", value: "" }], description: "submit invalido" }, "Perfil")
					: interp({ kind: "done", description: "app cubierta" }, "Perfil");
			}
			return interp({ kind: "done", description: "(default)" }, "?");
		}
		// Escritor del analyze — ancla: bloque "## Tu documento".
		if (prompt.includes("## Tu documento")) {
			const file = prompt.match(/Ruta EXACTA donde escribirlo: (\S+)/)?.[1] ?? "";
			const isRetry = prompt.includes("FALLA ANTERIOR");
			if (opts.liarDoc && file === opts.liarDoc) {
				return { doc: file, sections: ["claim"], summary: "claim sin archivo" };
			}
			if (opts.flakyDoc && file === opts.flakyDoc && !isRetry) {
				return { doc: file, sections: ["falla"], summary: "primera pasada vacia" };
			}
			writeArtifact(artifactsCwd, file, "# " + file + "\n\nEscrito por el escritor mock.\n");
			return { doc: file, sections: ["resumen"], summary: file + " escrito" };
		}
		// Juez — ancla: bloque "## Entregables a auditar".
		if (prompt.includes("## Entregables a auditar")) {
			return { decision: opts.judgeDecision ?? "PASS", findings: [], summary: "auditoria mock" };
		}
		return "echo: " + prompt.slice(0, 40);
	}) as unknown as SpawnAgentFn;

interface InventoryScreen {
	id: string;
	canon: string;
	title: string;
	screenshot: string;
	validationEvidence: string[];
}

interface Inventory {
	run: { url: string; maxScreens: number; maxMinutes: number };
	screens: InventoryScreen[];
	actionLog: Array<{ step: number; screenId: string; kind: string; outcome: string }>;
	stoppedBy: string;
	stoppedByTime: boolean;
}

const DOC = "docs/funcional";

function readInv(base: string): Inventory {
	return JSON.parse(
		readFileSync(join(base, DOC, "/artifacts/inventory.json"), "utf-8"),
	) as Inventory;
}

function docPath(base: string, rel: string): string {
	return join(base, DOC, rel);
}

describe("frida-app-walkthrough · e2e sobre el motor (#133)", () => {
	it("recorrido feliz: 5 pantallas en 8 pasos, 5 kinds, dedup, entregables en disco", async () => {
		const args = { url: BASE + "/inicio", maxScreens: 0, review: "auto" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-1",
			spawnAgent: makeSpawn(),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as {
			screens: number;
			steps: number;
			stoppedBy: string;
			stoppedByTime: boolean;
			judge: { decision: string };
			docs: Record<string, string>;
		};
		expect(r.screens).toBe(5);
		expect(r.steps).toBe(8);
		expect(r.stoppedBy).toBe("done");
		expect(r.stoppedByTime).toBe(false);
		expect(r.judge.decision).toBe("PASS");
		expect(r.docs.inventory).toContain("inventory.json");

		// Entregables en disco: 4 del fanout + README + dashboard + inventario.
		for (const rel of [
			"README.md",
			"index.html",
			"catalogo-pantallas.md",
			"journeys.md",
			"reglas-negocio.md",
			"roles-permisos.md",
			"artifacts/inventory.json",
		]) {
			expect(existsSync(docPath(cwd, rel)), rel).toBe(true);
		}

		const inv = readInv(cwd);
		expect(inv.screens.map((s) => s.id)).toEqual(["P01", "P02", "P03", "P04", "P05"]);
		expect(inv.run.url).toBe(BASE + "/inicio");
		// DEDUP por origin canonico: /productos se visita en los pasos 2, 3 y 5
		// (con ?q= tras el form) y queda registrado UNA sola vez.
		expect(inv.screens.filter((s) => s.canon === BASE + "/productos")).toHaveLength(1);
		expect(inv.actionLog.filter((a) => a.screenId === "P02")).toHaveLength(3);
		// Los 5 kinds de nextAction ejercidos; todos con outcome ok.
		expect([...new Set(inv.actionLog.map((a) => a.kind))].sort()).toEqual([
			"click",
			"done",
			"form",
			"goto",
			"validate",
		]);
		expect(inv.actionLog.every((a) => a.outcome === "ok")).toBe(true);
		// D11: validacion con valores invalidos → snapshot post-error citado.
		expect(inv.screens[4].validationEvidence).toHaveLength(1);

		const stepsDir = readdirSync(join(cwd, DOC, "artifacts/steps"));
		expect(stepsDir.filter((f) => f.endsWith("-snapshot.json"))).toHaveLength(8);
		expect(stepsDir.filter((f) => f.endsWith("-validation.json"))).toHaveLength(1);

		// Screenshots reales por pantalla (mock honesto, lesson bffd6f1).
		const shots = readdirSync(join(cwd, DOC, "screenshots"));
		expect(shots).toHaveLength(5);
		expect(shots).toContain("P01-inicio.png");
		for (const shot of shots) {
			expect(statSync(join(cwd, DOC, "screenshots", shot)).size).toBeGreaterThan(0);
		}

		// README e index.html sintetizados desde el MISMO inventario (D9).
		const readme = readFileSync(docPath(cwd, "README.md"), "utf-8");
		expect(readme).toContain("# Documentación funcional");
		expect(readme).toContain("| P05 |");
		expect(readme).toContain("screenshots/P01-inicio.png");
		const html = readFileSync(docPath(cwd, "index.html"), "utf-8");
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain("var DATA = ");
		expect(html).toContain("P05");
	}, 45000);

	it("corta por presupuesto (maxScreens=2) y el checkpoint final aprueba", async () => {
		const args = { url: BASE + "/inicio", maxScreens: 2, review: "manual" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-2",
			spawnAgent: makeSpawn({ judgeDecision: "CONCERNS" }),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await waitUntil(() => checkpoints.length >= 1);
		expect(checkpoints[0].name).toBe("walkthrough-final");
		resolveCheckpoint(runId, "walkthrough-final", true);

		const { result } = await promise;
		const r = result as {
			screens: number;
			stoppedBy: string;
			stoppedByTime: boolean;
			judge: { decision: string };
		};
		expect(r.screens).toBe(2);
		expect(r.stoppedBy).toBe("budget");
		expect(r.stoppedByTime).toBe(false);
		expect(r.judge.decision).toBe("CONCERNS");

		const inv = readInv(cwd);
		expect(inv.run.maxScreens).toBe(2);
		expect(inv.screens.map((s) => s.id)).toEqual(["P01", "P02"]);
		// Los escritores corren igual tras el corte: documentan lo alcanzado.
		expect(existsSync(docPath(cwd, "journeys.md"))).toBe(true);
	}, 30000);

	it("corta por wall-clock (maxMinutes=1) marcando stoppedByTime (D6)", async () => {
		writeFakeDate(); // +30 s por llamada a epoch: vence en el paso 2
		const args = { url: BASE + "/inicio", maxScreens: 0, maxMinutes: 1, review: "auto" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-3",
			spawnAgent: makeSpawn(),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as { screens: number; steps: number; stoppedBy: string; stoppedByTime: boolean };
		expect(r.stoppedBy).toBe("time");
		expect(r.stoppedByTime).toBe(true);
		expect(r.screens).toBe(1);
		expect(r.steps).toBe(2);
		// El corte por tiempo NO aborta: writers/synthesis/juez siguen.
		expect(existsSync(docPath(cwd, "README.md"))).toBe(true);
		const inv = readInv(cwd);
		expect(inv.stoppedByTime).toBe(true);
	}, 30000);

	it("escritor mentiroso: gate test -s falla el run tras el reintento (#83 redux)", async () => {
		const args = { url: BASE + "/inicio", maxScreens: 2, review: "auto" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-4",
			spawnAgent: makeSpawn({ liarDoc: DOC + "/journeys.md" }, seen),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		await expect(promise).rejects.toThrow(/NO escribieron/);
		// El reintento informado corrio UNA vez antes de fallar (lesson 619d9e7).
		expect(seen.some((p) => p.includes("FALLA ANTERIOR") && p.includes("journeys.md"))).toBe(true);
		expect(existsSync(docPath(cwd, "journeys.md"))).toBe(false);
	}, 30000);

	it("escritor flaky: el reintento informado rescata la corrida", async () => {
		const args = { url: BASE + "/inicio", maxScreens: 2, review: "auto" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-5",
			spawnAgent: makeSpawn({ flakyDoc: DOC + "/journeys.md" }),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		expect(existsSync(docPath(cwd, "journeys.md"))).toBe(true);
		const r = result as { judge: { decision: string } };
		expect(r.judge.decision).toBe("PASS");
	}, 30000);

	it("gate de sesión muerta: el bootstrap falla con la receta (D12)", async () => {
		mkdirSync(join(binDir, "state"), { recursive: true });
		writeFileSync(join(binDir, "state", "dead"), "1", "utf-8");
		const args = { url: BASE + "/inicio", maxScreens: 2, review: "auto" };
		const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd });

		const promise = runWorkflowInStore({
			name: "app-walkthrough",
			script,
			args,
			cwd,
			sessionId: "sess-walk-6",
			spawnAgent: makeSpawn(),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		await expect(promise).rejects.toThrow(/no está viva/);
	}, 30000);

	it("inventario determinista: dos corridas idénticas → screens deep-equal (D10)", async () => {
		const runOnce = async () => {
			const runCwd = mkdtempSync(join(tmpdir(), "walk-e2e-det-"));
			const args = { url: BASE + "/inicio", maxScreens: 0, review: "auto" };
			const script = APP_WALKTHROUGH_PATTERN.resolve(args, { cwd: runCwd });
			await runWorkflowInStore({
				name: "app-walkthrough",
				script,
				args,
				cwd: runCwd,
				sessionId: "sess-walk-7",
				spawnAgent: makeSpawn({}, [], runCwd),
				home,
				runId: randomUUID(),
				foreground: false,
			});
			const inv = readInv(runCwd);
			rmSync(runCwd, { recursive: true, force: true });
			return inv;
		};
		const first = await runOnce();
		const second = await runOnce();
		expect(second.screens).toEqual(first.screens);
		expect(second.actionLog.map((a) => a.kind)).toEqual(first.actionLog.map((a) => a.kind));
	}, 45000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows (molde tea). */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((res) => setTimeout(res, 20));
	}
}
