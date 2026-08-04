#!/usr/bin/env node
/**
 * Release automático de Frida Code (política en docs/versioning.md).
 *
 * 1. Lee los commits Conventional Commits desde el último `chore(release):`.
 * 2. Determina el bump (MAYOR/MENOR/PARCHE) — el mayor entre todos los commits.
 * 3. Aborta sin tocar nada si no hay commits que justifiquen release.
 * 4. Actualiza `version` en package.json y mueve `[Unreleased]` → `[X.Y.Z]` en
 *    CHANGELOG.md (preservando lo escrito a mano; autogenera si estaba vacío).
 * 5. Hace el commit `chore(release): X.Y.Z`.
 *
 * NO publica: no compila el .vsix ni abre la GitHub Release (runbook en
 * docs/versioning.md §4). Idempotente: una 2ª ejecución seguida aborta.
 *
 * Toda la lógica va en main() envuelta por un try/catch global (abajo): así un
 * error de git / de parseo / de commit se reporta limpio y sale con código
 * non-zero, en vez de volcar un stack trace.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const RANK = { major: 3, minor: 2, patch: 1 };
const RULES = {
	feat: { bump: "minor", section: "Añadido" },
	fix: { bump: "patch", section: "Corregido" },
	perf: { bump: "patch", section: "Cambiado" },
	refactor: { bump: "patch", section: "Cambiado" },
	docs: { bump: null, section: "Interno" },
	style: { bump: null, section: "Interno" },
	test: { bump: null, section: "Interno" },
	chore: { bump: null, section: "Interno" },
	ci: { bump: null, section: "Interno" },
	build: { bump: null, section: "Interno" },
};
const SECTION_ORDER = ["Añadido", "Cambiado", "Corregido", "Interno"];
const SEP = "\x1e"; // entre campos
const END = "\x1f"; // entre commits
const RE_CC =
	/^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<desc>.+)$/;

function git(args, opts = {}) {
	try {
		return execSync(`git ${args}`, { encoding: "utf8", ...opts }).trim();
	} catch (e) {
		throw new Error(
			`git ${args.split(" ")[0]} falló: ${String(e.stderr || "").trim() || e.message}`,
		);
	}
}

/** Lanza un error con mensaje; el try/catch global de abajo lo reporta y sale. */
function fail(msg) {
	throw new Error(msg);
}

/** Lee y parsea un JSON; relanza con contexto si falla (regla try/catch). */
function readJson(p) {
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch (e) {
		throw new Error(`No se pudo parsear ${p}: ${e.message}`);
	}
}

function main() {
	// --- 1) Versión actual + árbol limpio --------------------------------
	const status = git("status --porcelain");
	if (status)
		fail(
			"El árbol no está limpio: commitea o descarta los cambios antes de releasear.",
		);

	const pkgPath = "package.json";
	const pkg = readJson(pkgPath);
	const current = String(pkg.version);
	if (!/^\d+\.\d+\.\d+$/.test(current))
		fail(`Versión inválida en package.json: "${current}"`);

	// --- 2) Punto de corte: último `chore(release):` ---------------------
	const cutSha = git('log --grep="^chore(release):" -1 --format="%H"') || "";
	const range = cutSha ? `${cutSha}..HEAD` : "--max-count=1000 HEAD";

	// --- 3) Commits desde el corte ---------------------------------------
	const raw = git(`log ${range} --format="%H${SEP}%s${SEP}%b${END}"`);
	const commits = raw
		.split(END)
		.map((rec) => rec.split(SEP))
		.filter((p) => p[1])
		.map(([sha, subject, body]) => ({
			sha: (sha || "").trim(),
			subject: (subject || "").trim(),
			body: (body || "").trim(),
		}));

	if (commits.length === 0)
		fail("No hay commits desde el último release. Nada que releasear.");

	// --- 4) Clasificar + bump --------------------------------------------
	const bySection = Object.fromEntries(SECTION_ORDER.map((s) => [s, []]));
	let bestRank = 0;
	let bestKind = null;

	for (const c of commits) {
		const m = RE_CC.exec(c.subject);
		if (!m) continue; // commit no convencional: no contribuye al bump
		const { type, scope, breaking, desc } = m.groups;
		const rule = RULES[type];
		if (!rule) continue;
		const isBreaking = !!breaking || /BREAKING[ -]CHANGE:/i.test(c.body);
		if (isBreaking && RANK.major > bestRank) {
			bestRank = RANK.major;
			bestKind = "major";
		} else if (rule.bump && RANK[rule.bump] > bestRank) {
			bestRank = RANK[rule.bump];
			bestKind = rule.bump;
		}
		// Para el CHANGELOG autogenerado (solo se usa si [Unreleased] está vacío):
		const label = scope ? `**${scope}** — ` : "";
		bySection[rule.section].push(`- ${label}${desc}`);
	}

	if (!bestKind) {
		const subjects = commits.map((c) => `  · ${c.subject}`).join("\n");
		fail(
			`Ningún commit desde el último release justifica un release\n` +
				`(solo hay docs/style/test/chore/ci/build):\n${subjects}`,
		);
	}

	// --- 5) Nueva versión ------------------------------------------------
	const [maj, min, pat] = current.split(".").map(Number);
	const next =
		bestKind === "major"
			? `${maj + 1}.0.0`
			: bestKind === "minor"
				? `${maj}.${min + 1}.0`
				: `${maj}.${min}.${pat + 1}`;
	console.log(`→ Bump: ${current} → ${next}  (${bestKind})`);

	// --- 6) CHANGELOG: preservar [Unreleased] o autogenerar --------------
	const clPath = "CHANGELOG.md";
	const changelog = readFileSync(clPath, "utf8");
	const reUnreleased = /^## \[Unreleased\][\s\S]*?(?=^## \[)/m;
	const match = changelog.match(reUnreleased);
	if (!match) fail("No se encontró '## [Unreleased]' en CHANGELOG.md.");

	const oldContent = match[0].replace(/^## \[Unreleased\]\s*/, "");
	const hasManualContent = /^\s*-\s/m.test(oldContent); // hay bullets a mano

	let content;
	if (hasManualContent) {
		content = oldContent.trimEnd(); // respeta el trabajo manual (rico)
		console.log(
			"→ CHANGELOG: se preserva el contenido escrito a mano de [Unreleased].",
		);
	} else {
		const lines = [];
		for (const sec of SECTION_ORDER) {
			if (bySection[sec].length)
				lines.push(`### ${sec}\n\n${bySection[sec].join("\n")}`);
		}
		content = lines.join("\n\n");
		console.log(
			"→ CHANGELOG: [Unreleased] vacío → se autogenera de los commits.",
		);
	}

	const today = new Date().toISOString().slice(0, 10);
	const newUnreleased = `## [Unreleased]\n\n### Añadido\n\n### Cambiado\n\n### Corregido\n\n`;
	const versionHeader = `## [${next}] - ${today}\n`;
	const updated = changelog.replace(
		reUnreleased,
		newUnreleased + versionHeader + content + "\n\n",
	);
	writeFileSync(clPath, updated);

	// --- 7) package.json -------------------------------------------------
	pkg.version = next;
	writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

	// --- 8) Commit -------------------------------------------------------
	git(`add ${pkgPath} ${clPath}`);
	try {
		execSync(`git commit -m "chore(release): ${next}"`, { stdio: "inherit" });
	} catch (e) {
		fail(`git commit falló (¿índice bloqueado?): ${e.message}`);
	}

	// --- Resumen + siguientes pasos --------------------------------------
	console.log(
		`\n✔ Release ${next} preparado y commiteado.\n\n` +
			`Siguientes pasos (ver docs/versioning.md §4):\n` +
			`  npm run package        # compila frida-code-${next}.vsix\n` +
			`  gh release create v${next} frida-code-${next}.vsix \\\n` +
			`    --repo efuentesp/frida-code-vsix --title "${next}" \\\n` +
			`    --notes-file <(awk '/^## \\[${next}\\]/{f=1;next}/^## \\[/{exit}f' CHANGELOG.md)\n`,
	);
}

try {
	main();
} catch (e) {
	console.error(`✖ ${e?.message ?? e}`);
	process.exit(1);
}
