# `frida-pipeline` — orquestador nativo de skills/workflows (porte de `rpiv-pi`)

**Estado:** aceptado (Fase 0 cerrada; ver §Decisiones D1–D7).

Se añade el **orquestador** que ata a las 5 extensiones nativas ya existentes
(`frida-workflow`, `frida-args`, `frida-context`, `frida-permission-system`,
`frida-agent-browser`) y aporta las piezas que faltan para llegar a paridad
funcional con `@juicesharp/rpiv-pi`:

- 27 skills tipadas (frontmatter con `contract: { produces, consumes }`).
- 15 subagentes `.md` (sincronizados con sha256 a un agentDir global).
- 3 workflows pre-construidos: `build`, `vet`, `polish`.
- Hooks invisibles: guidance recursiva, git-context, pipeline pointer.
- Models picker con override por skill/stage/preset.
- Banner de "siblings OK / missing" al iniciar.
- Artefactos en `.frida/artifacts/` (no `.rpiv/`).

Sigue el patrón de **porte nativo** establecido en D14/D15/D27/D28/ADR-0020:
cero dependencias npm nuevas, reusa SDK de Pi ya embebido, código propio en
`src/tools/frida-pipeline/`. No reabre ADR-0005 (descubrimiento de extensión
ajena).

Análisis completo en
[`.rpiv/artifacts/discover/2025-07-31_frida-pipeline-porter-rpiv-pi.md`](../../.rpiv/artifacts/discover/2025-07-31_frida-pipeline-porter-rpiv-pi.md).

## Contexto

`rpiv-pi` es un **orquestador puro** sobre Pi Agent: registra cero tools
propios, pero compone 8 paquetes hermanos (`rpiv-workflow`, `rpiv-args`,
`rpiv-todo`, `rpiv-ask-user-question`, `rpiv-advisor`, `rpiv-web-tools`,
`rpiv-i18n`, `rpiv-warp`). Aporta 27 skills, 15 subagentes, 3 workflows
`/wf build|vet|polish`, un dock de lanes con progreso en vivo, un picker de
modelos, y un sistema de artefactos `.rpiv/artifacts/` que se revisan entre
etapas.

`frida-code` ya porta **5 de esos 8 hermanos** como extensiones nativas
embebidas (ADR-0020 + D14/D15/D27/D28). La **brecha** está en el orquestador:
sin él, los 5 módulos viven aislados, el usuario tiene que conocer a cada
uno por nombre, no hay workflows pre-construidos, no hay skills, no hay
subagentes, y no hay lane dock unificado. Cargar `rpiv-pi`+`rpiv-workflow`
arrastraría ~530ms de runtime, exigiría `jiti` en `~/.frida`, y su ejecutor
desprendido es específico del TUI — además de reabrir ADR-0005.

## Decisión

**Porte nativo de `rpiv-pi` como `frida-pipeline`**, con 7 decisiones firmadas
(Fase 0 cerrada):

| ID | Decisión | Justificación |
| --- | --- | --- |
| **D1** | **Nombre: `frida-pipeline`** | Espejo de `rpiv-pi`; usuarios que conocen rpiv lo identifican al instante. Evita confusión con `frida-workflow` (motor) y `frida-web-bridge` (puente UI). |
| **D2** | **Agentes globales** (`<frida.agentDir>/../global/agents/`) | Paridad con `rpiv-pi`. La mayoría son "codebase-specialists" agnósticos al proyecto; un workspace chico hereda los mismos 15 perfiles sin duplicar. |
| **D3** | **Artefactos en `.frida/artifacts/`** (no `.rpiv/`) | Separación de namespaces; evita colisión si rpiv-pi y frida-pipeline coexisten en la misma sesión Pi (mismo `<agentDir>` padre). |
| **D4** | **Workflows built-in en TS** (cargados con jiti) | Patrón de `frida-workflow` (ADR-0020); el mismo motor los descubre, valida y ejecuta. Embarcados como `src/tools/frida-pipeline/workflows/{build,vet,polish}.ts` y registrados en `frida-workflow/load/layers.ts` como built-in layer. |
| **D5** | **Skills embebidas** en `src/tools/frida-pipeline/skills/` | Igual que `rpiv-pi` las embarca; la extensión es autosuficiente al instalar (no requiere poblar `.frida/skills/` manualmente). Manifiesto `pi.skills: ["./skills"]` dentro de la extensión. |
| **D6** | **`code-review` se reescribe para Frida** | Customizar al dominio Frida/Softtek: cita `docs/adr/`, `docs/tools/`, el catálogo canónico de providers, y las reglas del disuasivo (ADR-0001). En vez de las docs rpiv-agnósticas. |
| **D7** | **No duplicar ADRs; referenciar** | ADR-0010 (agentDir), ADR-0015 (context), ADR-0016 (permission), ADR-0020 (workflow), ADR-0014 (todo-web), ADR-0011 (extension-ui-context), ADR-0012 (frida-webview), ADR-0017/0018/0019 (providers/models) — `frida-pipeline` los **cita**, no los reescribe. |

### Diseño de alto nivel (5 ejes)

1. **Estrategia — porte nativo.** Todo en `src/tools/frida-pipeline/`, 0 deps
   npm nuevas. Sigue D14/D15/D27/D28/ADR-0020. No reabre ADR-0005.
2. **Detección de hermanas — regex sobre `frida.extensions[]`.** Igual que
   `rpiv-pi` detecta `packages[]` en `settings.json` con regex
   case-insensitive, Frida expondrá un `getActiveExtensionIds()` que
   `frida-pipeline` consume. Las hermanas se importan dinámicamente con
   guard "module-not-found" → degradación silenciosa.
3. **Orden de registro — load-bearing.** Incondicional primero (session
   hooks, `/frida-update-agents`, `/frida-setup`, banner, models-config);
   dependiente al final y en cadena estricta (los registradores que
   esperan `frida-workflow` van uno-a-uno). Mismo criterio que
   `rpiv-core/index.ts:48-80` para evitar la race con jiti.
4. **Lane dock — reusar `frida-workflow`.** El `WorkflowPanel.tsx` +
   `lifecycle.ts` + `store.ts` ya implementan el patrón (D32). `frida-pipeline`
   **publica** los runs vía ese panel; no duplica UI.
5. **Skills en español.** Convención `AGENTS.md` del repo: "Todas las
   conversaciones, creación y edición de archivos deben hacerse en español
   de México". Las 27 SKILL.md se escriben en español; los scripts
   `_shared/*.mjs` también (mensajes de error, comentarios).

### Layout

```
src/tools/frida-pipeline/
├── index.ts                       # createPipelineExtension(pi) — registro principal
├── siblings.ts                    # detección de extensiones hermanas
├── session-hooks.ts               # guidance + git-context + pipeline pointer
├── guidance.ts                    # walk recursivo AGENTS.md / CLAUDE.md / architecture.md
├── git-context.ts                 # git rev-parse → customType: "frida-git-context"
├── pipeline-pointer.ts            # índice de skills para session_start
├── skill-bracket.ts               # override de modelo en /skill: (lee frida.models.json)
├── models-config.ts               # schema + cascade picker (Fase 3)
├── models-picker-ui.tsx           # UI fridaWeb para /frida-models (Fase 3)
├── banner.ts                      # banner de "siblings OK / missing" al iniciar
├── setup-command.ts               # /frida-setup — valida montajes + ofrece reiniciar
├── setup-preview-ui.tsx           # preview de cambios antes de aplicar
├── agents-sync.ts                 # copia 15 .md al agentDir global con sha256
├── workflows/                     # los 3 built-in (Fase 10)
│   ├── build.ts
│   ├── vet.ts
│   └── polish.ts
├── skills/                        # 27 SKILL.md (Fases 6–9)
│   ├── _shared/                   # scripts Node determinísticos
│   ├── discover/SKILL.md
│   ├── research/SKILL.md
│   └── ... (los 27)
└── agents/                        # 15 .md (Fase 5)
    ├── codebase-locator.md
    └── ... (los 15)
```

### Manifiesto de la extensión (resumen)

```jsonc
"frida": {
  "extensions": [{
    "id": "frida-pipeline",
    "main": "./dist/tools/frida-pipeline/index.js",
    "skills": ["./skills"],         // Pi descubre los SKILL.md
    "commands": [                   // slash cmds
      "/frida-setup", "/frida-update-agents",
      "/frida-models", "/frida-lanes"
    ],
    "dependsOn": [                  // hermanas requeridas
      "frida-workflow", "frida-args", "frida-context",
      "frida-permission-system", "frida-agent-browser"
    ]
  }]
}
```

> **Nota:** los **agentes** NO van en el manifiesto; `agents-sync.ts` los
> copia a `<frida.agentDir>/../global/agents/` en cada `session_start`,
> con sha256 en `.frida-managed.json` (mismo patrón que `rpiv-pi/agents.md`).

### Adaptaciones vs `rpiv-pi` (decisiones técnicas forzadas)

| `rpiv-pi` | `frida-pipeline` | Razón |
| --- | --- | --- |
| Hotkey TUI `ctrl+q` para lane browser | Sin hotkey; reusa el botón existente en el footer de `WorkflowPanel` | Frida es webview, no TUI. |
| `~/.pi/agent/agents/` (global) | `<frida.agentDir>/../global/agents/` (D2) | Frida tiene agentDir propio (ADR-0010). |
| `RPIV_LANES_HOTKEY=off` para desregistrar | No aplica (D2 arriba) | Sin hotkey que desregistrar. |
| `RPIV_BASH_TIMEOUT_MS` (5s–30min) | No aplica | El gate de aprobación humana (ADR-0016) ya pausa el comando; no hay wall-clock duro. |
| `.rpiv/artifacts/` | `.frida/artifacts/` (D3) | Namespace Frida, evita colisión. |
| `customType: "rpiv-guidance"` | `customType: "frida-guidance"` (idem git-context, pipeline-pointer) | Evita colisión si ambos coexisten. |
| Skills en inglés | Skills en español de México (convención `AGENTS.md`) | Idioma del repo. |
| Dock Ink TUI | Reusa `WorkflowPanel.tsx` de `frida-workflow` (D32) | Frida ya tiene el panel; no duplicar. |
| `~/.config/rpiv-pi/models.json` | `<frida.agentDir>/models.json` (mismo modo 0600) | Frida agentDir (ADR-0010). |

## Spike Fase 1 — propuesto (validar antes de las 27 skills)

**Deliverable:** esqueleto de la extensión + banner de "siblings OK / missing"
- `/frida-setup` que valida montajes. **Sin skills aún.**

**Gate:** al activar la extensión, el banner debe mostrar:

```
frida-pipeline: 5/5 hermanas detectadas
  ✅ frida-workflow        v0.1.0
  ✅ frida-args            v0.1.0
  ✅ frida-context         v0.1.0
  ✅ frida-permission-system v0.1.0
  ✅ frida-agent-browser   v0.1.0

Skills: 0/27    Agentes: 0/15    Workflows: 0/3
```

Si falta alguna hermana, banner amarillo con CTA de reinstalar esa extensión
(Frida las trae embebidas, así que "reinstalar" = reload de la sesión).

## Plan por fases

| Fase | Entregable | Gate |
| --- | --- | --- |
| **0** | ADR-0021 (este doc) | ✅ Firmado |
| **1** | Esqueleto + banner + `/frida-setup` | Banner muestra 5/5 hermanas correctamente |
| **2** | Guidance + git-context | Editar archivo bajo `src/tools/frida-permission-system/`; verificar que la guidance de la carpeta llega al modelo (test E2E) |
| **3** | Skill bracket + models picker | Cambiar modelo por skill via `/frida-models` y verificar override |
| **4** | Pipeline pointer | Iniciar sesión; ver pointer en `--frida-debug` |
| **5** | Agents sync (15 .md + sha256) | Modificar un agente a mano; correr `/frida-update-agents`; ver banner de "pending" |
| **6** | Skills lote 1 (3): `discover`, `research`, `code-review` | Cada una produce el artefacto esperado en `.frida/artifacts/` |
| **7** | Skills lote 2 (8): `design`, `design-slice`, `design-review`, `synthesize`, `plan`, `blueprint`, `elaborate`, `revise` | `build` corre end-to-end sin humanos hasta `synthesize` |
| **8** | Skills lote 3 (7): `implement`, `validate`, `slice`, `explore`, `grade`, `amend`, `commit` | `build` hace loop grade→elaborate correctamente |
| **9** | Skills lote 4 (9): `pr-triage`, `create-handoff`, `resume-handoff`, `annotate-guidance`, `annotate-inline`, `migrate-to-guidance`, `changelog`, `architecture-review`, `frontend-design` | Las 9 standalone corren sin errores |
| **10** | Workflows built-in (3) | `/wf build "<feature>"` corre completo |
| **11** | Release: vsix 0.2.0, `docs/tools/frida-pipeline.md`, CHANGELOG | Pruebas E2E verdes |

## ADRs que referencia (no reabre)

- **ADR-0001/D7** (disuasivo): `frida-pipeline` hereda el `ApprovalBridge`
  compartido (las hijas de `frida-workflow` ya confluyen ahí).
- **ADR-0005** (descubrimiento abierto): código propio en `src/`, 0 deps npm.
- **ADR-0006** (`hasUI=false`): `/frida-*` son slash cmds, no tools del modelo.
- **ADR-0010** (agentDir): `<frida.agentDir>/../global/agents/` (D2).
- **ADR-0011** (extension-ui-context): UI en fridaWeb vía `WebBridge`.
- **ADR-0012** (frida-webview): componentes React con `mountPersistent`.
- **ADR-0014** (todo-web persistente): patrón de overlay a seguir.
- **ADR-0015** (frida-context): reusa `analyzeContext()` si la skill lo
  requiere (ej. `code-review` mide el tamaño del diff).
- **ADR-0016** (frida-permission-system): reusa `createPermissionSystem`
  atado al `ApprovalBridge` para gates en hijas de workflows.
- **ADR-0017/0018/0019** (providers/models): el models picker
  (`/frida-models`) opera sobre el mismo catálogo canónico.
- **ADR-0020** (frida-workflow): `frida-pipeline` reusa el motor, el
  `WorkflowPanel`, el lifecycle y el `store` reactivo. **Es la pieza
  más citada.**

## Punto frágil en bump de Pi (D12/D18)

- `pi.registerCommand`, `pi.on(...)`, `pi.registerFlag`, `pi.sendMessage`
  con `customType`, `pi.getActiveExtensionIds()` (nuevo método que
  `frida-pipeline` necesita — si Pi no lo expone, fallback a leer
  `~/.frida/settings.json` directamente como hace `rpiv-pi`).
- `createAgentSession` y el ciclo de vida de hijas (ya en lista de
  vigilancia de ADR-0020).
- `jiti` (dependencia transitiva del SDK) — cargar workflows y SKILL.md
  referenciables via TS.

## Coexistencia con `rpiv-pi`

Si un usuario carga **ambos** paquetes en la misma sesión Pi:

- Los `customType` distintos (`rpiv-*` vs `frida-*`) evitan colisión de
  mensajes ocultos.
- La detección de hermanos es por-namespace: `rpiv-pi` ve
  `@juicesharp/rpiv-*`; `frida-pipeline` ve `frida-*`. No hay falsos
  positivos cruzados.
- Las skills y artefactos van a directorios distintos
  (`.rpiv/artifacts/` vs `.frida/artifacts/`).
- Los subagentes van a `<agentDir>/agents/` para `rpiv-pi` y a
  `<agentDir>/../global/agents/` para `frida-pipeline` (D2) — tampoco
  colisionan.

**Riesgo residual:** `/skill:<name>` está namespaced por la extensión que
lo registra; si un nombre se repite (poco probable: las 27 rpiv- y las 27
frida-pipeline- comparten prefijos distintos), Pi toma el primero. El
frontmatter `name:` debe ser único por prefijo de paquete.

**Documentar en `README.md`:** "Si usas también `rpiv-pi` en la misma
sesión, las 27 skills de cada uno coexisten sin colisión. Para evitarla
dúplica de workflows, no invoques `/wf` con el mismo nombre de workflow
desde ambos paquetes."
