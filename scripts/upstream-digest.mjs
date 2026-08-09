#!/usr/bin/env node
// scripts/upstream-digest.mjs
//
// Formatea la salida de `upstream-drift --json` (drift.json) en un cuerpo de
// issue Markdown para el digest semanal del workflow upstream-pi-digest
// (issue #11). Entrada: path al drift.json (argv[2]) o stdin. Salida: markdown.
//
// Uso:
//   node scripts/upstream-drift.mjs --json > drift.json
//   node scripts/upstream-digest.mjs drift.json > issue-body.md

import { readFileSync } from "node:fs";

const input = process.argv[2] ? readFileSync(process.argv[2], "utf8") : readFileSync(0, "utf8");
let data;
try {
	data = JSON.parse(input);
} catch (e) {
	process.stderr.write(`✗ drift.json inválido: ${e.message}\n`);
	process.exit(1);
}

const rows = data.rows ?? [];
const tracked = rows.filter((r) => r.kind !== "reference");
const drifted = rows.filter((r) => r.drifted);
const date = (data.generatedAt ?? new Date().toISOString()).slice(0, 10);

const out = [];
out.push(`# pi upstream digest — ${date}`);
out.push("");
out.push(
	`> Generado por \`npm run upstream:drift -- --json\` · [issue #11](https://github.com/efuentesp/frida-code-vsix/issues/11).`,
);
out.push(
	`> **${tracked.length}** fuentes rastreadas · **${drifted.length}** con drift.`,
);
out.push("");

if (drifted.length === 0) {
	out.push("## ✅ Todo sincronizado");
	out.push("");
	out.push("Ningún upstream publicó cambios desde el último sync. Nada que portar esta semana.");
	out.push("");
} else {
	out.push(`## ⚠ ${drifted.length} con drift — revisar para port/bump`);
	out.push("");
	for (const r of drifted) {
		out.push(`### \`${r.label}\` ← \`${r.upstream}\``);
		out.push(`- **kind:** ${r.kind} · **mode:** ${r.mode}`);
		out.push(`- **versión:** ${r.basedOn} → **${r.current}**`);
		out.push(`- **triage sugerido:** ${r.triage}`);
		if (r.changelog) {
			const excerpt = r.changelog.split("\n").slice(0, 25).join("\n");
			out.push("");
			out.push("<details><summary>CHANGELOG (extracto)</summary>");
			out.push("");
			out.push("```markdown");
			out.push(excerpt);
			out.push("```");
			out.push("");
			out.push("</details>");
		}
		out.push("");
	}
}

out.push("---");
out.push("");
out.push(
	"**Tras portar/bump:** edita `basedOn` en [`upstream-pi.json`](../upstream-pi.json) y vuelve a correr `npm run upstream:drift` (debe quedar ✓ synced). Esquema y flujo en [`docs/upstream-pi.md`](../docs/upstream-pi.md).",
);

process.stdout.write(`${out.join("\n")}\n`);
