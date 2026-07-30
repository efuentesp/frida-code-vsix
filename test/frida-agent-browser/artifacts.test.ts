import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildArtifactVerificationSummary,
	ensureArtifactParentDirs,
	extractRequestedPaths,
	getArtifactKind,
	getSavedPath,
	isArtifactCommand,
	verifyArtifactFiles,
} from "../../src/tools/frida-agent-browser/results/artifacts";
import { presentAgentBrowserResult } from "../../src/tools/frida-agent-browser/results/presentation";

describe("getArtifactKind / isArtifactCommand", () => {
	it("mapea comandos a kind", () => {
		expect(getArtifactKind("screenshot", ["screenshot", "x.png"])).toBe(
			"image",
		);
		expect(getArtifactKind("pdf", ["pdf", "x.pdf"])).toBe("pdf");
		expect(getArtifactKind("download", ["download", "@e1", "d.zip"])).toBe(
			"download",
		);
		expect(getArtifactKind("record", ["record", "x.webm"])).toBe("video");
		expect(getArtifactKind("wait", ["wait", "--download", "p"])).toBe(
			"download",
		);
		expect(
			getArtifactKind("network", ["network", "har", "start", "h.har"]),
		).toBe("har");
		expect(getArtifactKind("snapshot", ["snapshot", "-i"])).toBeUndefined();
		expect(getArtifactKind("open", ["open", "x"])).toBeUndefined();
	});
	it("isArtifactCommand", () => {
		expect(isArtifactCommand("screenshot", ["screenshot", "x.png"])).toBe(true);
		expect(isArtifactCommand("snapshot", ["snapshot", "-i"])).toBe(false);
	});
});

describe("extractRequestedPaths", () => {
	it("screenshot path", () => {
		expect(extractRequestedPaths(["screenshot", "/tmp/x.png"])).toEqual([
			"/tmp/x.png",
		]);
	});
	it("download: selector no es path, path sí", () => {
		expect(extractRequestedPaths(["download", "@e1", "./d.zip"])).toEqual([
			"./d.zip",
		]);
	});
	it("wait --download <path>", () => {
		expect(
			extractRequestedPaths(["wait", "--download", "/p/file.zip"]),
		).toEqual(["/p/file.zip"]);
	});
	it("sin path → []", () => {
		expect(extractRequestedPaths(["screenshot"])).toEqual([]);
	});
});

describe("getSavedPath", () => {
	it("data.path", () => {
		expect(getSavedPath({ path: "/abs/x.png" })).toBe("/abs/x.png");
	});
	it("data.file fallback", () => {
		expect(getSavedPath({ file: "/abs/y.pdf" })).toBe("/abs/y.pdf");
	});
	it("rechaza esquemas no-file", () => {
		expect(getSavedPath({ path: "data:image/png;base64,..." })).toBeUndefined();
	});
	it("undefined si nada", () => {
		expect(getSavedPath({ title: "x" })).toBeUndefined();
	});
});

describe("verifyArtifactFiles + summary", () => {
	it("verifica real (exists→verified+size; missing→missing)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-a-"));
		const exists = path.join(dir, "a.png");
		fs.writeFileSync(exists, "hello");
		const entries = verifyArtifactFiles({
			cwd: dir,
			savedPath: exists,
			requestedPaths: [path.join(dir, "missing.pdf")],
			kind: "image",
		});
		const summary = buildArtifactVerificationSummary(entries)!;
		expect(summary.verifiedCount).toBe(1);
		expect(summary.missingCount).toBe(1);
		expect(summary.verified).toBe(false);
		const v = entries.find((e) => e.state === "verified")!;
		expect(v.sizeBytes).toBe(5);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("summary undefined si no hay entradas", () => {
		expect(buildArtifactVerificationSummary([])).toBeUndefined();
	});

	it("dedupe savedPath y requested iguales", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-b-"));
		const f = path.join(dir, "x.png");
		fs.writeFileSync(f, "x");
		const entries = verifyArtifactFiles({
			cwd: dir,
			savedPath: f,
			requestedPaths: [f],
			kind: "image",
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].state).toBe("verified");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("presentAgentBrowserResult ↔ artifacts (integración)", () => {
	it("screenshot guardado → artifactVerification + successCategory artifact-saved + texto", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-p-"));
		const f = path.join(dir, "shot.png");
		fs.writeFileSync(f, "abc");
		const r = presentAgentBrowserResult({
			envelope: { success: true, data: { path: f }, error: null } as never,
			stdout: JSON.stringify({ success: true, data: { path: f } }),
			stderr: "",
			exitCode: 0,
			mode: "args",
			args: ["screenshot", f],
			sessionName: "s",
			cwd: dir,
		});
		const d = r.details as {
			successCategory: string;
			artifactVerification: { verifiedCount: number; verified: boolean };
		};
		expect(d.successCategory).toBe("artifact-saved");
		expect(d.artifactVerification.verifiedCount).toBe(1);
		expect(d.artifactVerification.verified).toBe(true);
		expect(r.content[0].text).toMatch(/Saved image/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("screenshot reportado pero ausente en disco → missing + warning", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-q-"));
		const f = path.join(dir, "gone.png"); // no se escribe
		const r = presentAgentBrowserResult({
			envelope: { success: true, data: { path: f }, error: null } as never,
			stdout: JSON.stringify({ success: true, data: { path: f } }),
			stderr: "",
			exitCode: 0,
			mode: "args",
			args: ["screenshot", f],
			sessionName: "s",
			cwd: dir,
		});
		const d = r.details as {
			successCategory: string;
			artifactVerification: { missingCount: number; verified: boolean };
		};
		expect(d.successCategory).toBe("artifact-unverified");
		expect(d.artifactVerification.missingCount).toBe(1);
		expect(d.artifactVerification.verified).toBe(false);
		expect(r.content[0].text).toMatch(/WARNING/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("ensureArtifactParentDirs", () => {
	it("crea directorios padre", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-c-"));
		const target = path.join(dir, "sub", "deep", "out.png");
		ensureArtifactParentDirs(dir, [target]);
		expect(fs.existsSync(path.dirname(target))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});
	it("ignora esquemas no-file", () => {
		expect(ensureArtifactParentDirs("/tmp", ["data:blob"])).toEqual([]);
	});
});
