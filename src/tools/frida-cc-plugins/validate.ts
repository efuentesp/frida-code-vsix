/**
 * frida-cc-plugins — validador de marketplaces/plugins (issue #51, ADR-0057).
 *
 * `/ccplugin validate <dir>` (paridad `claude plugin validate .`): corre los
 * MISMOS readers que el loader — cero falsos OK — más los checks de autor:
 *
 *  - marketplace.json: schema (name/plugins), duplicados, traversal en sources,
 *    URLs no-https, renames (ciclos/no-termina-en-null-o-plugin-vigente).
 *  - Por entrada con source de path: plugin.json válido (si existe), versión
 *    entry↔plugin.json consistente, strict:false sin plugin.json declarando
 *    componentes, skills/commands descubribles.
 *  - Si <dir> es un PLUGIN (sin marketplace.json): valida su plugin.json y
 *    componentes directamente.
 *
 * Reporte por líneas con nivel (info=✔/warning=⚠/error=✖); warnings no
 * bloquean (misma semántica que claude plugin validate).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	discoverComponents,
	readMarketplaceCatalog,
	readPluginManifest,
} from "./readers";

export interface ValidateLine {
	level: "info" | "warning" | "error";
	text: string;
}

export interface ValidateReport {
	ok: boolean;
	checks: number;
	warnings: number;
	errors: number;
	lines: ValidateLine[];
}

function report(): {
	line: (level: ValidateLine["level"], text: string) => void;
	finish: () => ValidateReport;
} {
	const lines: ValidateLine[] = [];
	let checks = 0;
	let warnings = 0;
	let errors = 0;
	return {
		line(level, text) {
			checks++;
			if (level === "warning") warnings++;
			if (level === "error") errors++;
			const icon = level === "info" ? "✔" : level === "warning" ? "⚠" : "✖";
			lines.push({ level, text: `${icon} ${text}` });
		},
		finish(): ValidateReport {
			return { ok: errors === 0, checks, warnings, errors, lines };
		},
	};
}

/** Valida un directorio (marketplace con .claude-plugin/ o plugin directo). */
export function validateMarketplaceDir(dir: string): ValidateReport {
	const r = report();
	if (!fs.existsSync(dir)) {
		r.line("error", `No existe: ${dir}`);
		return r.finish();
	}
	const isMarketplace = fs.existsSync(
		path.join(dir, ".claude-plugin", "marketplace.json"),
	);
	if (isMarketplace) return validateMarketplace(dir, r);
	// Plugin directo (paridad: claude plugin validate ./plugins/my-plugin).
	if (fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) {
		return validatePlugin(path.basename(dir), dir, undefined, r);
	}
	r.line(
		"error",
		`No es un marketplace (falta .claude-plugin/marketplace.json) ni un plugin (falta .claude-plugin/plugin.json): ${dir}`,
	);
	return r.finish();
}

function validateMarketplace(
	dir: string,
	r: ReturnType<typeof report>,
): ValidateReport {
	let catalog;
	try {
		catalog = readMarketplaceCatalog(dir);
		r.line("info", `marketplace '${catalog.name}' parseado correctamente.`);
	} catch (e: any) {
		r.line("error", `marketplace.json: ${e?.message ?? e}`);
		return r.finish();
	}
	if (!catalog.owner) {
		r.line("warning", "marketplace sin 'owner' (recomendado para contacto).");
	}
	if (catalog.plugins.length === 0) {
		r.line("warning", "El marketplace no define plugins.");
	}
	// renames: cadenas deben terminar en null o nombre vigente; sin ciclos
	// (resolveRename ya lanza en ciclo; aquí validamos terminación).
	const names = new Set(catalog.plugins.map((p) => p.name));
	for (const [from, to] of Object.entries(catalog.renames ?? {})) {
		if (to === null) {
			r.line("info", `renames: '${from}' → eliminado (null).`);
			continue;
		}
		if (!names.has(to) && !(to in (catalog.renames ?? {}))) {
			r.line(
				"error",
				`renames: '${from}' → '${to}' no existe en plugins[] ni continúa en renames.`,
			);
		} else {
			r.line("info", `renames: '${from}' → '${to}'.`);
		}
	}

	for (const p of catalog.plugins) {
		const label = `plugins[${catalog.plugins.indexOf(p)}] ${p.name}`;
		if (p.source.kind === "path") {
			const pluginDir = path.join(dir, p.source.path.slice(2));
			if (!fs.existsSync(pluginDir)) {
				r.line("error", `${label}: source '${p.source.path}' no existe.`);
				continue;
			}
			validatePlugin(label, pluginDir, p, r);
		} else {
			const where = p.source.kind === "github" ? p.source.repo : p.source.url;
			r.line(
				"info",
				`${label}: source ${p.source.kind} (${where}) — fetch remoto: fase 2 (#50).`,
			);
		}
	}
	return r.finish();
}

function validatePlugin(
	label: string,
	pluginDir: string,
	entry: Parameters<typeof readMarketplaceCatalog>[0] extends never
		? never
		: import("./readers").MarketplacePluginEntry | undefined,
	r: ReturnType<typeof report>,
): ValidateReport {
	let manifest;
	try {
		manifest = readPluginManifest(pluginDir);
		if (manifest)
			r.line("info", `${label}: plugin.json OK ('${manifest.name}').`);
	} catch (e: any) {
		r.line("error", `${label}: plugin.json: ${e?.message ?? e}`);
		return r.finish();
	}
	// strict:false exige que la entrada defina TODO.
	if (entry?.strict === false && manifest?.hasComponents) {
		r.line(
			"error",
			`${label}: strict:false pero plugin.json declara componentes (conflicto — quítalos o elimina plugin.json).`,
		);
	}
	// Versión entry ↔ plugin.json (warning de consistencia, como Claude).
	if (
		entry?.version &&
		manifest?.version &&
		entry.version !== manifest.version
	) {
		r.line(
			"warning",
			`${label}: version entry '${entry.version}' ≠ plugin.json '${manifest.version}'.`,
		);
	}
	if (!manifest && entry?.strict !== false) {
		r.line(
			"warning",
			`${label}: sin plugin.json (opcional, pero recomendado para name/version).`,
		);
	}
	// Descubribilidad de componentes (mismos readers del loader).
	try {
		const c = discoverComponents(pluginDir, entry);
		const counts = `${c.skills.length} skills, ${c.commands.length} commands, ${Object.keys(c.mcpServers).length} MCP`;
		r.line("info", `${label}: ${counts}.`);
		if (
			c.skills.length + c.commands.length + Object.keys(c.mcpServers).length ===
			0
		) {
			r.line("warning", `${label}: sin componentes convertibles.`);
		}
		for (const s of c.skipped) {
			r.line("warning", `${label}: ${s.kind} omitido — ${s.reason}`);
		}
	} catch (e: any) {
		r.line("error", `${label}: ${e?.message ?? e}`);
	}
	return r.finish();
}
