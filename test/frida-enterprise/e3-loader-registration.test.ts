// #91 E3: el wiring del padre NO dispara — provider-audit registró BASELINE/
// MANUAL (código de extension.ts directo al appender) pero CERO REQUEST en
// 388 mensajes, mientras softtek (pi.on del MISMO array, MISMO evento) sí
// dispara. El DefaultResourceLoader del SDK captura errores de factory EN
// SILENCIO (loadExtensionFactories catch → errors.push) — una factory que
// lanza se omite sin crash visible. Este test reproduce el REGISTRO REAL
// (loader + reload + getExtensions) para localizar la falla de raíz.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createProviderAuditHooks } from "../../src/providers/provider-audit";

describe("E3: registro real de frida-provider-audit vía DefaultResourceLoader", () => {
	it("la factory se registra sin error y SUS handlers quedan en el loader", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "e3-cwd-"));
		const agentDir = mkdtempSync(join(tmpdir(), "e3-agent-"));
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [
				{
					name: "frida-provider-audit",
					factory: createProviderAuditHooks({
						append: () => {},
						tag: () => "t",
					}),
				},
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		const { extensions, errors } = loader.getExtensions();
		// Diagnóstico: si hay errores de carga, el test los muestra —
		// el runner silencioso del loader es el sospechoso E3.
		const auditErrors = errors.filter((e) =>
			String(e.path).includes("frida-provider-audit"),
		);
		expect(auditErrors, JSON.stringify(auditErrors)).toEqual([]);
		const audit = extensions.find(
			(e) => e.path === "<inline:frida-provider-audit>",
		);
		expect(audit, "la extensión debe existir tras reload()").toBeDefined();
		const handlers = (audit as unknown as {
			handlers: Map<string, unknown[]>;
		}).handlers;
		expect(handlers.get("before_provider_request")).toHaveLength(1);
		expect(handlers.get("after_provider_response")).toHaveLength(1);
	});

	it("DIAGNÓSTICO: qué pasa cuando la factory lanza (el silencio del loader)", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "e3-cwd-"));
		const agentDir = mkdtempSync(join(tmpdir(), "e3-agent-"));
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [
				{
					name: "boom",
					factory: () => {
						throw new Error("kaboom");
					},
				},
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		// OJO: reload NO lanza — el error muere en extensionsResult.errors
		await expect(loader.reload()).resolves.toBeUndefined();
		const { extensions, errors } = loader.getExtensions();
		expect(extensions).toHaveLength(0);
		expect(errors[0]?.error).toMatch(/kaboom/);
	});
});
