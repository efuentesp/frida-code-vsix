#!/usr/bin/env node
// scripts/upstream-drift.mjs
//
// Reporte de drift Frida↔pi. Lee upstream-pi.json (ledger de proveniencia),
// recalcula la versión "actual" de cada fuente (lockfile para deps runtime,
// npm registry best-effort para ports conceptuales), corta el CHANGELOG entre
// basedOn→actual, e imprime un reporte con evaluación de triage sugerida
// (port / bump / defer / skip). Pensado para consumo humano (por defecto) o
// machine (--json) — este último lo consume el digest Action semanal y el
// workflow de factibilidad (issue #11).
//
// Uso:
//   npm run upstream:drift            # reporte en texto
//   npm run upstream:drift -- --json  # JSON para pipelines
//   npm run upstream:drift -- --no-registry   # sin llamadas a npm (sólo lockfile/node_modules)

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const noRegistry = argv.includes("--no-registry");

// ─── cargar ledger ───────────────────────────────────────────────────────────
const ledgerPath = resolve(root, "upstream-pi.json");
if (!existsSync(ledgerPath)) {
	process.stderr.write(`✗ No encuentro el ledger: ${ledgerPath}\n`);
	process.exit(1);
}
let ledger;
try {
	ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
} catch (e) {
	process.stderr.write(`✗ Ledger inválido (${ledgerPath}): ${e.message}\n`);
	process.exit(1);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Versión instalada según el lockfile (npm v2/v3) o node_modules/<pkg>/package.json. */
function lockfileVersion(pkg) {
	const lockPath = resolve(root, "package-lock.json");
	if (existsSync(lockPath)) {
		try {
			const lock = JSON.parse(readFileSync(lockPath, "utf8"));
			const key = `node_modules/${pkg}`;
			if (lock.packages?.[key]?.version) return lock.packages[key].version;
			if (lock.dependencies?.[pkg]?.version)
				return lock.dependencies[pkg].version;
		} catch {}
	}
	const pjPath = resolve(
		root,
		"node_modules",
		...pkg.split("/"),
		"package.json",
	);
	if (existsSync(pjPath)) {
		try {
			return JSON.parse(readFileSync(pjPath, "utf8")).version;
		} catch {}
	}
	return null;
}

/** Latest publicada en el npm registry (best-effort; null si sin red/timeout). */
function registryLatest(pkg) {
	if (noRegistry) return null;
	try {
		const out = execSync(`npm view "${pkg}" version`, {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
			timeout: 15000,
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

/** Ruta al CHANGELOG.md del paquete instalado, o null. */
function changelogPathFor(pkg) {
	const p = resolve(root, "node_modules", ...pkg.split("/"), "CHANGELOG.md");
	return existsSync(p) ? p : null;
}

/**
 * Corta el CHANGELOG (Keep a Changelog) entre fromVer (excluido) y toVer (incluido):
 * devuelve el bloque desde `## [toVer]` hasta justo antes de `## [fromVer]`.
 * null si toVer no aparece o no hay CHANGELOG.
 */
function sliceChangelog(pkg, fromVer, toVer) {
	const p = changelogPathFor(pkg);
	if (!p) return null;
	const lines = readFileSync(p, "utf8").split("\n");
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

/** Línea de estado legible para una fila del reporte. */
function statusLine(r) {
	if (r.current === null) return "¿? sin versión (lockfile/registry)";
	if (r.drifted) return `→ ${r.current}  ⚠ drift`;
	return `→ ${r.current}  ✓`;
}

/** Comparación semver naïve (suficiente para detectar drift !=). */
function semvercmp(a, b) {
	if (a === b) return 0;
	if (!a) return -1;
	if (!b) return 1;
	const pa = a
		.replace(/^[^0-9]*/, "")
		.split(/[.\-+]/)
		.map((n) => Number.parseInt(n, 10) || 0);
	const pb = b
		.replace(/^[^0-9]*/, "")
		.split(/[.\-+]/)
		.map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
	}
	return 0;
}

/** Triage sugerido según el modo del wrapper y si hubo drift. */
function triage({ mode, kind, drifted }) {
	if (!drifted) return "synced";
	if (kind === "port") return "port? (evaluar CHANGELOG del upstream)";
	if (mode === "delegate") return "bump (heredado; re-test)";
	if (mode === "fork") return "port? (evaluar CHANGELOG)";
	return "review";
}

// ─── recolección ─────────────────────────────────────────────────────────────

function evaluate({ label, upstream, kind, mode, basedOn }) {
	if (kind === "reference") {
		return {
			label,
			upstream,
			kind,
			mode,
			basedOn,
			current: null,
			drifted: false,
			triage: "n/a (reference)",
			changelog: null,
		};
	}
	const current =
		kind === "runtime" || kind === "platform"
			? lockfileVersion(upstream)
			: registryLatest(upstream);
	const drifted =
		!!current &&
		basedOn !== "n/a" &&
		basedOn !== current &&
		semvercmp(current, basedOn) !== 0;
	let changelog = null;
	if (drifted && (kind === "runtime" || kind === "platform")) {
		changelog = sliceChangelog(upstream, basedOn, current);
	}
	return {
		label,
		upstream,
		kind,
		mode,
		basedOn,
		current,
		drifted,
		triage: triage({ mode, kind, drifted }),
		changelog,
	};
}

const rows = [];
// plataforma primero (es la base de todo)
rows.push(
	evaluate({
		label: ledger.platform.package,
		upstream: ledger.platform.package,
		kind: ledger.platform.kind,
		mode: ledger.platform.mode,
		basedOn: ledger.platform.basedOn,
	}),
);
// cada wrapper
for (const s of ledger.sources) {
	rows.push(
		evaluate({
			label: s.wrapper,
			upstream: s.upstream,
			kind: s.kind,
			mode: s.mode,
			basedOn: s.basedOn,
		}),
	);
}

// ─── salida ──────────────────────────────────────────────────────────────────

if (asJson) {
	process.stdout.write(
		`${JSON.stringify({ generatedAt: new Date().toISOString(), ledger: ledgerPath, rows }, null, 2)}\n`,
	);
	process.exit(0);
}

// texto
const drifted = rows.filter((r) => r.drifted);
const tracked = rows.filter((r) => r.kind !== "reference");
const synced = tracked.filter((r) => !r.drifted);
const refs = rows.filter((r) => r.kind === "reference");

const today = new Date().toISOString().slice(0, 10);
const out = [];
out.push(`\n ▌ Frida ↔ pi upstream drift   (${today})`);
out.push(`   ledger: upstream-pi.json`);
out.push("");

for (const r of rows) {
	if (r.kind === "reference") continue; // se listan al final
	const tag = r.kind === "platform" ? "platform" : `${r.kind} · ${r.mode}`;
	const status = statusLine(r);
	out.push(` ▌ ${r.label}`);
	if (r.kind !== "platform") out.push(`   upstream: ${r.upstream}`);
	out.push(`   [${tag}]   basedOn ${r.basedOn}  ${status}`);
	out.push(`   triage: ${r.triage}`);
	if (r.changelog) {
		out.push("   ── CHANGELOG ──");
		for (const line of r.changelog.split("\n")) out.push(`   ${line}`);
	}
	out.push("");
}

if (refs.length) {
	out.push(
		` ▌ No rastreados (${refs.length}, reference = original de Frida, sin upstream directo):`,
	);
	out.push(
		`   ${refs.map((r) => r.label.replace("src/tools/", "")).join(", ")}`,
	);
	out.push("");
}

out.push(
	` Resumen: ${tracked.length} rastreados · ${synced.length} synced · ${drifted.length} con drift`,
);
if (noRegistry)
	out.push("   (modo --no-registry: ports sin verificación de registry)");
out.push("");

process.stdout.write(`${out.join("\n")}\n`);
