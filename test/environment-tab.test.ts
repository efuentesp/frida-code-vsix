import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentTab } from "../webview/components/EnvironmentTab";
import { SettingsHub } from "../webview/components/SettingsHub";
import type { EnvironmentReport, State } from "../webview/types";

describe("EnvironmentTab (Opción 1: Diagnostic Checklist & Matrix)", () => {
	const mockReport: EnvironmentReport = {
		platform: "win32",
		platformLabel: "Windows",
		arch: "x64",
		checkedAt: Date.now(),
		readyCount: 4,
		totalCount: 6,
		coreReady: true,
		dependencies: [
			{
				id: "git",
				name: "Git",
				category: "core",
				installed: true,
				version: "2.44.0.windows.1",
				description: "Control de versiones, worktrees y respaldo automático.",
				usedBy: "Core, Worktrees, Git Sync, Pipeline AIDD",
				installGuides: {
					win32: { command: "winget install --id Git.Git -e --source winget" },
					darwin: { command: "brew install git" },
					linux: { command: "sudo apt install git" },
				},
			},
			{
				id: "bash",
				name: "Git Bash Shell",
				category: "core",
				installed: true,
				version: "5.2.26",
				description: "Intérprete de comandos y ejecución de herramientas del agente.",
				usedBy: "Core (Tool bash, Subagents)",
				installGuides: {
					win32: { command: "winget install --id Git.Git -e --source winget" },
					darwin: { command: "# Ya incluido en macOS" },
					linux: { command: "sudo apt install bash" },
				},
			},
			{
				id: "node_npm",
				name: "Node.js & npm",
				category: "extension",
				installed: false,
				description: "Motor JavaScript y gestor de paquetes.",
				usedBy: "Tab Index (búsqueda semántica) y Base de Conocimiento",
				installGuides: {
					win32: { command: "winget install OpenJS.NodeJS.LTS" },
					darwin: { command: "brew install node" },
					linux: { command: "sudo apt install nodejs npm" },
				},
			},
			{
				id: "gh",
				name: "GitHub CLI (gh)",
				category: "extension",
				installed: true,
				version: "v2.45.0",
				notes: "Autenticado en GitHub",
				description: "Gestión de issues y flujos AIDD.",
				usedBy: "Gestión de issues, Flujos AIDD",
				installGuides: {
					win32: { command: "winget install --id GitHub.cli" },
					darwin: { command: "brew install gh" },
					linux: { command: "sudo apt install gh" },
				},
			},
			{
				id: "agent_browser",
				name: "agent-browser (Vercel Labs)",
				category: "optional",
				installed: false,
				description: "Automatización de navegador real.",
				usedBy: "Tool agent_browser",
				installGuides: {
					win32: { command: "npm install -g agent-browser" },
					darwin: { command: "npm install -g agent-browser" },
					linux: { command: "npm install -g agent-browser" },
				},
			},
			{
				id: "docker",
				name: "Docker Desktop / Engine",
				category: "optional",
				installed: true,
				version: "v26.0.0",
				notes: "Daemon activo y listo",
				description: "Contenedores para ejecución aislada.",
				usedBy: "Sandboxes aislados",
				installGuides: {
					win32: { command: "winget install Docker.DockerDesktop" },
					darwin: { command: "brew install --cask docker" },
					linux: { command: "sudo apt install docker.io" },
				},
			},
		],
	};

	const baseState: State = {
		keyNeeded: false,
		busy: false,
		mode: "manual",
		turns: [],
		approvals: [],
		modelChanges: [],
		uiRequests: [],
		queued: [],
		isCompacting: false,
		compactions: [],
		branchSummaries: [],
		nextId: 1,
		environment: mockReport,
	};

	it("renderiza el banner de salud superior con métricas y SO detectado", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(EnvironmentTab, { state: baseState, post }),
		);

		expect(html).toContain("cfg-env-banner");
		expect(html).toContain("Estado del Sistema: 4 de 6 dependencias listas");
		expect(html).toContain("Windows");
		expect(html).toContain("x64");
		expect(html).toContain("Núcleo 100% Operativo");
		expect(html).toContain("Re-verificar");
	});

	it("separa las dependencias en Núcleo Requerido vs Extensiones y Módulos", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(EnvironmentTab, { state: baseState, post }),
		);

		expect(html).toContain("NÚCLEO REQUERIDO");
		expect(html).toContain("EXTENSIONES Y MÓDULOS");

		// Core
		expect(html).toContain("Git");
		expect(html).toContain("Git Bash Shell");

		// Extensiones
		expect(html).toContain("Node.js &amp; npm");
		expect(html).toContain("GitHub CLI (gh)");
		expect(html).toContain("agent-browser (Vercel Labs)");
		expect(html).toContain("Docker Desktop / Engine");
	});

	it("renderiza badges de estado (instalado vs no instalado) y comandos de instalación", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(EnvironmentTab, { state: baseState, post }),
		);

		expect(html).toContain("v2.44.0.windows.1");
		expect(html).toContain("No instalado");
		expect(html).toContain("winget install OpenJS.NodeJS.LTS");
		expect(html).toContain("Autenticado en GitHub");
		expect(html).toContain("Daemon activo y listo");
	});

	it("renderiza badge 'No encontrado' de error crítico cuando falta una dependencia del núcleo", () => {
		const post = vi.fn();
		const stateWithMissingCore: State = {
			...baseState,
			environment: {
				...mockReport,
				coreReady: false,
				dependencies: mockReport.dependencies.map((d) =>
					d.id === "bash" ? { ...d, installed: false } : d,
				),
			},
		};
		const html = renderToStaticMarkup(
			React.createElement(EnvironmentTab, { state: stateWithMissingCore, post }),
		);

		expect(html).toContain("No encontrado");
		expect(html).toContain("is-critical");
		expect(html).toContain("Falta Núcleo Requerido");
	});

	it("SettingsHub incluye la pestaña de Entorno y la abre correctamente", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: baseState,
				post,
				onClose,
				initialTab: "environment",
			}),
		);

		expect(html).toContain("Entorno");
		expect(html).toContain("cfg-environment");
		expect(html).toContain("Estado del Sistema: 4 de 6 dependencias listas");
	});

	it("SettingsHub busca dependencias de entorno en la barra de búsqueda global", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: baseState,
				post,
				onClose,
				initialTab: "environment",
			}),
		);

		expect(html).toContain("cfg-search-bar");
	});
});
