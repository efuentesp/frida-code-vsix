/**
 * frida-cc-plugins — tests del panel nativo del webview (UX #49, rediseño
 * e2e): flujo emitPanel (filas + acciones host-side), refresh con id estable
 * (conserva filtro/foco en el componente), acciones reales (install/toggle)
 * y fallback a notify cuando no hay sink (tests/TUI).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFridaCcPlugins } from "../../src/tools/frida-cc-plugins/index";
import { addMarketplace, installPlugin } from "../../src/tools/frida-cc-plugins/installer";
import type {
	CcPanelRequest,
	CcPanelSink,
} from "../../src/tools/frida-cc-plugins/panel";
import type { CcPluginsPresenter } from "../../src/tools/frida-cc-plugins/presenter";

let agentDir: string;
let mktDir: string;
let workDir: string;

function writeFixture(): void {
	fs.rmSync(mktDir, { recursive: true, force: true });
	fs.mkdirSync(path.join(mktDir, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(mktDir, ".claude-plugin", "marketplace.json"),
		JSON.stringify({
			name: "m",
			plugins: [
				{
					name: "p1",
					source: "./plugins/p1",
					version: "1.0.0",
					displayName: "Plugin Uno",
				},
			],
		}),
	);
	const p = path.join(mktDir, "plugins", "p1");
	fs.mkdirSync(path.join(p, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(p, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name: "p1", version: "1.0.0" }),
	);
	fs.mkdirSync(path.join(p, "skills", "p1"), { recursive: true });
	fs.writeFileSync(
		path.join(p, "skills", "p1", "SKILL.md"),
		"---\nname: p1\ndescription: d\n---\nC.\n",
	);
}

function fakePi() {
	const events = new Map<string, ((e: unknown, ctx: unknown) => Promise<unknown>)[]>();
	const commands = new Map<string, { handler: (a: string, c: unknown) => Promise<void> }>();
	return {
		events,
		commands,
		registerCommand: (
			n: string,
			o: { handler: (a: string, c: unknown) => Promise<void> },
		) => commands.set(n, o),
		on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => {
			const l = events.get(ev) ?? [];
			l.push(h);
			events.set(ev, l);
			return () => {};
		},
	};
}
function asApi(pi: ReturnType<typeof fakePi>): ExtensionAPI {
	return pi as unknown as ExtensionAPI;
}
function fakeCtx(cwd: string) {
	const notifications: [string, string?][] = [];
	return {
		notifications,
		cwd,
		ui: {
			notify: (m: string, l?: string) => notifications.push([m, l]),
			confirm: async () => true,
			setStatus: () => {},
			theme: { fg: () => "" },
		},
	};
}

/** Captura las peticiones del panel (sink fake). */
function fakeSink() {
	const requests: CcPanelRequest[] = [];
	const sink: CcPanelSink = (req) => {
		if (!req) return;
		requests.push(req);
	};
	return { requests, sink };
}

const fakePresenter = {
	append: () => {},
} satisfies CcPluginsPresenter;

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-pan-"));
	mktDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-mkt-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-ws-"));
	writeFixture();
});

afterEach(() => {
	for (const d of [agentDir, mktDir, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("frida-cc-plugins / panel nativo del webview", () => {
	it("list --available SIN sink: fallback a notify (back-compat)", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list --available", ctx);
		expect(ctx.notifications.some(([m]) => /p1@m/.test(m))).toBe(true);
	});

	it("list --available CON sink: panel con filas, versión y markdown", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const { requests, sink } = fakeSink();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fakePresenter,
			panel: sink,
		})(asApi(pi));
		await pi.commands
			.get("ccplugin")
			?.handler("list --available", fakeCtx(workDir));

		expect(requests).toHaveLength(1);
		const req = requests[0]!;
		expect(req.title).toMatch(/Disponibles \(1\)/);
		expect(req.rows[0]?.ref).toBe("p1@m");
		expect(req.rows[0]?.version).toBe("1.0.0");
		expect(req.rows[0]?.status).toBe("available");
		expect(req.rows[0]?.markdown).toContain("## p1 v1.0.0");
		expect(req.rows[0]?.markdown).toContain("**instalará**: 1 skills");
	});

	it("acción install del panel instala de verdad y REFRESCA con el mismo id", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const { requests, sink } = fakeSink();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fakePresenter,
			panel: sink,
		})(asApi(pi));
		await pi.commands
			.get("ccplugin")
			?.handler("list --available", fakeCtx(workDir));

		const req = requests[0]!;
		const msg = await req.actions.install("p1@m");
		expect(msg).toContain("instalado");
		// Realmente instalado:
		const reg = JSON.parse(
			fs.readFileSync(
				path.join(agentDir, "cc-plugins", "cc-plugins.json"),
				"utf-8",
			),
		);
		expect(reg.plugins["p1"]).toBeTruthy();
		// Refresh: segunda petición con el MISMO id y estado actualizado.
		expect(requests).toHaveLength(2);
		expect(requests[1]?.id).toBe(req.id);
		expect(requests[1]?.rows[0]?.status).toBe("installed");
	});

	it("toggle/uninstall vía acciones del panel (refs con @)", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await installPlugin(agentDir, "p1@m", { cwd: workDir });
		const { requests, sink } = fakeSink();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fakePresenter,
			panel: sink,
		})(asApi(pi));
		await pi.commands.get("ccplugin")?.handler("list", fakeCtx(workDir));

		const req = requests[0]!;
		expect(req.rows[0]?.status).toBe("installed");
		await req.actions.toggle("p1@m", false);
		expect(requests[1]?.rows[0]?.status).toBe("disabled");

		await req.actions.uninstall("p1@m");
		const reg = JSON.parse(
			fs.readFileSync(
				path.join(agentDir, "cc-plugins", "cc-plugins.json"),
				"utf-8",
			),
		);
		expect(reg.plugins["p1"]).toBeUndefined();
	});

	it("list instalados con sink: filas con scope y ficha markdown", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await installPlugin(agentDir, "p1@m", { cwd: workDir });
		const { requests, sink } = fakeSink();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fakePresenter,
			panel: sink,
		})(asApi(pi));
		await pi.commands.get("ccplugin")?.handler("list", fakeCtx(workDir));

		const req = requests[0]!;
		expect(req.title).toMatch(/Instalados \(1\)/);
		expect(req.rows[0]?.markdown).toContain("## p1 v1.0.0");
		expect(req.rows[0]?.markdown).toContain("scope user");
		expect(req.rows[0]?.markdown).toContain("**instalado**: 1 skills");
	});

	it("info <plugin> abre panel de fila única con la ficha", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const { requests, sink } = fakeSink();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fakePresenter,
			panel: sink,
		})(asApi(pi));
		await pi.commands.get("ccplugin")?.handler("info p1", fakeCtx(workDir));
		expect(requests).toHaveLength(1);
		expect(requests[0]?.rows).toHaveLength(1);
		expect(requests[0]?.rows[0]?.markdown).toContain("**instalará**: 1 skills");
	});
});
