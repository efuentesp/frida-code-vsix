/**
 * frida-agent-browser — Electron app discovery (Fase 7 — electron list).
 *
 * Porte de electron/discovery.js del referencia: escanea el host en busca de apps
 * Electron instaladas. macOS: /Applications + ~/Applications, gate por
 * `Contents/Frameworks/Electron Framework.framework` + payload (app.asar|app/), parsea
 * Info.plist (CFBundle*). Linux: .desktop en /usr/share/applications + ~/.local/share/
 * (versión básica, sin evidence profundo del binario). Resultados acotados por
 * maxResults y filtrables por query (substring en name/bundleId/appPath).
 */

import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const ELECTRON_DISCOVERY_DEFAULT_MAX_RESULTS = 50;
export const ELECTRON_DISCOVERY_MAX_RESULTS = 200;

export interface DiscoveredApp {
	name: string;
	appPath?: string;
	bundleId?: string;
	desktopId?: string;
	executablePath: string;
	platform: "darwin" | "linux";
	packageSource?: string;
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

function decodeXmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/** Lee un <string> de Info.plist por <key> (plist textual; best-effort). */
function readPlistString(plist: string, key: string): string | undefined {
	const pattern = new RegExp(
		`<key>\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`,
		"i",
	);
	const match = pattern.exec(plist);
	return match ? decodeXmlEntities((match[1] ?? "").trim()) : undefined;
}

async function readMacInfoPlist(appPath: string): Promise<{
	CFBundleDisplayName?: string;
	CFBundleExecutable?: string;
	CFBundleIdentifier?: string;
	CFBundleName?: string;
}> {
	try {
		const plist = await readFile(
			join(appPath, "Contents", "Info.plist"),
			"utf8",
		);
		return {
			CFBundleDisplayName: readPlistString(plist, "CFBundleDisplayName"),
			CFBundleExecutable: readPlistString(plist, "CFBundleExecutable"),
			CFBundleIdentifier: readPlistString(plist, "CFBundleIdentifier"),
			CFBundleName: readPlistString(plist, "CFBundleName"),
		};
	} catch {
		return {};
	}
}

/** Inspeciona un .app de macOS; undefined si no es Electron (sin framework/payload). */
export async function inspectDarwinApp(
	appPath: string,
): Promise<DiscoveredApp | undefined> {
	const frameworkPath = join(
		appPath,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
	);
	const resourcesPath = join(appPath, "Contents", "Resources");
	const hasElectronFramework = await isDirectory(frameworkPath);
	const hasAppPayload =
		(await pathExists(join(resourcesPath, "app.asar"))) ||
		(await isDirectory(join(resourcesPath, "app")));
	if (!hasElectronFramework || !hasAppPayload) return undefined;

	const info = await readMacInfoPlist(appPath);
	const appDirectoryName = basename(appPath, ".app");
	// executablePath = Contents/MacOS/<CFBundleExecutable> (fallback al primer archivo).
	const macOsDir = join(appPath, "Contents", "MacOS");
	let executablePath: string | undefined;
	if (info.CFBundleExecutable) {
		const candidate = join(macOsDir, info.CFBundleExecutable);
		executablePath = (await pathExists(candidate)) ? candidate : undefined;
	}
	if (!executablePath) {
		try {
			const entries = await readdir(macOsDir, { withFileTypes: true });
			const first = entries.find((e) => e.isFile());
			executablePath = first ? join(macOsDir, first.name) : undefined;
		} catch {
			executablePath = undefined;
		}
	}
	if (!executablePath) return undefined;

	const name =
		info.CFBundleDisplayName || info.CFBundleName || appDirectoryName;
	return {
		name,
		appPath,
		bundleId: info.CFBundleIdentifier || undefined,
		executablePath,
		platform: "darwin",
	};
}

async function scanDarwinApps(directories: string[]): Promise<DiscoveredApp[]> {
	const apps: DiscoveredApp[] = [];
	for (const dir of directories) {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
			const app = await inspectDarwinApp(join(dir, entry.name));
			if (app) apps.push(app);
		}
	}
	return apps;
}

// ── Linux .desktop (básico) ──

function readDesktopString(content: string, key: string): string | undefined {
	const prefix = `${key}=`;
	for (const line of content.split(/\r?\n/)) {
		if (line.startsWith(prefix)) {
			const v = line.slice(prefix.length).trim();
			return v.length > 0 ? v : undefined;
		}
	}
	return undefined;
}

async function scanLinuxApps(directories: string[]): Promise<DiscoveredApp[]> {
	const apps: DiscoveredApp[] = [];
	for (const dir of directories) {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
			try {
				const content = await readFile(join(dir, entry.name), "utf8");
				const exec = readDesktopString(content, "Exec");
				if (!exec) continue;
				const executablePath =
					exec
						.replace(/ %[A-Za-z]%/g, "")
						.trim()
						.split(/\s+/)[0] ?? exec;
				apps.push({
					name:
						readDesktopString(content, "Name") ??
						basename(entry.name, ".desktop"),
					desktopId: basename(entry.name, ".desktop"),
					executablePath,
					platform: "linux",
				});
			} catch {
				continue; // .desktop ilegible
			}
		}
	}
	return apps;
}

function normalizeMaxResults(maxResults?: number): number {
	if (
		typeof maxResults !== "number" ||
		!Number.isInteger(maxResults) ||
		maxResults <= 0
	) {
		return ELECTRON_DISCOVERY_DEFAULT_MAX_RESULTS;
	}
	return Math.min(maxResults, ELECTRON_DISCOVERY_MAX_RESULTS);
}

export interface ListElectronAppsOptions {
	query?: string;
	maxResults?: number;
	/** Override de directorios (tests). */
	darwinApplicationDirectories?: string[];
	linuxApplicationDirectories?: string[];
}

/** Descubre apps Electron instaladas (list). */
export async function listElectronApps(
	opts: ListElectronAppsOptions = {},
): Promise<DiscoveredApp[]> {
	const isMac = process.platform === "darwin";
	const dirs = isMac
		? (opts.darwinApplicationDirectories ?? [
				"/Applications",
				join(homedir(), "Applications"),
			])
		: (opts.linuxApplicationDirectories ?? [
				"/usr/share/applications",
				join(homedir(), ".local", "share", "applications"),
			]);
	const found = isMac ? await scanDarwinApps(dirs) : await scanLinuxApps(dirs);

	const query = opts.query?.trim().toLowerCase();
	const filtered = query
		? found.filter((app) =>
				[app.name, app.bundleId, app.desktopId, app.appPath, app.executablePath]
					.filter(Boolean)
					.some((v) => (v as string).toLowerCase().includes(query)),
			)
		: found;

	return filtered.slice(0, normalizeMaxResults(opts.maxResults));
}
