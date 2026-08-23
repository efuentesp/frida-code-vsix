/**
 * frida-agent-browser — sesión implícita gestionada (porte nativo).
 *
 * Réplica simplificada del sistema de sesión gestionada del referencia
 * (lib/runtime.js + extension entrypoint): se mantiene un nombre de sesión
 * derivado de (cwd + seed) y se reutiliza entre llamadas prefijando
 * `--session <name>`. El binario upstream `agent-browser` mantiene vivo el
 * navegador bajo esa clave entre invocaciones CLI, así que reusar el nombre
 * = no relanzar el browser en cada tool call (eficiencia + estado).
 *
 * `sessionMode: "fresh"` (o la presencia de flags launch-scoped sin sesión
 * explícita) eleva el ordinal → nuevo nombre → lanzamiento fresco donde los
 * flags launch-scoped aplican.
 */

import { createHash } from "node:crypto";
import { AGENT_BROWSER_BINARY, LAUNCH_SCOPED_FLAGS } from "./constants";
import { findCommandStartIndex, isBooleanFlagEnabled } from "./argv-grammar";
import { guardRefMutation, type GuardState } from "./ref-guard";

/** Flags que, de aparecer, hacen que el prefijo de sesión se omita (sesión explícita). */
const EXPLICIT_SESSION_FLAGS = ["--session", "--session-name"];

/** ¿Trae args una sesión explícita (--session/--session-name)? */
export function hasExplicitSession(args: string[]): boolean {
	return args.some((a) => EXPLICIT_SESSION_FLAGS.includes(a));
}

/**
 * ¿Trae args flags launch-scoped (que requieren lanzamiento fresco)?
 *
 * Mirror de hasLaunchScopedFlagToken del referencia (contrato 0.34.0), con
 * sus matices:
 *  - `wait --state <predicado>`: `--state` tras el comando `wait` es un
 *    predicado de espera (visible/hidden/…), NO estado de launch → no cuenta.
 *  - `--auto-connect` sólo cuenta cuando el booleano está habilitado
 *    (last-wins; `--auto-connect false` no attacha nada → no es launch-scoped).
 *  - Formas `--flag=valor` cuentan (p. ej. `--profile=X`).
 *  - `--pin-tab`/`--no-pin-tab` NO están en LAUNCH_SCOPED_FLAGS: son booleanos
 *    globales sticky que pueden operar sobre una sesión viva.
 */
export function hasLaunchScopedFlag(args: string[]): boolean {
	const commandStart = findCommandStartIndex(args);
	const command = commandStart === undefined ? undefined : args[commandStart];
	return args.some((token, index) => {
		const isHit = LAUNCH_SCOPED_FLAGS.some(
			(flag) => token === flag || token.startsWith(`${flag}=`),
		);
		if (!isHit) return false;
		if (token === "--auto-connect" || token.startsWith("--auto-connect=")) {
			return isBooleanFlagEnabled(args, "--auto-connect");
		}
		if (
			token === "--state" &&
			command === "wait" &&
			commandStart !== undefined &&
			index > commandStart
		) {
			return false;
		}
		return true;
	});
}

function shortHash(input: string): string {
	return createHash("sha1").update(input).digest("hex").slice(0, 8);
}

/**
 * Sesión implícita reutilizable por sesión de Frida.
 * No es thread-safe por diseño: el tool agent_browser se serializa a nivel del
 * ExtensionRunner de Pi (un tool call a la vez por sesión).
 */
export class ManagedSession {
	private baseName: string;
	private ordinal = 0;
	readonly cwd: string;

	constructor(
		cwd: string,
		seed = shortHash(`${cwd}|${Date.now()}|${Math.random()}`),
	) {
		this.cwd = cwd;
		this.baseName = `frida-${shortHash(seed)}`;
	}

	/** Nombre de sesión upstream vigente. */
	get name(): string {
		return this.ordinal === 0
			? this.baseName
			: `${this.baseName}-${this.ordinal}`;
	}

	/**
	 * Calcula el prefijo a ANTEPONER a args (`["--session", name]`) según el modo.
	 * Devuelve [] cuando hay sesión explícita o cuando no conviene prefijar.
	 * `requestedFresh` fuerza un bump (lanzar browser nuevo).
	 */
	prefixFor(args: string[], requestedFresh: boolean): string[] {
		if (hasExplicitSession(args)) return [];
		const launchScoped = hasLaunchScopedFlag(args);
		if (requestedFresh || (launchScoped && this.ordinal > 0)) {
			this.ordinal += 1;
		}
		// Si hay flags launch-scoped en la 1a llamada (ordinal 0), aún así prefijamos:
		// el binario aplica los flags a esta sesión nueva. El bump real ocurrirá en la
		// siguiente llamada si los flags difieren.
		return ["--session", this.name];
	}

	/** ¿Está activa (se ha usado al menos una vez)? */
	get active(): boolean {
		return this.ordinal >= 0 && this.used;
	}
	private used = false;
	markUsed(): void {
		this.used = true;
	}

	// ── Fase 2: refSnapshot + stale-ref guard ──
	private refSnapshot: { origin: string; refs: Set<string> } | null = null;
	private refsStale = false;

	/** Puebla el refSnapshot desde un snapshot exitoso (origin + keys de data.refs). */
	updateRefsFromSnapshot(origin: string, refs: string[]): void {
		this.refSnapshot = {
			origin,
			refs: new Set(refs.map((r) => r.replace(/^@/, ""))),
		};
		this.refsStale = false;
	}

	/** Marca los refs como stale (navegación/drift desde el último snapshot). */
	invalidateRefs(): void {
		this.refsStale = true;
	}

	/** Limpia todo el estado de refs (tras close/quit/exit). */
	clearRefs(): void {
		this.refSnapshot = null;
		this.refsStale = false;
	}

	/** Origin del último snapshot (para comparación de drift), o undefined. */
	get snapshotOrigin(): string | undefined {
		return this.refSnapshot?.origin;
	}

	/** Si el origin actual difiere del del snapshot → invalida (drift post-navegación). */
	invalidateIfOriginChanged(origin: string | undefined): void {
		if (origin && this.refSnapshot && origin !== this.refSnapshot.origin) {
			this.refsStale = true;
		}
	}

	/** Snapshot interno para el guard (exposición limitada al propio módulo). */
	private guardState(): GuardState {
		return { refSnapshot: this.refSnapshot, stale: this.refsStale };
	}

	/** Evalúa el stale-ref guard para un argv de mutación con @ref. */
	guardRefMutation(args: string[]) {
		return guardRefMutation(this.guardState(), args);
	}

	/** Mejor esfuerzo: cerrar la sesión upstream (spawn del binario; puede faltar). */
	async close(): Promise<void> {
		const name = this.name;
		this.used = false;
		try {
			const { spawn } = await import("node:child_process");
			await new Promise<void>((resolve) => {
				const child = spawn(AGENT_BROWSER_BINARY, ["--session", name, "close"], {
					cwd: this.cwd,
					stdio: ["ignore", "ignore", "ignore"],
					windowsHide: true,
				});
				child.on("error", () => resolve()); // binario ausente → nada que cerrar
				child.on("close", () => resolve());
				setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {
						/* noop */
					}
					resolve();
				}, 4000);
			});
		} catch {
			/* noop */
		}
	}
}
