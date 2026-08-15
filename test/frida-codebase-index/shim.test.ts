// Tests del shim: captura vía registerTool (convención SDK execute(toolCallId,
// params, signal, onUpdate, ctx)), absorción de commands/events, Proxy get-trap,
// y loadUpstreamTools contra un entry .mjs REAL en temp (import() con
// pathToFileURL).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createCaptureShim,
  loadUpstreamTools,
} from "../../src/tools/frida-codebase-index/shim";

let tmp: string;

const FAKE_ENTRY = `
export default function (pi) {
  pi.registerTool({
    name: "codebase_search",
    description: "semantic search",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    async execute(toolCallId, params) {
      return { content: [{ type: "text", text: "id=" + toolCallId + " hit:" + params.query }] };
    },
  });
  pi.registerTool({
    name: "call_graph_path",
    async execute() { return { content: [{ type: "text", text: "path" }] }; },
  });
  pi.registerCommand("index", {});
  pi.on("session_start", async () => {});
  pi.setSessionName("oci-ok");
}
`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-shim-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createCaptureShim", () => {
  it("captura tools por nombre y absorbe commands/events sin crashear", () => {
    const shim = createCaptureShim();
    const api = shim.api as any;
    api.registerTool({
      name: "codebase_search",
      description: "s",
      parameters: { type: "object" },
      async execute() {},
    });
    api.registerTool({ name: "call_graph_path", async execute() {} });
    api.registerCommand("index", {});
    const unsub = api.on("session_start", async () => {});
    expect(typeof unsub).toBe("function");
    api.setSessionName("oci-ok");
    expect(shim.tools.size).toBe(2);
    expect(shim.tools.get("codebase_search")?.description).toBe("s");
    expect(shim.absorbed.commands).toEqual(["index"]);
    expect(shim.absorbed.events).toEqual(["session_start"]);
  });

  it("keys no implementadas devuelven undefined y se registran una sola vez", () => {
    const logs: string[] = [];
    const shim = createCaptureShim((l) => logs.push(l));
    expect((shim.api as any).projectRoot).toBeUndefined();
    expect((shim.api as any).projectRoot).toBeUndefined();
    expect(shim.absorbed.unknownKeys).toEqual(["projectRoot"]);
    expect(logs.filter((l) => l.includes("projectRoot"))).toHaveLength(1);
  });
});

describe("loadUpstreamTools", () => {
  it("importa un entry real (.mjs) y captura sus tools con la convención SDK", async () => {
    const entry = path.join(tmp, "pi-extension.mjs");
    fs.writeFileSync(entry, FAKE_ENTRY);
    const tools = await loadUpstreamTools(entry);
    expect(tools.size).toBe(2);
    const res = await tools
      .get("codebase_search")!
      .execute("id-1", { query: "hola" }, undefined, undefined, {});
    expect(res.content[0].text).toBe("id=id-1 hit:hola");
  });

  it("entry inexistente → CodebaseIndexLoadError", async () => {
    await expect(
      loadUpstreamTools(path.join(tmp, "no-existe.mjs")),
    ).rejects.toMatchObject({ name: "CodebaseIndexLoadError" });
  });

  it("entry sin factory → error con guía que menciona el pin", async () => {
    const entry = path.join(tmp, "not-a-factory.mjs");
    fs.writeFileSync(entry, "export default { not: 'a factory' };\n");
    await expect(loadUpstreamTools(entry)).rejects.toMatchObject({
      guide: expect.stringContaining("pin"),
    });
  });

  it("factory que lanza → error con guía de diagnóstico", async () => {
    const entry = path.join(tmp, "throws.mjs");
    fs.writeFileSync(
      entry,
      "export default function (pi) { throw new Error('boom'); }\n",
    );
    await expect(loadUpstreamTools(entry)).rejects.toMatchObject({
      guide: expect.stringContaining("keys no implementadas"),
    });
  });
});
