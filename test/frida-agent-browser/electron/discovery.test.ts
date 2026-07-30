import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	inspectDarwinApp,
	listElectronApps,
} from "../../../src/tools/frida-agent-browser/electron/discovery";

function mkdirp(p: string) {
	fs.mkdirSync(p, { recursive: true });
}

describe("inspectDarwinApp", () => {
	it("Electron app válida (framework + app.asar + plist) → record", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-e-"));
		const app = path.join(dir, "MyApp.app");
		mkdirp(
			path.join(app, "Contents", "Frameworks", "Electron Framework.framework"),
		);
		mkdirp(path.join(app, "Contents", "Resources"));
		fs.writeFileSync(path.join(app, "Contents", "Resources", "app.asar"), "");
		mkdirp(path.join(app, "Contents", "MacOS"));
		fs.writeFileSync(path.join(app, "Contents", "MacOS", "MyApp"), "");
		fs.writeFileSync(
			path.join(app, "Contents", "Info.plist"),
			`<plist><dict>
				<key>CFBundleName</key><string>MyApp</string>
				<key>CFBundleIdentifier</key><string>com.example.myapp</string>
				<key>CFBundleExecutable</key><string>MyApp</string>
			</dict></plist>`,
		);
		const r = await inspectDarwinApp(app);
		expect(r).toBeDefined();
		expect(r!.name).toBe("MyApp");
		expect(r!.bundleId).toBe("com.example.myapp");
		expect(r!.executablePath).toBe(
			path.join(app, "Contents", "MacOS", "MyApp"),
		);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("NO Electron (sin Electron Framework) → undefined", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-e-"));
		const app = path.join(dir, "NotElectron.app");
		mkdirp(path.join(app, "Contents", "Resources"));
		fs.writeFileSync(path.join(app, "Contents", "Resources", "app.asar"), "");
		expect(await inspectDarwinApp(app)).toBeUndefined();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("listElectronApps", () => {
	it("escanea directorios override + filtra por query + cap", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-e-"));
		const mkApp = (name: string) => {
			const app = path.join(dir, `${name}.app`);
			mkdirp(
				path.join(
					app,
					"Contents",
					"Frameworks",
					"Electron Framework.framework",
				),
			);
			mkdirp(path.join(app, "Contents", "Resources"));
			fs.writeFileSync(path.join(app, "Contents", "Resources", "app.asar"), "");
			mkdirp(path.join(app, "Contents", "MacOS"));
			fs.writeFileSync(path.join(app, "Contents", "MacOS", name), "");
		};
		mkApp("AlphaApp");
		mkApp("BetaApp");
		mkdirp(path.join(dir, "Plain.app", "Contents", "Resources")); // no framework

		const all = await listElectronApps({
			darwinApplicationDirectories: [dir],
			linuxApplicationDirectories: [dir],
		});
		expect(all.length).toBe(2);
		const filtered = await listElectronApps({
			query: "alpha",
			darwinApplicationDirectories: [dir],
			linuxApplicationDirectories: [dir],
		});
		expect(filtered.length).toBe(1);
		expect(filtered[0].name).toBe("AlphaApp");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("maxResults acota", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-e-"));
		for (const name of ["A", "B", "C"]) {
			const app = path.join(dir, `${name}.app`);
			mkdirp(
				path.join(
					app,
					"Contents",
					"Frameworks",
					"Electron Framework.framework",
				),
			);
			mkdirp(path.join(app, "Contents", "Resources"));
			fs.writeFileSync(path.join(app, "Contents", "Resources", "app.asar"), "");
			mkdirp(path.join(app, "Contents", "MacOS"));
			fs.writeFileSync(path.join(app, "Contents", "MacOS", name), "");
		}
		const r = await listElectronApps({
			maxResults: 2,
			darwinApplicationDirectories: [dir],
			linuxApplicationDirectories: [dir],
		});
		expect(r.length).toBe(2);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
