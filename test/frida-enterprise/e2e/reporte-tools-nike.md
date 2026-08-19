# Reporte E2E tools — NIKE-VICTORY (reasoning: high)

**Fecha:** 2026-08-16 · **Endpoint:** `/v1/responses` · **Adapter:** `openai-responses` de pi-ai · **Identidad:** Bearer idToken (hook `buildFridaPayload`)

**Cómo correrlo:**
```bash
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-tools.e2e.test.ts
# Modelo alterno: FRIDA_ENTERPRISE_TOOLS_MODEL="SELENE-CIPHER"
```

## Resumen

- **Nivel A (ciclo real, tools core): 7/7 ✅** — función llama → args válidos → `execute()` real del SDK en sandbox → `function_call_output` → respuesta final que **usa** el resultado.
- **Nivel B (generación, tools host): 8/8 ✅** — `function_call` con arguments JSON válidos según schema real de `src/tools/*` (ejecución UI-bound, fuera del E2E CLI).

| Nivel | Tool | Resultado | Detalle | ms |
|---|---|---|---|---|
| A | read | ✅ | 2 hops · PIN leído y reportado | 3003 |
| A | write | ✅ | 2 hops · contenido verificado en disco | 2942 |
| A | edit | ✅ | 3 hops (read→edit) · config.txt verificado en disco | 4765 |
| A | bash | ✅ | 2 hops · `echo $((6*7))` → 42 en la respuesta | 2787 |
| A | grep | ✅ | 2 hops · identificó alpha.md | 2791 |
| A | find | ✅ | 2 hops · localizó tesoro.txt anidado | 2669 |
| A | ls | ✅ | 2 hops · listó alpha.md y beta.md | 2785 |
| B | ask_user_question | ✅ | questions[].question/header/options ✓ | 4405 |
| B | todo | ✅ | action:create, subject, status:pending ✓ | 1712 |
| B | context | ✅ | query:"componentes de tabla React" ✓ | 1331 |
| B | read_skills | ✅ | search:"commit messages" ✓ | 1331 |
| B | agent_browser | ✅ | url + job:{action:"get_title"} ✓ | 1434 |
| B | workflow | ✅ | name:"probe", script:"return 42;" ✓ | 1276 |
| B | get_subagent_result | ✅ | agent_id + wait:false ✓ | 1336 |
| B | steer_subagent | ✅ | agent_id + message ✓ | 1381 |

**Nota:** build/polish/vet (lanes internos de workflow, ver pipeline index) no se
exponen al modelo conversacional — fuera de la matriz por diseño.

## Hallazgos de la primera corrida (2 fallos → diagnóstico y resolución)

### 1. `edit`: "llamó read en vez de edit" — NO era un bug

**Síntoma:** primera corrida falló en fase `tool_call`: NIKE llamó `read(config.txt)`
antes que `edit`. **Diagnóstico:** comportamiento agentic correcto (leer antes de
editar); el E2E original sólo toleraba 1 tool-call. **Fix (aplicado):** mini-loop de
hasta 3 hops con `toolResult` real devuelto en cada hop (igual que el runner del
host). Resultado: edit ✅ con 3 hops. *No requiere cambio en src.*

### 2. `grep`/`find`: "rg/fd is not available and could not be downloaded" — bug REAL del entorno (aplica al host)

**Síntoma:** el modelo llamó grep/find correctamente (args válidos), pero `execute()`
falló: el SDK busca `rg`/`fd` en `getBinDir()` (`~/.frida/bin`) y luego en PATH —
ninguno existía, y el downloader automático (GitHub releases, timeout 10 s) falló
silenciosamente. **Impacto en el host:** frida code 0.18.0 tampoco los incluye →
**las tools grep/find del host están rotas en máquinas sin rg/fd preinstalados**
(WSL/codespaces corporativos típicos). El usuario nunca lo notó porque siempre usó
z.ai… con el mismo problema latente. **Fix aplicado aquí:** instalados
`ripgrep 14.1.1` y `fd 10.2.0` en `~/.frida/bin` (binDir que usa el SDK). Verificado:
grep ✅ find ✅.

**Propuesta permanente para el VSIX (no implementada — pendiente autorización):**
1. **Preferida:** bundlear `@vscode/ripgrep` + `fd-binaries` como deps del VSIX y
   resolver la ruta en `pi-session.ts` al crear el ModelRuntime (opciones
   `grep`/`find` de `createAllToolDefinitions` aceptan binPath custom), o
2. Descargar rg/fd al `activate()` del host (una vez, con UI de progreso y
   fallback claro si no hay red a GitHub), o
3. Mínimo: detectar la ausencia en el onboarding y mostrar instrucción
   ("instala ripgrep o ejecuta `frida.setupTools`").

### 3. Razonamiento alto observado

Con `reasoningEffort:"high"` los casos edit/grep/bash exhibieron thinking
(30–91 chars de summary por turno) — las tarjetas de pensamiento del webview
tienen contenido real vía `/v1/responses`. read/write/find/ls no generaron
summary en estos prompts triviales (el modelo decidió no razonar: `effort` es
un máximo, no una obligación).

## Evidencia de la cadena (por qué este E2E es fiel al host)

- Adapter `openai-responses` REAL de pi-ai (mismo bundle que el VSIX 0.18.0).
- `onPayload` = `buildFridaPayload` equivalente (developer→system, user_id,
  email, auto_log) — por RETORNO, como exige pi-ai.
- Tools core con `execute()` REAL (`createAllToolDefinitions(sandbox)`) y cwd sandbox.
- Round-trip con el formato interno de pi (`assistant.toolCall` + `toolResult`
  top-level) que el adapter convierte a `function_call`/`function_call_output`.
- Renovación de idToken vía securetoken idéntica al runtime.
