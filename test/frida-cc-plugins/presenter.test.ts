/**
 * frida-cc-plugins — tests del presenter de resultados (UX post-e2e #49):
 * routing multicapa (transcript + output + quickpick) con fallback a notify
 * cuando no hay presenter, y acciones del QuickPick (install/toggle/doc).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFridaCcPlugins } from "../../src/tools/frida-cc-plugins/index";
import {
	addMarketplace,
	installPlugin,
} from "../../src/tools/frida-cc-plugins/installer";
import type {
	CcListRow,
	CcPluginsPresenter,
} from "../../src/tools/frida-cc-plugins/presenter";

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
	const sent: { customType: string; content: string }[] = [];
	return {
		events,
		commands,
		sent,
		registerCommand: (
			n: string,
			o: { handler: (a: string, c: unknown) => Promise<void> },
		) => commands.set(n, o),
		on: (ev: string, h: (e: unknown, c: unknown) => Promise<unknown>) => {
			const l = events.get(ev) ?? [];
			l.push(h);
			events.set(ev, l);
			return () => {};
		},
		sendMessage: (m: { customType: string; content: string }) =>
			sent.push(m),
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

/** Presenter fake que captura las llamadas y simula selección/acción. */
function fakePresenter(pick: { label?: string; action?: string } = {}) {
	const appended: string[][] = [];
	const lists: { rows: CcListRow[]; title: string }[] = [];
	const docs: { title: string; markdown: string }[] = [];
	return {
		appended,
		lists,
		docs,
		presenter: {
			append: (lines: string[]) => appended.push(lines),
			interactiveList: async (
				rows: CcListRow[],
				actions: import("../../src/tools/frida-cc-plugins/presenter").CcListActions,
				title: string,
			) => {
				lists.push({ rows, title });
				const row = rows.find((r) => r.label === pick.label) ?? rows[0];
				if (!row) return;
				switch (pick.action ?? "Detalle (documento)") {
					case "Instalar":
						// Igual que el presenter real: notifica el resultado.
						actions.notify(await actions.install(row.ref));
						break;
					case "Desinstalar":
						actions.notify(await actions.uninstall(row.ref.split("@")[0]!));
						break;
					case "Habilitar":
						actions.notify(await actions.toggle(row.ref.split("@")[0]!, true));
						break;
					case "Deshabilitar":
						actions.notify(await actions.toggle(row.ref.split("@")[0]!, false));
						break;
					default:
						await actions.detailDoc(row.ref);
				}
			},
			document: async (title: string, markdown: string) =>
				docs.push({ title, markdown }),
		} satisfies CcPluginsPresenter,
	};
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-pres-"));
	mktDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-mkt-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-ws-"));
	writeFixture();
});

afterEach(() => {
	for (const d of [agentDir, mktDir, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("frida-cc-plugins / presenter multicapa", () => {
	it("list --available SIN presenter: fallback a notify (back-compat)", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list --available", ctx);
		expect(ctx.notifications.some(([m]) => /p1@m/.test(m))).toBe(true);
		expect(pi.sent.length).toBeGreaterThanOrEqual(1); // chat block igual sale
		expect(pi.sent[0]?.customType).toBe("frida.ccplugins");
	});

	it("list --available CON presenter: output + quickpick con filas", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const fp = fakePresenter();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fp.presenter,
		})(asApi(pi));
		await pi.commands
			.get("ccplugin")
			?.handler("list --available", fakeCtx(workDir));

		expect(fp.appended.length).toBeGreaterThanOrEqual(1);
		expect(fp.appended[0]?.[0]).toBe("$ ccplugin list --available");
		expect(fp.lists).toHaveLength(1);
		const row = fp.lists[0]?.rows[0];
		expect(row?.label).toBe("p1@m");
		expect(row?.installed).toBe(false);
		expect(row?.ref).toBe("p1@m");
		// Sin acción de instalación elegida → no registrado.
	});

	it("QuickPick 'Instalar' instala de verdad y notifica", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const fp = fakePresenter({ action: "Instalar" });
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fp.presenter,
		})(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list --available", ctx);
		const reg = JSON.parse(
			fs.readFileSync(
				path.join(agentDir, "cc-plugins", "cc-plugins.json"),
				"utf-8",
			),
		);
		expect(reg.plugins["p1"]).toBeTruthy();
		expect(ctx.notifications.some(([m]) => /instalado/.test(m))).toBe(true);
	});

	it("QuickPick 'Detalle (documento)' abre markdown con inventario", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const fp = fakePresenter({ action: "Detalle (documento)" });
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fp.presenter,
		})(asApi(pi));
		await pi.commands
			.get("ccplugin")
			?.handler("list --available", fakeCtx(workDir));
		expect(fp.docs).toHaveLength(1);
		expect(fp.docs[0]?.markdown).toContain("p1@m v1.0.0");
		expect(fp.docs[0]?.markdown).toContain("instalará");
	});

	it("list instalados con presenter: filas con estado y acciones", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await installPlugin(agentDir, "p1@m", { cwd: workDir });
		const fp = fakePresenter({ label: "p1@m", action: "Deshabilitar" });
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fp.presenter,
		})(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list", ctx);
		const row = fp.lists[0]?.rows[0];
		expect(row?.installed).toBe(true);
		expect(row?.enabled).toBe(true);
		// La acción deshabilitó el plugin real.
		const reg = JSON.parse(
			fs.readFileSync(
				path.join(agentDir, "cc-plugins", "cc-plugins.json"),
				"utf-8",
			),
		);
		expect(reg.plugins["p1"]?.enabled).toBe(false);
	});

	it("info con presenter abre documento (pre-install)", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const fp = fakePresenter();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			presenter: fp.presenter,
		})(asApi(pi));
		await pi.commands.get("ccplugin")?.handler("info p1", fakeCtx(workDir));
		expect(fp.docs).toHaveLength(1);
		expect(fp.docs[0]?.markdown).toMatch(/instalará\*?\*?: 1 skills/);
	});
});
