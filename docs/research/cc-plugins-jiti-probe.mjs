// Probe de carga de @nklisch/pi-plugins con el mecanismo que usaría frida:
// jiti + aliases a los peers que ya shipeamos + PI_CODING_AGENT_DIR.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

// Timeout global: si algo cuelga, volcamos la trazabilidad y salimos.
const t0 = Date.now();
setInterval(() => {
	console.error(`[probe] vivo a los ${Math.round((Date.now() - t0) / 1000)}s`);
	if (Date.now() - t0 > 150_000) {
		console.error("[probe] TIMEOUT GLOBAL 45s — abortando");
		process.exit(3);
	}
}, 5_000);

// realpathSync: el host valida que ninguna componente del path sea symlink
// (en macOS /var → /private/var rompería la validación de layout).
const agentDir = fs.realpathSync(
	fs.mkdtempSync(path.join(os.tmpdir(), "ccplug-")),
);
process.env.PI_CODING_AGENT_DIR = agentDir;

const pkgRoot = "/tmp/cc-plugins-install/node_modules/@nklisch/pi-plugins";
const entry = path.join(pkgRoot, "dist", "pi", "extension.js");

const { createJiti } = await import("jiti");
const topNM = path.join(process.cwd(), "node_modules", "@earendil-works");
const nested = path.join(
	topNM,
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
);
const aliases = {
	"@earendil-works/pi-coding-agent": path.join(
		topNM,
		"pi-coding-agent",
		"dist",
		"index.js",
	),
	"@earendil-works/pi-tui": path.join(nested, "pi-tui", "dist", "index.js"),
	"@earendil-works/pi-ai": path.join(nested, "pi-ai", "dist", "index.js"),
	"@earendil-works/pi-ai/bedrock-provider": path.join(
		nested,
		"pi-ai",
		"dist",
		"bedrock-provider.js",
	),
	"@earendil-works/pi-ai/bun-oauth": path.join(
		nested,
		"pi-ai",
		"dist",
		"bun-oauth.js",
	),
	"@earendil-works/pi-ai/compat": path.join(
		nested,
		"pi-ai",
		"dist",
		"compat.js",
	),
	"@earendil-works/pi-ai/oauth": path.join(nested, "pi-ai", "dist", "oauth.js"),
	"@earendil-works/pi-ai/providers/all": path.join(
		nested,
		"pi-ai",
		"dist",
		"providers",
		"all.js",
	),
};

const commands = new Map();
const events = new Map();
const accessed = new Set();
let lastNotify = "";

function makeCtx(uiNotify) {
	return new Proxy(
		{},
		{
			get(_t, prop) {
				const p = String(prop);
				if (p === "sessionManager")
					return {
						getEntries: () => [],
						getSessionDir: () => "/tmp/sessions",
						getSessionFile: () => undefined,
						getSessionId: () => "probe-session",
						getCwd: () => process.cwd(),
						getBranch: () => "main",
						getLeafId: () => "leaf-1",
						getTree: () => [],
					};
				if (p === "cwd") return process.cwd();
				if (p === "isProjectTrusted") return () => true;
				if (p === "signal") return undefined;
				if (p === "mode") return "rpc";
				if (p === "ui")
					return {
						notify: (m, level) => uiNotify(String(m), level),
						confirm: async () => true,
						setStatus: () => {},
						theme: { fg: () => "" },
					};
				accessed.add(`ctx.${p}`);
				return () => {};
			},
		},
	);
}
const pi = new Proxy(
	{},
	{
		get(_t, prop) {
			const p = String(prop);
			if (p === "registerCommand")
				return (name, opts) => {
					commands.set(name, opts);
					console.log("  [command]", name);
				};
			if (p === "registerTool") return (t) => console.log("  [tool]", t?.name);
			if (p === "on")
				return (ev, h) => {
					const list = events.get(ev) ?? [];
					list.push(h);
					events.set(ev, list);
					return () => {};
				};
			if (p === "getCommands") return () => [];
			if (p === "mode") return "rpc";
			if (p === "hasUI") return false;
			if (p === "cwd") return process.cwd();
			accessed.add(`pi.${p}`);
			return () => {};
		},
	},
);

console.log("--- factory() ---");
const jiti = createJiti(entry, { alias: aliases });
const mod = jiti(entry);
await (mod.default ?? mod)(pi);
console.log("commands:", [...commands.keys()]);

console.log("--- session_start (todos los handlers) ---");
for (const h of events.get("session_start") ?? []) {
	await h(
		{},
		makeCtx(() => {}),
	);
}
console.log(
	"handlers session_start ejecutados:",
	(events.get("session_start") ?? []).length,
);

const pluginsCmd = commands.get("plugins");
let listo = false;
for (let i = 0; i < 24 && !listo; i++) {
	await new Promise((r) => setTimeout(r, 500));
	lastNotify = "";
	try {
		await pluginsCmd.handler(
			"list",
			makeCtx((m) => {
				lastNotify = m;
			}),
		);
		if (!/still starting/i.test(lastNotify)) {
			listo = true;
			console.log(`HOST LISTO tras ${(i + 1) * 0.5}s — /plugins list:`);
			console.log(lastNotify.slice(0, 1500));
		}
	} catch (e) {
		console.log(`  reintento ${i}:`, e?.message ?? e);
	}
}
if (!listo) console.log("HOST NUNCA LISTO (12s)");

// Prueba E2E de red: agregar un marketplace real de GitHub (shorthand).
console.log("--- /plugins marketplace add nklisch/skills ---");
try {
	await pluginsCmd.handler(
		"marketplace add nklisch/skills",
		makeCtx((m, l) =>
			console.log(`  [notify:${l ?? "info"}]`, String(m).slice(0, 400)),
		),
	);
} catch (e) {
	console.log("FALLO marketplace add:", e?.message ?? e);
}
await new Promise((r) => setTimeout(r, 2000));
console.log("--- /plugins marketplace list (tras add) ---");
try {
	await pluginsCmd.handler(
		"marketplace list",
		makeCtx((m, l) =>
			console.log(`  [notify:${l ?? "info"}]`, String(m).slice(0, 600)),
		),
	);
} catch (e) {
	console.log("FALLO:", e?.message ?? e);
}

for (const args of ["doctor"]) {
	console.log(`--- /plugins ${args} ---`);
	lastNotify = "";
	try {
		await pluginsCmd.handler(
			args,
			makeCtx((m) => {
				lastNotify = m;
			}),
		);
		console.log(lastNotify.slice(0, 1500) || "(sin salida notify)");
	} catch (e) {
		console.log("FALLO:", e?.message ?? e);
	}
}

console.log("--- estado bajo agentDir ---");
try {
	console.log(
		fs.existsSync(path.join(agentDir, "plugin-host"))
			? execSync(
					`find "${path.join(agentDir, "plugin-host")}" -maxdepth 4 | head -30`,
				).toString()
			: "plugin-host NO creado; contenido agentDir:\n" +
					execSync(`find "${agentDir}" -maxdepth 3 | head -20`).toString(),
	);
} catch (e) {
	console.log("(falló el listado de estado:", e?.message ?? e, ")");
}
console.log(
	"accesos no cubiertos:",
	[...accessed].filter((a) => !a.startsWith("ctx.")),
);
try {
	fs.rmSync(agentDir, { recursive: true, force: true });
} catch {
	// El host escribe async tras el cierre del probe (ENOTEMPTY) — queda en tmpdir del SO.
}
