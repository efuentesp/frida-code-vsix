import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ElectronLaunchRegistry } from "../../../src/tools/frida-agent-browser/electron/registry";
import type { LaunchRecord } from "../../../src/tools/frida-agent-browser/electron/launch";

function mkRecord(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-r-"));
	return {
		launchId: `electron-test-${Math.random().toString(36).slice(2)}`,
		appName: "TestApp",
		executablePath: "/x/TestApp",
		platform: "darwin",
		port: 9222,
		userDataDir,
		targetType: "page",
		targets: [],
		cleanupState: "active",
		createdAtMs: Date.now(),
		...overrides,
	};
}

describe("ElectronLaunchRegistry — status", () => {
	it("register + statusOne/statusAll/statusActive", () => {
		const reg = new ElectronLaunchRegistry();
		const r = reg.register(mkRecord());
		expect(reg.statusOne(r.launchId)?.appName).toBe("TestApp");
		expect(reg.statusAll()).toHaveLength(1);
		expect(reg.statusActive()?.launchId).toBe(r.launchId);
	});
	it("soleActive sólo si hay exactamente uno activo", () => {
		const reg = new ElectronLaunchRegistry();
		expect(reg.soleActive()).toBeUndefined();
		const a = reg.register(mkRecord());
		expect(reg.soleActive()?.launchId).toBe(a.launchId);
		reg.register(mkRecord());
		expect(reg.soleActive()).toBeUndefined(); // 2 activos → no único
	});
	it("statusOne unknown → undefined", () => {
		expect(new ElectronLaunchRegistry().statusOne("nope")).toBeUndefined();
	});
});

describe("ElectronLaunchRegistry — probe", () => {
	it("probe con fetchFn mockeado", async () => {
		const reg = new ElectronLaunchRegistry();
		const r = reg.register(mkRecord({ port: 9223 }));
		const fetchFn = async (url: string) =>
			url.includes("/json/version")
				? { Browser: "Electron/1" }
				: [{ id: "t1", type: "page", url: "app://x" }];
		const probe = await reg.probe(r.launchId, fetchFn);
		expect(probe?.version?.browser).toBe("Electron/1");
		expect(probe?.targets).toHaveLength(1);
	});
	it("probe unknown launchId → undefined", async () => {
		expect(await new ElectronLaunchRegistry().probe("nope")).toBeUndefined();
	});
});

describe("ElectronLaunchRegistry — cleanup", () => {
	it("cleanupOne: child ausente → already-dead + rm userDataDir", async () => {
		const reg = new ElectronLaunchRegistry();
		const r = reg.register(mkRecord());
		const dir = r.userDataDir;
		const res = await reg.cleanupOne(r.launchId);
		expect(res?.process).toBe("already-dead");
		expect(res?.userDataDir).toBe("removed");
		expect(fs.existsSync(dir)).toBe(false);
		expect(reg.get(r.launchId)).toBeUndefined(); // desregistrado
	});
	it("cleanupAll limpia todos", async () => {
		const reg = new ElectronLaunchRegistry();
		const a = reg.register(mkRecord());
		const b = reg.register(mkRecord());
		const res = await reg.cleanupAll();
		expect(res).toHaveLength(2);
		expect(reg.list()).toHaveLength(0);
		expect(fs.existsSync(a.userDataDir)).toBe(false);
		expect(fs.existsSync(b.userDataDir)).toBe(false);
	});
});
