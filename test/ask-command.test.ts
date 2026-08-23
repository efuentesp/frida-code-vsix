import { describe, expect, it } from "vitest";
import { expandAskPrompt } from "../src/tools/ask-user-question-web";

describe("expandAskPrompt (/ask slash command)", () => {
	it("retorna prompt general cuando /ask no lleva argumentos", () => {
		const res = expandAskPrompt("/ask");
		expect(res).not.toBeNull();
		expect(res).toContain("ask_user_question");
		expect(res).toContain("2 a 4 opciones estructuradas");
		expect(res).toContain("Analiza el estado actual de la conversación");
	});

	it("retorna prompt general cuando /ask sólo lleva espacios en blanco", () => {
		const res = expandAskPrompt("/ask    ");
		expect(res).not.toBeNull();
		expect(res).toContain("ask_user_question");
		expect(res).toContain("Analiza el estado actual de la conversación");
	});

	it("retorna prompt específico con el tema cuando /ask lleva argumentos", () => {
		const res = expandAskPrompt("/ask ¿Qué base de datos deberíamos usar?");
		expect(res).not.toBeNull();
		expect(res).toContain("¿Qué base de datos deberíamos usar?");
		expect(res).toContain("ask_user_question");
		expect(res).toContain("2 a 4 opciones estructuradas");
	});

	it("limpia espacios al inicio y final del argumento", () => {
		const res = expandAskPrompt("/ask    arquitectura de microservicios vs monolito   ");
		expect(res).not.toBeNull();
		expect(res).toContain('"arquitectura de microservicios vs monolito"');
	});

	it("retorna null para comandos o textos que no son /ask", () => {
		expect(expandAskPrompt("hola mundo")).toBeNull();
		expect(expandAskPrompt("/asking algo")).toBeNull();
		expect(expandAskPrompt("/compact")).toBeNull();
		expect(expandAskPrompt("/skill:research")).toBeNull();
		expect(expandAskPrompt("¿Cómo estás? /ask")).toBeNull();
	});
});
