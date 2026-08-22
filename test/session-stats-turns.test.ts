import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { readSessionStats } from "../src/session-stats";

/**
 * #107 — Tiempo activo por turnos en session-stats.
 *
 * Reglas del parser:
 *  - Un turno abre con el mensaje user y cierra con la ÚLTIMA entrada antes
 *    del siguiente user msg (duracion = ts(cierre) − ts(apertura)).
 *  - Turno ABIERTO (user msg sin entradas posteriores): se ignora en
 *    activeMs (el timer en vivo del webview lo cubre), pero sí cuenta en
 *    turnCount si hubo al menos una entrada después del user msg.
 *  - Turno abortado: cuenta hasta su última entrada emitida (mismo caso que
 *    turno cerrado normal — no distinguimos abort).
 *  - Líneas malformadas se ignoran sin abortar el recuento.
 */

let dir: string | null = null;

function tmp(entries: unknown[]): string {
	dir = mkdtempSync(join(tmpdir(), "frida-stats-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(
		file,
		entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
		"utf8",
	);
	return file;
}

/** Entrada mínima de sesión con timestamp ISO. */
function e(
	timestamp: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return { timestamp, ...extra };
}

/** user msg de pi en disco. */
function user(timestamp: string): Record<string, unknown> {
	return e(timestamp, { type: "message", message: { role: "user" } });
}

/** assistant msg de pi en disco. */
function assistant(timestamp: string): Record<string, unknown> {
	return e(timestamp, {
		type: "message",
		message: { role: "assistant", usage: { input: 10, output: 5 } },
	});
}

afterEach(() => {
	if (dir) {
		rmSync(dir, { recursive: true, force: true });
		dir = null;
	}
});

describe("readSessionStats — turns/activeMs (#107)", () => {
	it("suma la duración de cada turno cerrado (user → última entrada asistente)", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:02:30Z"), // turno 1: 150s
			user("2026-08-22T11:00:00Z"), // gap de lectura de 55m NO cuenta
			assistant("2026-08-22T11:03:00Z"),
			assistant("2026-08-22T11:05:00Z"), // cierre = ÚLTIMA entrada: turno 2: 300s
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 2);
		assert.equal(s.activeMs, (150 + 300) * 1000);
		assert.deepEqual(
			s.turns.map((t) => t.endMs - t.startMs),
			[150_000, 300_000],
		);
	});

	it("ignora el turno abierto (user sin entradas posteriores) en activeMs", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:01:00Z"), // turno 1: 60s
			user("2026-08-22T10:30:00Z"), // turno 2 ABIERTO: no cuenta
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 1);
		assert.equal(s.activeMs, 60_000);
	});

	it("turno abortado cuenta hasta su última entrada emitida", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:01:30Z"),
			// (abort: no hubo más entradas — turno cerrado en 90s)
			user("2026-08-22T10:05:00Z"),
			assistant("2026-08-22T10:06:00Z"),
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 2);
		assert.equal(s.activeMs, (90 + 60) * 1000);
	});

	it("cuenta un turno aunque su cierre sea una entrada sin usage (p. ej. toolResult)", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:01:00Z"),
			e("2026-08-22T10:01:30Z", {
				type: "message",
				message: { role: "toolResult", content: "x" },
			}), // cierre real (actividad, sin usage)
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 1);
		assert.equal(s.activeMs, 90_000);
	});

	it("sesión sin user msgs no produce turnos", () => {
		const file = tmp([
			e("2026-08-22T10:00:00Z", { type: "compaction", usage: {} }),
			e("2026-08-22T10:00:30Z", { type: "notice" }),
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 0);
		assert.equal(s.activeMs, 0);
		assert.deepEqual(s.turns, []);
	});

	it("ignora líneas malformadas sin abortar el recuento de turnos", () => {
		dir = mkdtempSync(join(tmpdir(), "frida-stats-"));
		const file = join(dir, "session.jsonl");
		const lines = [
			JSON.stringify(user("2026-08-22T10:00:00Z")),
			"{{{ no json",
			JSON.stringify(assistant("2026-08-22T10:00:40Z")),
			"",
			JSON.stringify(user("2026-08-22T10:02:00Z")),
			JSON.stringify(assistant("2026-08-22T10:02:20Z")),
		];
		writeFileSync(file, lines.join("\n") + "\n", "utf8");
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 2);
		assert.equal(s.activeMs, (40 + 20) * 1000);
	});

	it("user msg sin timestamp abre turno con startMs 0 que se descarta al cerrar", () => {
		// Defensivo: user sin ts no puede medir duración; no debe romper el
		// recuento del resto ni producir duraciones negativas.
		const file = tmp([
			{ type: "message", message: { role: "user" } }, // sin timestamp
			assistant("2026-08-22T10:00:30Z"),
			user("2026-08-22T10:02:00Z"),
			assistant("2026-08-22T10:02:20Z"),
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 1);
		assert.equal(s.activeMs, 20_000);
	});

	it("REGRESIÓN #107: custom_message de sistema horas después NO infla el turno", () => {
		// Caso real (Personal, 2026-08-22): "hola" anoche, evento de sistema al
		// reactivar la ventana ~15h después, y turnos nuevos hoy. La entrada de
		// metadatos entre turnos no puede contar como cierre del turno previo.
		const file = tmp([
			user("2026-08-22T03:56:21.154Z"),
			e("2026-08-22T03:56:21.154Z", { type: "custom_message" }),
			assistant("2026-08-22T03:56:24.033Z"), // turno 1 real: 2.9s
			e("2026-08-22T18:54:10.149Z", { type: "custom_message" }), // ¡15h!
			user("2026-08-22T18:56:26.705Z"),
			e("2026-08-22T18:56:26.716Z", { type: "custom_message" }),
			e("2026-08-22T18:56:29.373Z", { type: "session_info" }),
			assistant("2026-08-22T18:56:34.120Z"), // turno 2: 7.4s
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 2);
		assert.equal(s.activeMs, 2_879 + 7_415); // 2.9s + 7.4s, NO ~15h
	});

	it("toolResult intermedio sí cuenta como cuerpo del turno", () => {
		const file = tmp([
			user("2026-08-22T18:57:16.377Z"),
			assistant("2026-08-22T18:57:18.371Z"),
			e("2026-08-22T18:57:25.750Z", {
				type: "message",
				message: { role: "toolResult", content: "adr" },
			}),
			assistant("2026-08-22T18:57:40.233Z"), // cierre: 23.9s
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 1);
		assert.equal(s.activeMs, 23_856);
	});

	it("compaction dentro del turno sí extiende su cierre", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:01:00Z"),
			e("2026-08-22T10:02:00Z", { type: "compaction", usage: {} }),
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.turnCount, 1);
		assert.equal(s.activeMs, 120_000); // hasta la compaction (actividad)
	});

	it("mantiene campos previos (firstTs/lastTs/totales) intactos", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:01:00Z"),
		]);
		const s = readSessionStats(file);
		assert.ok(s);
		assert.equal(s.firstTs, Date.parse("2026-08-22T10:00:00Z"));
		assert.equal(s.lastTs, Date.parse("2026-08-22T10:01:00Z"));
		assert.equal(s.inputTotal, 10);
		assert.equal(s.outputTotal, 5);
	});

	it("cachea por mtime: segunda lectura sin reparseo devuelve lo mismo", () => {
		const file = tmp([
			user("2026-08-22T10:00:00Z"),
			assistant("2026-08-22T10:00:10Z"),
		]);
		const a = readSessionStats(file);
		const b = readSessionStats(file);
		assert.deepEqual(a, b);
	});
});
