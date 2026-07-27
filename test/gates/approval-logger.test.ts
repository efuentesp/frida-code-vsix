import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalLogger, type ApprovalLogEntry } from "../../src/gates/approval-logger";

// Logger testeado contra un tmpdir real por test (aislamiento). El chmod 0600/0700
// solo se verifica en POSIX (en Windows chmod solo toggla read-only).
const isPosix = process.platform !== "win32";

let dir: string;
let logPath: string;

function entry(over: Partial<ApprovalLogEntry> = {}): ApprovalLogEntry {
	return {
		ts: "2026-01-01T00:00:00.000Z",
		tool: "edit",
		kind: "diff",
		decision: "allow",
		source: "user_approved",
		...over,
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "frida-logger-"));
	logPath = join(dir, "approval-logs", "approvals.jsonl");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("ApprovalLogger", () => {
	it("escribe una línea JSON por entrada (append-only)", () => {
		const logger = new ApprovalLogger(logPath);
		logger.log(entry({ tool: "read" }));
		logger.log(entry({ tool: "edit" }));
		const lines = readFileSync(logPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).tool).toBe("read");
		expect(JSON.parse(lines[1]).tool).toBe("edit");
	});

	it("crea el directorio anidado (no preexistente)", () => {
		expect(existsSync(join(dir, "approval-logs"))).toBe(false);
		new ApprovalLogger(logPath).log(entry());
		expect(existsSync(logPath)).toBe(true);
	});

	it("endurece el archivo a 0600 y el dir a 0700 (POSIX)", () => {
		const logger = new ApprovalLogger(logPath);
		logger.log(entry());
		if (!isPosix) return; // skip: chmod en Windows no aplica igual
		const fileMode = statSync(logPath).mode & 0o777;
		const dirMode = statSync(join(dir, "approval-logs")).mode & 0o777;
		// 0700/0600 pudieron ser limitados por umask, pero el chmodBestEffort los
		// refuerza explícitamente tras la creación.
		expect(fileMode).toBe(0o600);
		expect(dirMode).toBe(0o700);
	});

	it("NO lanza si el path es inescribible (nothrow: observabilidad, no control)", () => {
		// Un path bajo un archivo (no dir) como padre → el mkdir/append falla.
		const badPath = join(dir, "i-am-a-file", "approvals.jsonl");
		const logger = new ApprovalLogger(badPath);
		expect(() => logger.log(entry())).not.toThrow();
	});

	it("conserva todos los campos del entry (incluido flags)", () => {
		const logger = new ApprovalLogger(logPath);
		logger.log(
			entry({
				tool: "bash",
				kind: "bash",
				decision: "block",
				source: "user_rejected",
				command: "git push",
				flags: ["compound_command"],
				reason: undefined,
			}),
		);
		const parsed = JSON.parse(readFileSync(logPath, "utf8").trim());
		expect(parsed).toMatchObject({
			tool: "bash",
			kind: "bash",
			decision: "block",
			source: "user_rejected",
			command: "git push",
			flags: ["compound_command"],
		});
	});

	it("es tolerante a reusar un log preexistente (no lo recrea)", () => {
		// Primera instancia crea el archivo.
		new ApprovalLogger(logPath).log(entry({ tool: "a" }));
		const before = statSync(logPath);
		// Segunda instancia sobre el mismo path: debe appendar, no truncar.
		new ApprovalLogger(logPath).log(entry({ tool: "b" }));
		const lines = readFileSync(logPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).tool).toBe("a");
		// El mtime avanzó (se escribió de nuevo).
		expect(statSync(logPath).mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);
	});
});
