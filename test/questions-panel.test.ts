import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionsPanel } from "../webview/components/QuestionsPanel";
import type { WebQuestionSpec } from "../webview/types";

describe("QuestionsPanel (Propuesta 2: Flujo Conversacional con Historial de Respuestas)", () => {
	it("renderiza una pregunta única con codicons, badges numéricos y barra de atajos", () => {
		const questions: WebQuestionSpec[] = [
			{
				question: "¿Qué motor de base de datos utilizaremos?",
				header: "Base de datos",
				options: [
					{ label: "PostgreSQL", description: "Base de datos relacional estándar." },
					{ label: "SQLite", description: "Base embebida sin servidor." },
				],
			},
		];
		const onResult = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(QuestionsPanel, {
				questions,
				onResult,
			}),
		);

		expect(html).toContain("q-panel");
		expect(html).toContain("Base de datos");
		expect(html).toContain("¿Qué motor de base de datos utilizaremos?");
		expect(html).toContain("PostgreSQL");
		expect(html).toContain("Base de datos relacional estándar.");
		expect(html).toContain("SQLite");
		// Badges numéricos
		expect(html).toContain("q-opt-badge");
		expect(html).toContain("1");
		expect(html).toContain("2");
		// Barra de atajos
		expect(html).toContain("q-keys");
		expect(html).toContain("Navegar");
		expect(html).toContain("Seleccionar");
	});

	it("renderiza múltiples preguntas con indicador de paso", () => {
		const questions: WebQuestionSpec[] = [
			{
				question: "¿Qué método de autenticación?",
				header: "Autenticación",
				options: [
					{ label: "JWT", description: "Tokens firmados." },
					{ label: "OAuth", description: "Delegación externa." },
				],
			},
			{
				question: "¿Qué base de datos?",
				header: "Base de datos",
				options: [
					{ label: "PostgreSQL", description: "Relacional." },
					{ label: "MongoDB", description: "Documentos." },
				],
			},
		];
		const onResult = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(QuestionsPanel, {
				questions,
				onResult,
			}),
		);

		expect(html).toContain("Paso 1 de 2");
		expect(html).toContain("Autenticación");
		expect(html).toContain("Siguiente");
		expect(html).toContain("Cancelar");
	});

	it("renderiza preguntas de selección múltiple con indicador correspondiente", () => {
		const questions: WebQuestionSpec[] = [
			{
				question: "¿Qué características deseas habilitar?",
				header: "Características",
				multiSelect: true,
				options: [
					{ label: "Auth", description: "Módulo de autenticación." },
					{ label: "Logs", description: "Auditoría de eventos." },
					{ label: "Metrics", description: "Métricas de rendimiento." },
				],
			},
		];
		const onResult = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(QuestionsPanel, {
				questions,
				onResult,
			}),
		);

		expect(html).toContain("Selección múltiple");
		expect(html).toContain("Auth");
		expect(html).toContain("Logs");
		expect(html).toContain("Metrics");
	});

	it("renderiza panel de vista previa cuando una opción incluye preview", () => {
		const questions: WebQuestionSpec[] = [
			{
				question: "¿Qué formato de configuración?",
				header: "Config",
				options: [
					{
						label: "YAML",
						description: "Configuración legible.",
						preview: "```yaml\nversion: '3.8'\n```",
					},
					{
						label: "JSON",
						description: "Formato estructurado.",
						preview: "```json\n{\n  \"version\": \"3.8\"\n}\n```",
					},
				],
			},
		];
		const onResult = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(QuestionsPanel, {
				questions,
				onResult,
			}),
		);

		expect(html).toContain("q-with-preview");
		expect(html).toContain("q-preview");
	});

	it("renderiza textarea para respuesta personalizada con placeholder claro", () => {
		const questions: WebQuestionSpec[] = [
			{
				question: "¿Cuál es tu framework preferido?",
				header: "Framework",
				options: [
					{ label: "React", description: "UI library." },
					{ label: "Vue", description: "Progressive framework." },
				],
			},
		];
		const onResult = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(QuestionsPanel, {
				questions,
				onResult,
			}),
		);

		expect(html).toContain("q-input");
		expect(html).toContain("O escribe tu propia respuesta…");
	});
});
