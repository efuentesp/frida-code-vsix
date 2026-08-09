#!/usr/bin/env node
// scripts/upstream-feasibility.mjs
//
// Análisis de factibilidad on-demand para un bump de pi (issue #11).
// Dado un paquete upstream (--pkg) y opcionalmente --from/--to, corta el
// CHANGELOG, lo desglosa por sección (Added/Changed/Fixed/Removed/...) y emite
// un triage POR SECCIÓN + estimación de esfuerzo (S/M/L). Pensado para evaluar
// un bump ANTES de aplicarlo. (La señal automática semanal la da el workflow
// .github/workflows/upstream-digest.yml.)
//
// Uso:
//   npm run upstream:feasible -- --pkg pi-mcp-adapter
//   npm run upstream:feasible -- --pkg pi-mcp-adapter --from 2.16.0 --to 2.17.0
//   npm run upstream:feasible -- --pkg @earendil-works/pi-coding-agent --json
//
// NOTA: los helpers de resolución (lockfile/registry/changelog/semver) se
// duplican de upstream-drift.mjs a propósito para no acoplar dos CLI. Si surge un
// 3er consumidor, extraer scripts/upstream-lib.mjs.

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

// ─── args ────────────────────────────────────────────────────────────────────
function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const pkg = arg("pkg");
if (!pkg) {
	process.stderr.write("Uso: npm run upstream:feasible -- --pkg <paquete> [--from A --to B] [--json]\n");
	process.exit(1);
}

// ─── ledger ──────────────────────────────────────────────────────────────────
let ledger;
try {
	ledger = JSON.parse(readFileSync(resolve(root, "upstream-pi.json"), "utf8"));
} catch (e) {
	process.stderr.write(`✗ Ledger inválido (upstream-pi.json): ${e.message}\n`);
	process.exit(1);
}
let source;
if (ledger.platform.package === pkg) source = { label: ledger.platform.package, ...ledger.platform };
else source = ledger.sources.find((s) => s.upstream === pkg);
if (!source) {
	process.stderr.write(`✗ '${pkg}' no está en upstream-pi.json. Corre 'npm run upstream:drift' para ver las fuentes.\n`);
	process.exit(1);
}

// ─── helpers (duplicados de upstream-drift.mjs) ──────────────────────────────
function lockfileVersion(p) {
	const lockPath = resolve(root, "package-lock.json");
	if (existsSync(lockPath)) {
		try {
			const lock = JSON.parse(readFileSync(lockPath, "utf8"));
			const key = `node_modules/${p}`;
			if (lock.packages?.[key]?.version) return lock.packages[key].version;
			if (lock.dependencies?.[p]?.version) return lock.dependencies[p].version;
		} catch {}
	}
	const pj = resolve(root, "node_modules", ...p.split("/"), "package.json");
	if (existsSync(pj)) {
		try {
			return JSON.parse(readFileSync(pj, "utf8")).version;
		} catch {}
	}
	return null;
}
function registryLatest(p) {
	try {
		return execSync(`npm view "${p}" version`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 15000 }).trim() || null;
	} catch {
		return null;
	}
}
function sliceChangelog(p, fromVer, toVer) {
	const cp = resolve(root, "node_modules", ...p.split("/"), "CHANGELOG.md");
	if (!existsSync(cp)) return null;
	const lines = readFileSync(cp, "utf8").split("\n");
	const headerRe = /^\s*##\s*\[([^\]]+)\]/;
	let startIdx = -1;
	let endIdx = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(headerRe);
		if (!m) continue;
		const ver = m[1].trim();
		if (ver === toVer && startIdx === -1) startIdx = i;
		else if (startIdx !== -1 && ver === fromVer) {
			endIdx = i;
			break;
		}
	}
	if (startIdx === -1) return null;
	return lines.slice(startIdx, endIdx).join("\n").trim();
}

// ─── from/to ─────────────────────────────────────────────────────────────────
const fromV = arg("from") || (source.basedOn !== "n/a" ? source.basedOn : null);
const toV = arg("to") || (source.kind === "runtime" || source.kind === "platform" ? lockfileVersion(pkg) : registryLatest(pkg));
if (!fromV || !toV) {
	process.stderr.write(`✗ No pude resolver from/to (from=${fromV}, to=${toV}). Pásalos con --from/--to.\n`);
	process.exit(1);
}

// ─── desglose por sección ────────────────────────────────────────────────────
function parseSections(block) {
	const sections = [];
	let curVer = null;
	let cur = null;
	for (const line of block.split("\n")) {
		const vm = line.match(/^##\s*\[([^\]]+)\]/);
		if (vm) {
			curVer = vm[1].trim();
			cur = null;
			continue;
		}
		const sm = line.match(/^###\s+(.+)$/);
		if (sm) {
			cur = { version: curVer, name: sm[1].trim(), bullets: [] };
			sections.push(cur);
			continue;
		}
		if (cur && /^\s*[-*]/.test(line)) cur.bullets.push(line.replace(/^\s*[-*]\s*/, "").trim());
	}
	return sections;
}

function sectionTriage(name) {
	const n = name.toLowerCase();
	if (source.kind === "reference") return "n/a (reference)";
	if (source.mode === "delegate") {
		if (n.includes("remov") || n.includes("break")) return "⚠ posible break (delegate) — verificar API";
		return "bump (heredado; re-test)";
	}
	if (n.includes("remov") || n.includes("break")) return "port ⚠ (posible break en lógica duplicada)";
	if (n.includes("added")) return "port? (¿feature nueva a portar?)";
	if (n.includes("fix")) return "skip/defer (fix del upstream; ¿Frida tiene el mismo bug?)";
	if (n.includes("chang") || n.includes("deprecat")) return "port? (¿cambio de comportamiento relevante?)";
	return "port? (evaluar)";
}
function effort(n) {
	if (n <= 2) return "S";
	if (n <= 7) return "M";
	return "L";
}

const sameRange = fromV === toV;
const block = sameRange ? null : sliceChangelog(pkg, fromV, toV);
const sections = block ? parseSections(block) : [];

// ─── salida ──────────────────────────────────────────────────────────────────
if (asJson) {
	process.stdout.write(
		`${JSON.stringify(
			{ pkg, wrapper: source.label || source.wrapper, kind: source.kind, mode: source.mode, from: fromV, to: toV, sameRange, changelogAvailable: Boolean(block), sections: sections.map((s) => ({ version: s.version, name: s.name, bullets: s.bullets.length, triage: sectionTriage(s.name), effort: effort(s.bullets.length) })) },
			null,
			2,
		)}\n`,
	);
	process.exit(0);
}

const out = [];
out.push(`\n ▌ Factibilidad de bump: ${pkg}`);
out.push(`   wrapper: ${source.label || source.wrapper}   [${source.kind} · ${source.mode}]`);
out.push(`   rango:   ${fromV} → ${toV}`);
out.push("");
if (sameRange) {
	out.push(` from === to (${fromV}): mismo rango, sin cambios que evaluar.`);
} else if (!block) {
	out.push(` ⚠ CHANGELOG no disponible localmente (port no instalado o sin ${fromV}→${toV} en node_modules).`);
	if (source.repo) out.push(`   Revisar manualmente: ${source.repo}`);
	out.push(`   Triage genérico por mode=${source.mode}: ${source.mode === "delegate" ? "bump (heredado; re-test)" : "port? (evaluar repo upstream)"}`);
} else if (sections.length === 0) {
	out.push(` (sin secciones ### detectadas entre ${fromV} y ${toV}; posiblemente mismo rango o formato distinto)`);
} else {
	out.push(` ${sections.length} sección(es) — triage + esfuerzo (S/M/L por nº de bullets):`);
	out.push("");
	for (const s of sections) {
		out.push(` • [${s.version}] ${s.name} — ${s.bullets.length} cambio(s) · esfuerzo ${effort(s.bullets.length)}`);
		out.push(`     triage: ${sectionTriage(s.name)}`);
	}
}
out.push("");
out.push(` Leyenda: port=implementar en Frida · bump=heredado(sólo re-test) · defer/skip=no ahora.`);
out.push("");
process.stdout.write(`${out.join("\n")}\n`);
