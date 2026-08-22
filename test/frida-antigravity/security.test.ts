/**
 * frida-antigravity (#97) — seguridad del provider.
 *
 * Contratos críticos portados de pi-antigravity: los secretos NUNCA deben
 * salir en diagnósticos/errores (redactSecrets), el BASE_URL no puede
 * exfiltrar credenciales (SSRF) y el servidor de callback OAuth sólo
 * bindea loopback.
 */
import { describe, expect, it } from "vitest";
import {
	assertSafeApiBaseUrl,
	maskEmail,
	redactSecrets,
	resolveCallbackHost,
} from "../../src/providers/frida-antigravity/utils/security";

describe("frida-antigravity · redactSecrets", () => {
	it("bearer con key Authorization: el secreto nunca sobrevive", () => {
		// El valor se redacta por la regla key/valor (regla 5 dispara primero con
		// "Authorization:" como clave) — el placeholder exacto varía, el contrato
		// es que el token ya29.* NO aparece en la salida.
		const out = redactSecrets("Authorization: Bearer ya29.a0ARrdaM-abc123");
		expect(out).not.toContain("ya29.a0ARrdaM-abc123");
		expect(out).toContain("[redacted]");
	});

	it("token ya29 pelado (sin key) → [redacted-access-token]", () => {
		expect(redactSecrets("Bearer ya29.a0ARrdaM-abc123")).toBe(
			"Bearer [redacted-access-token]",
		);
	});

	it("refresh token de Google (1/…) en texto libre → [redacted-refresh-token]", () => {
		// Nota: el regex upstream es `1/` con UNA diagonal; `1//` lo esquiva pero
		// cae a la regla key=valor (siguiente test) — igual redactado.
		expect(redactSecrets("1/0gabcdefGHIJKLMNopqrstuv")).toBe(
			"[redacted-refresh-token]",
		);
	});

	it("refresh token con prefijo doble diagonal (1//) en contexto key=valor → redactado", () => {
		const out = redactSecrets("token=1//0gabcdefGHIJKLMNopqrstuv");
		expect(out).not.toContain("1//0gabcdefGHIJKLMNopqrstuv");
		expect(out).toContain("[redacted]");
	});

	it("redacta tokens en JSON (access_token/refresh_token/client_secret)", () => {
		const out = redactSecrets(
			'{"access_token":"SECRETVALUE","refresh_token":"1//0abc","client_secret":"sk-123"}',
		);
		expect(out).not.toContain("SECRETVALUE");
		expect(out).not.toContain("1//0abc");
		expect(out).not.toContain("sk-123");
	});

	it("mantiene el texto sin secretos intacto", () => {
		expect(redactSecrets("endpoint=cloudcode-pa.googleapis.com status=200")).toBe(
			"endpoint=cloudcode-pa.googleapis.com status=200",
		);
	});
});

describe("frida-antigravity · assertSafeApiBaseUrl (anti-SSRF)", () => {
	it("acepta el endpoint de producción", () => {
		expect(assertSafeApiBaseUrl("https://cloudcode-pa.googleapis.com")).toBe(
			"https://cloudcode-pa.googleapis.com",
		);
	});

	it("acepta subdominios sandbox de googleapis.com", () => {
		expect(
			assertSafeApiBaseUrl("https://daily-cloudcode-pa.sandbox.googleapis.com"),
		).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com");
	});

	it("rechaza http (no https)", () => {
		expect(() => assertSafeApiBaseUrl("http://cloudcode-pa.googleapis.com")).toThrow(
			/https/,
		);
	});

	it("rechaza hosts fuera de googleapis.com (exfiltración de token)", () => {
		expect(() => assertSafeApiBaseUrl("https://evil.example.com")).toThrow(
			/not allowed/,
		);
	});

	it("rechaza credenciales embebidas en la URL", () => {
		expect(() =>
			assertSafeApiBaseUrl("https://user:pass@cloudcode-pa.googleapis.com"),
		).toThrow(/credentials/);
	});
});

describe("frida-antigravity · resolveCallbackHost (loopback only)", () => {
	it("defaults a 127.0.0.1", () => {
		expect(resolveCallbackHost()).toBe("127.0.0.1");
	});

	it("normaliza localhost a 127.0.0.1 (DNS local hostil)", () => {
		expect(resolveCallbackHost("LocalHost")).toBe("127.0.0.1");
	});

	it("acepta ::1", () => {
		expect(resolveCallbackHost("::1")).toBe("::1");
	});

	it("rechaza hosts no-loopback (código OAuth robable off-machine)", () => {
		expect(() => resolveCallbackHost("0.0.0.0")).toThrow(/loopback/);
		expect(() => resolveCallbackHost("example.com")).toThrow(/loopback/);
	});
});

describe("frida-antigravity · maskEmail", () => {
	it("enmascara el nombre preservando dominio", () => {
		expect(maskEmail("edgar.fuentes@softtek.com")).toBe(
			"e***s@softtek.com",
		);
	});

	it("degrada sin romperse con emails malformados", () => {
		expect(maskEmail("no-email")).toBe("[redacted-email]");
		expect(maskEmail(undefined)).toBeUndefined();
	});
});
