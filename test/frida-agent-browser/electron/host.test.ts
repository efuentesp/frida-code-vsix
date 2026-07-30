import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { runElectronAction } from "../../../src/tools/frida-agent-browser/electron/host";
import { ElectronLaunchRegistry } from "../../../src/tools/frida-agent-browser/electron/registry";
import type { DiscoveredApp } from "../../../src/tools/frida-agent-browser/electron/discovery";

/** spawn fake: escribe DevToolsActivePort en el --user-data-dir y devuelve un child vivo. */
function fakeSpawnWritingPort(port: number) {
	return (_cmd: string, args: string[], _opts: unknown) => {
		const udArg = (args as string[]).find((a) =>
			a.startsWith("--user-data-dir="),
		);
		if (udArg) {
			const ud = udArg.slice("--user-data-dir=".length);
			fs.mkdirSync(ud, { recursive: true });
			fs.writeFileSync(
				path.join(ud, "DevToolsActivePort"),
				`${port}\n/devtools/browser/fake`,
			);
		}
		const child = new EventEmitter() as EventEmitter & {
			pid: number;
			exitCode: null;
			signalCode: null;
			kill: () => void;
		};
		child.pid = 4242;
		child.exitCode = null;
		child.signalCode = null;
		child.kill = () => {};
		return child;
	};
}

const fakeApps: DiscoveredApp[] = [
	{
		name: "CodeApp",
		appPath: "/Applications/CodeApp.app",
		bundleId: "com.x.code",
		executablePath: "/Applications/CodeApp.app/Contents/MacOS/CodeApp",
		platform: "darwin",
	},
];

describe("runElectronAction — list", () => {
	it("list con listFn mockeado", async () => {
		const reg = new ElectronLaunchRegistry();
		const r = await runElectronAction(
			{ action: "list" },
			{ registry: reg, cwd: process.cwd(), listFn: async () => fakeApps },
		);
		expect(r.isError).toBe(false);
		expect(r.content[0].text).toMatch(/1 Electron app found/);
		expect(r.content[0].text).toMatch(/CodeApp/);
		expect(r.content[0].text).toMatch(/com\.x\.code/);
	});
	it("list vacío", async () => {
		const r = await runElectronAction(
			{ action: "list" },
			{
				registry: new ElectronLaunchRegistry(),
				cwd: process.cwd(),
				listFn: async () => [],
			},
		);
		expect(r.content[0].text).toMatch(/No Electron apps found/);
	});
});

describe("runElectronAction — launch", () => {
	it("target-not-found (appName no descubierto)", async () => {
		const r = await runElectronAction(
			{
				action: "launch",
				appName: "Ghost",
				handoff: "snapshot",
				targetType: "page",
			},
			{
				registry: new ElectronLaunchRegistry(),
				cwd: process.cwd(),
				listFn: async () => fakeApps,
			},
		);
		expect(r.isError).toBe(true);
		expect((r.details as { failure: string }).failure).toBe("target-not-found");
	});

	it("launch exitoso (appPath directo + spawnFn + fetchFn + connectFn)", async () => {
		const reg = new ElectronLaunchRegistry();
		let connected = false;
		const r = await runElectronAction(
			{
				action: "launch",
				appPath: "/Applications/RealApp.app/Contents/MacOS/RealApp",
				handoff: "snapshot",
				targetType: "page",
			},
			{
				registry: reg,
				cwd: process.cwd(),
				spawnFn: fakeSpawnWritingPort(9229) as never,
				fetchFn: (async (url: string) =>
					url.includes("/json/version")
						? { Browser: "Electron/99" }
						: []) as never,
				connectFn: async () => {
					connected = true;
				},
			},
		);
		expect(r.isError).toBe(false);
		expect(r.content[0].text).toMatch(/Launched/);
		expect(
			(r.details as { launch: { port: number; connected: boolean } }).launch
				.port,
		).toBe(9229);
		expect(
			(r.details as { launch: { connected: boolean } }).launch.connected,
		).toBe(true);
		expect(connected).toBe(true);
		expect(reg.list()).toHaveLength(1);
		// cleanup para no dejar procesos/temp
		await reg.cleanupAll();
	});
});

describe("runElectronAction — status/cleanup/probe", () => {
	it("status vacío", async () => {
		const r = await runElectronAction(
			{ action: "status" },
			{ registry: new ElectronLaunchRegistry(), cwd: process.cwd() },
		);
		expect(r.content[0].text).toMatch(/No Electron launches tracked/);
	});

	it("probe sin launches → error", async () => {
		const r = await runElectronAction(
			{ action: "probe" },
			{ registry: new ElectronLaunchRegistry(), cwd: process.cwd() },
		);
		expect(r.isError).toBe(true);
	});

	it("flujo launch→status→cleanup completo", async () => {
		const reg = new ElectronLaunchRegistry();
		await runElectronAction(
			{
				action: "launch",
				executablePath: "/x/App",
				handoff: "snapshot",
				targetType: "page",
			},
			{
				registry: reg,
				cwd: process.cwd(),
				spawnFn: fakeSpawnWritingPort(9311) as never,
				fetchFn: (async () => ({ Browser: "E" })) as never,
			},
		);
		const status = await runElectronAction(
			{ action: "status", all: true },
			{ registry: reg, cwd: process.cwd() },
		);
		expect(status.content[0].text).toMatch(/port 9311/);
		const cleanup = await runElectronAction(
			{ action: "cleanup", all: true },
			{ registry: reg, cwd: process.cwd() },
		);
		expect(cleanup.content[0].text).toMatch(/Cleaned up 1 launch/);
		expect(reg.list()).toHaveLength(0);
	});
});
