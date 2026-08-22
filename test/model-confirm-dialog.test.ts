import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ModelConfirmDialog,
	type ModelConfirmTarget,
} from "../webview/components/ModelConfirmDialog";

describe("ModelConfirmDialog (Propuesta 1: Copilot Model Diff & Context Matrix)", () => {
	const current: ModelConfirmTarget = {
		provider: "anthropic",
		providerName: "Anthropic",
		modelId: "claude-3-5-sonnet-20241022",
		modelName: "Claude 3.5 Sonnet",
		contextWindow: 200_000,
		reasoning: false,
		input: ["text", "image"],
	};

	const target: ModelConfirmTarget = {
		provider: "openai",
		providerName: "OpenAI",
		modelId: "gpt-4o",
		modelName: "GPT-4o",
		contextWindow: 128_000,
		reasoning: true,
		input: ["text", "image"],
	};

	it("renderiza la comparación lado a lado del modelo actual vs nuevo", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ModelConfirmDialog, {
				current,
				target,
				onConfirm,
				onCancel,
			}),
		);

		expect(html).toContain("model-diff-overlay");
		expect(html).toContain("model-diff-card");
		expect(html).toContain("Confirmar cambio de modelo");
		// Columna Actual
		expect(html).toContain("ACTUAL");
		expect(html).toContain("Claude 3.5 Sonnet");
		expect(html).toContain("Anthropic");
		expect(html).toContain("200K");
		// Columna Nuevo
		expect(html).toContain("NUEVO");
		expect(html).toContain("GPT-4o");
		expect(html).toContain("OpenAI");
		expect(html).toContain("128K");
	});

	it("muestra advertencia cuando el nuevo modelo tiene menor ventana de contexto", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ModelConfirmDialog, {
				current,
				target, // 128K vs 200K actual
				onConfirm,
				onCancel,
			}),
		);

		expect(html).toContain("model-diff-warn");
		expect(html).toContain("menor");
	});

	it("muestra indicador de expansión cuando el nuevo modelo tiene mayor contexto", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const targetLarge: ModelConfirmTarget = {
			provider: "google",
			providerName: "Google Gemini",
			modelId: "gemini-1.5-pro",
			modelName: "Gemini 1.5 Pro",
			contextWindow: 1_000_000,
			reasoning: true,
		};
		const html = renderToStaticMarkup(
			React.createElement(ModelConfirmDialog, {
				current,
				target: targetLarge,
				onConfirm,
				onCancel,
			}),
		);

		expect(html).toContain("model-diff-gain");
		expect(html).toContain("1M");
	});

	it("renderiza los botones de acción para cancelar y confirmar", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ModelConfirmDialog, {
				current,
				target,
				onConfirm,
				onCancel,
			}),
		);

		expect(html).toContain("Cancelar");
		expect(html).toContain("Cambiar Modelo");
	});
});
