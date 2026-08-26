import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourcesContent } from "../webview/components/ResourcesPanel";
import type { ResourceSummary } from "../webview/types";

describe("ResourcesContent (Propuesta 1: VS Code Resource Explorer & Action Hub)", () => {
	const mockResources: ResourceSummary = {
		extensions: [
			{
				path: "/home/user/.frida/extensions/frida-git.ts",
				inline: false,
				tools: ["git_status", "git_commit"],
				commands: ["sync"],
			},
		],
		skills: [
			{
				name: "commit",
				description: "Crear commits estructurados analizando diff.",
				source: "project",
				path: ".pi/skills/commit/SKILL.md",
			},
			{
				name: "diagnosing-bugs",
				description: "Diagnóstico sistemático de defectos.",
				source: "global",
				path: "/home/user/.frida/skills/diagnosing-bugs/SKILL.md",
			},
		],
		commands: [
			{
				name: "sync",
				description: "Sincroniza ramas y estado remoto.",
				argumentHint: "[rama]",
				source: "extension",
				extension: "frida-git",
			},
		],
		prompts: [
			{
				name: "review",
				description: "Prompt de revisión de código.",
			},
		],
		themes: [
			{
				name: "dark-plus",
			},
		],
		contextFiles: [
			{
				path: "/workspace/AGENTS.md",
			},
		],
		errors: [],
		modules: [],
	};

	it("renderiza secciones colapsables con Codicons y contadores", () => {
		const html = renderToStaticMarkup(
			React.createElement(ResourcesContent, {
				res: mockResources,
			}),
		);

		expect(html).toContain("resources-content");
		expect(html).toContain("Extensiones");
		expect(html).toContain("Skills");
		expect(html).toContain("Comandos");
		expect(html).toContain("Prompts");
		expect(html).toContain("Contexto");
		expect(html).toContain("Dónde se cargan");
	});

	it("renderiza badges de procedencia y botones de acción para Skills", () => {
		const html = renderToStaticMarkup(
			React.createElement(ResourcesContent, {
				res: mockResources,
			}),
		);

		expect(html).toContain("commit");
		expect(html).toContain("Crear commits estructurados");
		expect(html).toContain("diagnosing-bugs");
		expect(html).toContain("proyecto");
		expect(html).toContain("global");
		expect(html).toContain("Usar");
	});

	it("renderiza comandos con argumento hint y botón de inserción", () => {
		const html = renderToStaticMarkup(
			React.createElement(ResourcesContent, {
				res: mockResources,
			}),
		);

		expect(html).toContain("/sync");
		expect(html).toContain("[rama]");
		expect(html).toContain("frida-git");
		expect(html).toContain("Insertar");
	});

	it("renderiza archivos de contexto con botón para abrir", () => {
		const html = renderToStaticMarkup(
			React.createElement(ResourcesContent, {
				res: mockResources,
			}),
		);

		expect(html).toContain("AGENTS.md");
		expect(html).toContain("Abrir");
	});

	it("renderiza la guía de rutas con ubicaciones globales y de proyecto", () => {
		const html = renderToStaticMarkup(
			React.createElement(ResourcesContent, {
				res: mockResources,
			}),
		);

		expect(html).toContain("~/.frida/skills/");
		expect(html).toContain(".pi/skills/");
		expect(html).toContain("~/.frida/extensions/");
	});

	// Pruebas del filtro local (variante "filtro + resaltado")
	describe("Filtro y resaltado", () => {
		it("filtra por texto, resalta coincidencias y oculta secciones sin matches", () => {
			const html = renderToStaticMarkup(
				React.createElement(ResourcesContent, {
					res: mockResources,
					initialQuery: "commit",
				}),
			);

			// Barra de filtro presente (embudo, idioma VS Code)
			expect(html).toContain("cfg-filter-bar");
			expect(html).toContain("Filtrar recursos");
			// Contadores n/total mientras se filtra
			expect(html).toContain("1/1"); // Extensiones (tools incluye git_commit)
			expect(html).toContain("1/2"); // Skills
			// Resaltado de coincidencias (el mark envuelve sólo la subcadena)
			expect(html).toContain('<mark class="hl">commit</mark>');
			expect(html).toContain("git_<mark class=\"hl\">commit</mark>");
			// Secciones sin coincidencias se ocultan
			expect(html).not.toContain(">Comandos<");
			expect(html).not.toContain(">Prompts<");
			expect(html).not.toContain(">Themes<");
			expect(html).not.toContain(">Contexto");
			// La guía estática se oculta durante el filtrado
			expect(html).not.toContain("Dónde se cargan");
		});

		it("muestra estado vacío con acción de limpiar cuando nada coincide", () => {
			const html = renderToStaticMarkup(
				React.createElement(ResourcesContent, {
					res: mockResources,
					initialQuery: "zzz-sin-coincidencias",
				}),
			);

			expect(html).toContain("cfg-search-empty");
			expect(html).toContain("No hay recursos que coincidan");
			expect(html).toContain("Limpiar filtro");
			expect(html).not.toContain(">Skills<");
		});

		it("sin consulta conserva todas las secciones y sin resaltado", () => {
			const html = renderToStaticMarkup(
				React.createElement(ResourcesContent, { res: mockResources }),
			);

			expect(html).toContain(">Comandos<");
			expect(html).toContain(">Prompts<");
			expect(html).toContain("Dónde se cargan");
			expect(html).not.toContain("<mark");
		});
	});
});
