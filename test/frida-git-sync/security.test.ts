// frida-git-sync — tests de system/security (secret scanning + hard deny).
//
// Cubre: scanSecrets (GitHub/OpenAI/Anthropic/AWS/JWT/private key), isDenied,
// findDeniedFiles.

import { describe, it, expect } from "vitest";
import {
	scanSecrets,
	isDenied,
	findDeniedFiles,
} from "../../src/tools/frida-git-sync/src/system/security";

describe("frida-git-sync / security", () => {
	describe("scanSecrets", () => {
		it("detecta un GitHub token (ghp_)", () => {
			const findings = scanSecrets(
				`token = "ghp_${"a".repeat(36)}"`,
				"config.json",
			);
			expect(findings.some((f) => f.type === "GitHub Token")).toBe(true);
			expect(findings[0]?.file).toBe("config.json");
			expect(findings[0]?.line).toBe(1);
		});

		it("detecta una OpenAI API key (sk-)", () => {
			const findings = scanSecrets(`OPENAI_API_KEY=sk-${"b".repeat(32)}`, ".env");
			expect(findings.some((f) => f.type === "OpenAI API Key")).toBe(true);
		});

		it("detecta una Anthropic API key (sk-ant-)", () => {
			const findings = scanSecrets(`key: sk-ant-${"c".repeat(32)}`, "x");
			expect(findings.some((f) => f.type === "Anthropic API Key")).toBe(true);
		});

		it("detecta un AWS Access Key (AKIA...)", () => {
			const findings = scanSecrets(`aws_access_key_id = AKIA${"0".repeat(16)}`, "x");
			expect(findings.some((f) => f.type === "AWS Access Key")).toBe(true);
		});

		it("detecta una private key PEM", () => {
			const findings = scanSecrets(
				"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...",
				"id_rsa",
			);
			expect(findings.some((f) => f.type === "Private Key")).toBe(true);
		});

		it("detecta un JWT", () => {
			const findings = scanSecrets(
				`auth: eyJ${"d".repeat(12)}.${"e".repeat(12)}.${"f".repeat(12)}`,
				"x",
			);
			expect(findings.some((f) => f.type === "JWT Token")).toBe(true);
		});

		it("AWS Secret Key requiere contexto (sin contexto → no detecta)", () => {
			// 40 chars base64 sin contexto aws/amazon → no debe reportar.
			const blob = "x".repeat(40);
			expect(scanSecrets(`data = ${blob}`, "x")).toEqual([]);
		});

		it("texto limpio no produce hallazgos", () => {
			expect(scanSecrets('{"defaultModel": "glm-5.2"}', "settings.json")).toEqual([]);
		});
	});

	describe("isDenied", () => {
		it("true para paths del hard-deny", () => {
			expect(isDenied("auth.json")).toBe(true);
			expect(isDenied("sessions/abc/def")).toBe(true);
			expect(isDenied("models-store.json")).toBe(true);
			expect(isDenied("node_modules/foo/index.js")).toBe(true);
			expect(isDenied("secrets/.env")).toBe(true);
			expect(isDenied("keys/id_rsa")).toBe(true);
		});

		it("false para paths permitidos", () => {
			expect(isDenied("settings.json")).toBe(false);
			expect(isDenied("skills/commit.md")).toBe(false);
		});
	});

	describe("findDeniedFiles", () => {
		it("filtra dejando solo los denied", () => {
			const denied = findDeniedFiles([
				"settings.json",
				"auth.json",
				"skills/commit.md",
				"node_modules/x",
			]);
			expect(denied).toEqual(["auth.json", "node_modules/x"]);
		});
	});
});
