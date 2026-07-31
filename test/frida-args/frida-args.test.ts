// Tests de regresión de frida-args.
//
// Fijan los contratos heredados de @juicesharp/rpiv-args:
//   - parseCommandArgs / substituteArgs son byte-equivalentes a Pi.
//   - El wrapper <skill …> es byte-exacto vs parseSkillBlock de Pi.
//   - El emit-path diverge según hadTokens (Skill input: vs args crudos).
//   - Una skill sin tokens ni shell es un no-op (byte-idéntica a la expansión de Pi).
//   - El shell: bloques antes que inlines (mask-and-restore), orden secuencial,
//     errores inlineados, presupuesto de truncado.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import {
	type SkillIndexEntry,
	appendArgs,
	appendSkillInput,
	buildSkillBlock,
	executeShellInBody,
	handleInput,
	invalidateSkillIndex,
	parseCommandArgs,
	resolveShellTimeoutMs,
	substituteArgs,
	substituteVariables,
	SKILL_INPUT_LABEL,
} from "../../src/tools/frida-args";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(partial: Partial<SkillIndexEntry> = {}): SkillIndexEntry {
	return {
		name: partial.name ?? "demo",
		filePath: partial.filePath ?? "/p/demo/SKILL.md",
		baseDir: partial.baseDir ?? "/p/demo",
	};
}

/** Mock mínimo de ExtensionAPI para handleInput/executeShellInBody.
 *  - getCommands() expone una skill "demo" cuyo sourceInfo.path apunta a skillFile.
 *  - exec() enruta a execImpl(command) recibiendo el comando (args[1] del sh -c). */
function mockPi(
	skillFile: string,
	execImpl?: (command: string) => ExecResult,
): ExtensionAPI {
	return {
		getCommands: () => [
			{ source: "skill", name: "skill:demo", sourceInfo: { path: skillFile } },
		],
		exec: async (_cmd: string, args: string[]) =>
			execImpl
				? execImpl(args[1] ?? "")
				: { stdout: "", stderr: "", code: 0, killed: false },
	} as unknown as ExtensionAPI;
}

function mockCtx(sessionId = "sess-123"): ExtensionContext {
	return {
		sessionManager: { getSessionId: () => sessionId },
	} as unknown as ExtensionContext;
}

/** Estrecha InputEventResult a la rama 'transform' y devuelve su text.
 *  Necesario porque TS no hace narrow a través de expect(); sin esto, res.text
 *  no es accesible sobre la unión discriminada {continue|transform|handled}. */
function transformText(res: InputEventResult): string {
	if (res.action !== "transform") {
		throw new Error(`se esperaba action 'transform', llegó '${res.action}'`);
	}
	return res.text;
}

// ---------------------------------------------------------------------------
// parseCommandArgs — byte-equivalente a parseCommandArgs de Pi
// ---------------------------------------------------------------------------

describe("parseCommandArgs", () => {
	it("divide por espacios y colapsa runs de whitespace", () => {
		expect(parseCommandArgs("a b  c")).toEqual(["a", "b", "c"]);
	});

	it("divide por tabs también", () => {
		expect(parseCommandArgs("a\tb\tc")).toEqual(["a", "b", "c"]);
	});

	it("comillas dobles agrupan multi-palabra", () => {
		expect(parseCommandArgs('"staging server" --force')).toEqual([
			"staging server",
			"--force",
		]);
	});

	it("comillas simples agrupan multi-palabra", () => {
		expect(parseCommandArgs("'a b' c")).toEqual(["a b", "c"]);
	});

	it('comillas mixtas dentro de un token: "a b"c → "a bc"', () => {
		expect(parseCommandArgs('"a b"c')).toEqual(["a bc"]);
	});

	it("string vacío → []", () => {
		expect(parseCommandArgs("")).toEqual([]);
	});

	it("comilla sin cerrar flush lo acumulado (sin error)", () => {
		expect(parseCommandArgs('"unclosed word')).toEqual(["unclosed word"]);
	});
});

// ---------------------------------------------------------------------------
// substituteArgs — byte-equivalente a substituteArgs de Pi
// ---------------------------------------------------------------------------

describe("substituteArgs", () => {
	it("$1, $2 posicionales 1-indexed", () => {
		expect(substituteArgs("$1 $2", ["a", "b"])).toBe("a b");
	});

	it("out of range → cadena vacía, no '$3' literal", () => {
		expect(substituteArgs("$1 $2 $3", ["a"])).toBe("a  ");
	});

	it("$ARGUMENTS y $@ unen todo por espacio", () => {
		expect(substituteArgs("$ARGUMENTS|$@", ["a", "b", "c"])).toBe(
			"a b c|a b c",
		);
	});

	it("${@:N} desde N", () => {
		expect(substituteArgs("${@:2}", ["a", "b", "c", "d"])).toBe("b c d");
	});

	it("${@:N:L} L elementos desde N", () => {
		expect(substituteArgs("${@:2:2}", ["a", "b", "c", "d"])).toBe("b c");
	});

	it("${@:0} se clampea a 1 → toda la lista", () => {
		expect(substituteArgs("${@:0}", ["a", "b"])).toBe("a b");
	});

	it("slice que empieza pasado el fin → cadena vacía", () => {
		expect(substituteArgs("${@:5}", ["a", "b"])).toBe("");
	});

	it("dígitos greedys: $11 es el onceavo, no $1+'1'", () => {
		const eleven = Array.from({ length: 11 }, (_, i) => `${i + 1}`);
		expect(substituteArgs("$11", eleven)).toBe("11");
	});

	it("no recursivo: un valor con $1 que cae vía $ARGUMENTS no se re-expande", () => {
		// $1 = "X", $ARGUMENTS = "$1 Y". Como $N corre primero, $1→X, luego
		// $ARGUMENTS→"$1 Y" (literal, ya sustituido antes no se re-procesa).
		expect(substituteArgs("$ARGUMENTS", ["$1", "Y"])).toBe("$1 Y");
	});

	it("sin placeholders → contenido intacto", () => {
		expect(substituteArgs("hola mundo", ["a", "b"])).toBe("hola mundo");
	});
});

// ---------------------------------------------------------------------------
// substituteVariables
// ---------------------------------------------------------------------------

describe("substituteVariables", () => {
	it("${SKILL_DIR} y ${SESSION_ID} se reemplazan", () => {
		expect(
			substituteVariables("dir=${SKILL_DIR} s=${SESSION_ID}", {
				skillDir: "/p/demo",
				sessionId: "s1",
			}),
		).toBe("dir=/p/demo s=s1");
	});

	it("${FOO} desconocido se deja intacto", () => {
		expect(
			substituteVariables("x=${FOO}", { skillDir: "/d", sessionId: "s" }),
		).toBe("x=${FOO}");
	});
});

// ---------------------------------------------------------------------------
// resolveShellTimeoutMs
// ---------------------------------------------------------------------------

describe("resolveShellTimeoutMs", () => {
	it("ausente → default 120s", () => {
		expect(resolveShellTimeoutMs({})).toBe(120_000);
	});

	it("positivo → a milisegundos", () => {
		expect(resolveShellTimeoutMs({ "shell-timeout": 30 })).toBe(30_000);
		expect(resolveShellTimeoutMs({ "shell-timeout": 0.5 })).toBe(500);
	});

	it("0 → desactivación explícita", () => {
		expect(resolveShellTimeoutMs({ "shell-timeout": 0 })).toBe(0);
	});

	it("negativo → fallback a default", () => {
		expect(resolveShellTimeoutMs({ "shell-timeout": -5 })).toBe(120_000);
	});

	it("string → fallback a default", () => {
		expect(resolveShellTimeoutMs({ "shell-timeout": "30" })).toBe(120_000);
	});

	it("NaN (.nan) → fallback a default", () => {
		expect(resolveShellTimeoutMs({ "shell-timeout": Number.NaN })).toBe(
			120_000,
		);
	});

	it("Infinity (.inf) → fallback a default", () => {
		expect(
			resolveShellTimeoutMs({ "shell-timeout": Number.POSITIVE_INFINITY }),
		).toBe(120_000);
	});
});

// ---------------------------------------------------------------------------
// buildSkillBlock — byte-exacto vs parseSkillBlock de Pi
// ---------------------------------------------------------------------------

describe("buildSkillBlock", () => {
	it("produce el wrapper byte-exacto", () => {
		const e = entry({
			name: "deploy",
			filePath: "/p/deploy/SKILL.md",
			baseDir: "/p/deploy",
		});
		expect(buildSkillBlock(e, "Despliega $1.")).toBe(
			'<skill name="deploy" location="/p/deploy/SKILL.md">\n' +
				"References are relative to /p/deploy.\n\n" +
				"Despliega $1.\n" +
				"</skill>",
		);
	});
});

// ---------------------------------------------------------------------------
// appendArgs / appendSkillInput — emit-path
// ---------------------------------------------------------------------------

describe("appendArgs (ruta sin tokens)", () => {
	it("con args → bloque + \\n\\n + args crudos (byte-exacto a Pi)", () => {
		const block = "<skill>x</skill>";
		expect(appendArgs(block, "api prod")).toBe("<skill>x</skill>\n\napi prod");
	});

	it("sin args → sin sufijo", () => {
		const block = "<skill>x</skill>";
		expect(appendArgs(block, "")).toBe(block);
	});
});

describe("appendSkillInput (ruta con tokens)", () => {
	it("con args → bloque + \\n\\n + 'Skill input: ' + args crudos", () => {
		const block = "<skill>x</skill>";
		expect(appendSkillInput(block, "api prod")).toBe(
			"<skill>x</skill>\n\nSkill input: api prod",
		);
	});

	it("sin args → sin sufijo", () => {
		const block = "<skill>x</skill>";
		expect(appendSkillInput(block, "")).toBe(block);
	});

	it("SKILL_INPUT_LABEL es la cadena contractual", () => {
		expect(SKILL_INPUT_LABEL).toBe("Skill input:");
	});
});

// ---------------------------------------------------------------------------
// handleInput — integración de la tubería con mock de pi
// ---------------------------------------------------------------------------

describe("handleInput", () => {
	let tmp: string;
	let skillFile: string;

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-args-test-"));
		skillFile = path.join(tmp, "demo", "SKILL.md");
		fs.mkdirSync(path.dirname(skillFile), { recursive: true });
		// skillIndex es un singleton a nivel de módulo: sin invalidar, un test lee
		// la entrada cacheada de un tmp anterior (ya borrado) → readFileSync falla
		// → continue. Cada test debe construir su propio índice sobre su tmp.
		invalidateSkillIndex();
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	function writeSkill(body: string, frontmatter = ""): void {
		fs.writeFileSync(
			skillFile,
			frontmatter ? `${frontmatter}\n${body}` : body,
			"utf-8",
		);
	}

	it("texto que no es /skill: → continue (sin transformar)", async () => {
		writeSkill("Hola $1");
		const res = await handleInput(
			{ text: "hola mundo" } as any,
			mockCtx(),
			mockPi(skillFile),
		);
		expect(res).toEqual({ action: "continue" });
	});

	it("re-entrada: texto ya envuelto con <skill → continue", async () => {
		writeSkill("Hola $1");
		const res = await handleInput(
			{ text: "<skill name=x>ya</skill>" } as any,
			mockCtx(),
			mockPi(skillFile),
		);
		expect(res).toEqual({ action: "continue" });
	});

	it("skill desconocida → continue (Pi la maneja)", async () => {
		writeSkill("Hola $1");
		const res = await handleInput(
			{ text: "/skill:inexistente a b" } as any,
			mockCtx(),
			mockPi(skillFile),
		);
		expect(res).toEqual({ action: "continue" });
	});

	it("skill con tokens: sustituye y emite trailer 'Skill input:'", async () => {
		writeSkill("Despliega $1 a $2.");
		const res = await handleInput(
			{ text: "/skill:demo api production" } as any,
			mockCtx("sess-7"),
			mockPi(skillFile),
		);
		expect(transformText(res)).toBe(
			'<skill name="demo" location="' +
				skillFile +
				'">\n' +
				"References are relative to " +
				path.dirname(skillFile) +
				".\n\n" +
				"Despliega api a production.\n" +
				"</skill>\n\n" +
				"Skill input: api production",
		);
	});

	it("skill SIN tokens: emite args crudos (byte-exacto a la expansión de Pi)", async () => {
		writeSkill("Resume el siguiente issue.");
		const res = await handleInput(
			{ text: "/skill:demo login roto en móvil" } as any,
			mockCtx(),
			mockPi(skillFile),
		);
		expect(transformText(res)).toBe(
			'<skill name="demo" location="' +
				skillFile +
				'">\n' +
				"References are relative to " +
				path.dirname(skillFile) +
				".\n\n" +
				"Resume el siguiente issue.\n" +
				"</skill>\n\n" +
				"login roto en móvil",
		);
	});

	it("skill invocada sin args: no emite sufijo", async () => {
		writeSkill("Hola $1.");
		const res = await handleInput(
			{ text: "/skill:demo" } as any,
			mockCtx(),
			mockPi(skillFile),
		);
		expect(transformText(res)).toBe(
			'<skill name="demo" location="' +
				skillFile +
				'">\n' +
				"References are relative to " +
				path.dirname(skillFile) +
				".\n\n" +
				"Hola .\n" +
				"</skill>",
		);
	});

	it("${SKILL_DIR} y ${SESSION_ID} se sustituyen siempre", async () => {
		writeSkill("dir=${SKILL_DIR} s=${SESSION_ID}");
		const res = await handleInput(
			{ text: "/skill:demo" } as any,
			mockCtx("abc-9"),
			mockPi(skillFile),
		);
		// Sin tokens de argumentos → ruta appendArgs (args vacíos → sin sufijo).
		expect(transformText(res)).toContain("dir=" + path.dirname(skillFile));
		expect(transformText(res)).toContain("s=abc-9");
	});

	it("shell inline: la salida real reemplaza !`cmd`", async () => {
		writeSkill("Rama: !`git branch --show-current`");
		const pi = mockPi(skillFile, () => ({
			stdout: "main",
			stderr: "",
			code: 0,
			killed: false,
		}));
		const res = await handleInput(
			{ text: "/skill:demo" } as any,
			mockCtx(),
			pi,
		);
		expect(transformText(res)).toContain("Rama: main");
		expect(transformText(res)).not.toContain("!`git");
	});

	it("shell con exit != 0: error inlineado", async () => {
		writeSkill("Estado: !`fallo`");
		const pi = mockPi(skillFile, () => ({
			stdout: "",
			stderr: "boom",
			code: 2,
			killed: false,
		}));
		const res = await handleInput(
			{ text: "/skill:demo" } as any,
			mockCtx(),
			pi,
		);
		expect(transformText(res)).toContain("[Shell error: exit code 2]");
		expect(transformText(res)).toContain("boom");
	});
});

// ---------------------------------------------------------------------------
// executeShellInBody — orden, mask-and-restore, errores
// ---------------------------------------------------------------------------

describe("executeShellInBody", () => {
	it("inline !`cmd` se reemplaza por stdout", async () => {
		const pi = mockPi("", (cmd) => ({
			stdout: `<${cmd}>`,
			stderr: "",
			code: 0,
			killed: false,
		}));
		const out = await executeShellInBody("a !`echo hi` b", pi, "/tmp", 1000);
		expect(out).toBe("a <echo hi> b");
	});

	it("secuencial: respeta el orden de escritura", async () => {
		const calls: string[] = [];
		const pi = mockPi("", (cmd) => {
			calls.push(cmd);
			return { stdout: `[${cmd}]`, stderr: "", code: 0, killed: false };
		});
		const out = await executeShellInBody("!`uno` !`dos`", pi, "/tmp", 1000);
		expect(calls).toEqual(["uno", "dos"]);
		expect(out).toBe("[uno] [dos]");
	});

	it("bloque ```! ``` multilínea se reemplaza", async () => {
		const pi = mockPi("", (cmd) => ({
			stdout: cmd.replace(/\n/g, "|"),
			stderr: "",
			code: 0,
			killed: false,
		}));
		const out = await executeShellInBody(
			"x\n```!\na\nb\n```\ny",
			pi,
			"/tmp",
			1000,
		);
		expect(out).toBe("x\na|b\ny");
	});

	it("mask-and-restore: la salida de un bloque con '!`x`' NO se re-ejecuta como inline", async () => {
		const calls: string[] = [];
		const pi = mockPi("", (cmd) => {
			calls.push(cmd);
			// El bloque produce una salida que contiene sintaxis inline.
			if (cmd.includes("block"))
				return { stdout: "!`sneaky`", stderr: "", code: 0, killed: false };
			return { stdout: `[${cmd}]`, stderr: "", code: 0, killed: false };
		});
		const out = await executeShellInBody(
			"```!\necho block\n```\n!`real`",
			pi,
			"/tmp",
			1000,
		);
		// Se ejecutan exactamente 2 comandos: el del bloque y 'real'.
		// 'sneaky' (que viene de la SALIDA del bloque) NO se ejecuta.
		expect(calls).toEqual(["echo block", "real"]);
		expect(out).toBe("!`sneaky`\n[real]");
	});

	it("timeout: killed → mensaje de error con piso de 1s", async () => {
		const pi = mockPi("", () => ({
			stdout: "",
			stderr: "",
			code: 0,
			killed: true,
		}));
		const out = await executeShellInBody("!`lento`", pi, "/tmp", 500);
		// 500ms → piso en 1s → "after 1s" (no "after 0s").
		expect(out).toBe("[Shell error: timed out after 1s]");
	});

	it("stdout con stderr → ambos, separados por [stderr]", async () => {
		const pi = mockPi("", () => ({
			stdout: "ok",
			stderr: "warn",
			code: 0,
			killed: false,
		}));
		const out = await executeShellInBody("!`cmd`", pi, "/tmp", 1000);
		expect(out).toBe("ok\n[stderr]\nwarn");
	});
});

// ---------------------------------------------------------------------------
// Integración end-to-end con SHELL REAL (spawnSync, no mock).
//
// Verifica la tubería completa — índice → frontmatter → sustitución de
// argumentos → ${SKILL_DIR} → shell real → wrapper byte-exacto — contra una
// skill temporal real, usando el mismo shim (sh -c / powershell.exe) que
// runOneShellCommand. Sólo se mockea pi.getCommands() (para apuntar al
// registry) y pi.exec (para delegar a spawnSync en vez de pi.exec real).
// ---------------------------------------------------------------------------

function realExec(command: string, cwd: string, timeoutMs: number): ExecResult {
	const [sh, flag] =
		process.platform === "win32"
			? ["powershell.exe", "-Command"]
			: ["sh", "-c"];
	const r = spawnSync(sh, [flag, command], {
		cwd,
		timeout: timeoutMs,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 0,
		killed: r.signal === "SIGTERM",
	};
}

function mockPiRealExec(skillFile: string): ExtensionAPI {
	return {
		getCommands: () => [
			{ source: "skill", name: "skill:demo", sourceInfo: { path: skillFile } },
		],
		exec: async (
			_shCmd: string,
			args: string[],
			opts: { cwd: string; timeout: number },
		) => realExec(args[1] ?? "", opts.cwd, opts.timeout),
	} as unknown as ExtensionAPI;
}

describe("integración end-to-end con shell real (spawnSync)", () => {
	let tmp: string;
	let skillFile: string;

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-args-e2e-"));
		skillFile = path.join(tmp, "demo", "SKILL.md");
		fs.mkdirSync(path.dirname(skillFile), { recursive: true });
		invalidateSkillIndex();
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("transforma una skill completa: $1 + $ARGUMENTS + ${SKILL_DIR} + shell real (inline y bloque)", async () => {
		fs.writeFileSync(
			skillFile,
			[
				"---",
				"name: demo",
				"description: demo e2e",
				"---",
				"Saluda a $1.",
				"Todos: $ARGUMENTS",
				"Eco inline: !`echo hola-$1`",
				"Dir: ${SKILL_DIR}",
				"```!",
				"echo linea1",
				"echo linea2",
				"```",
			].join("\n"),
			"utf-8",
		);

		const res = await handleInput(
			{ text: "/skill:demo mundo extra" } as any,
			mockCtx(),
			mockPiRealExec(skillFile),
		);

		expect(res.action).toBe("transform");
		const text = transformText(res);
		// Wrapper byte-exacto.
		expect(text).toContain(`<skill name="demo" location="${skillFile}">`);
		expect(text).toContain(
			`References are relative to ${path.dirname(skillFile)}.`,
		);
		// Sustitución de argumentos.
		expect(text).toContain("Saluda a mundo.");
		expect(text).toContain("Todos: mundo extra");
		// Variable de runtime.
		expect(text).toContain(`Dir: ${path.dirname(skillFile)}`);
		// Shell real: inline y bloque, ambos ejecutados de verdad (no mock).
		expect(text).toContain("Eco inline: hola-mundo");
		expect(text).toContain("linea1\nlinea2");
		// Trailer con tokens (había placeholders en el cuerpo).
		expect(text).toContain("Skill input: mundo extra");
		// No debe quedar sintaxis sin resolver.
		expect(text).not.toContain("!`");
		expect(text).not.toContain("```!");
	});

	it("skill sin placeholders ni shell: no-op byte-idéntico a la expansión nativa de Pi", async () => {
		fs.writeFileSync(
			skillFile,
			[
				"---",
				"name: demo",
				"description: sin placeholders",
				"---",
				"Cuerpo fijo, sin variables.",
			].join("\n"),
			"utf-8",
		);

		const res = await handleInput(
			{ text: "/skill:demo cualquier cosa" } as any,
			mockCtx(),
			mockPiRealExec(skillFile),
		);

		expect(res.action).toBe("transform");
		// Sin tokens → ruta appendArgs: args crudos tal cual, SIN etiqueta 'Skill input:'.
		expect(transformText(res)).toBe(
			`<skill name="demo" location="${skillFile}">\n` +
				`References are relative to ${path.dirname(skillFile)}.\n\n` +
				"Cuerpo fijo, sin variables.\n" +
				"</skill>\n\n" +
				"cualquier cosa",
		);
	});
});
