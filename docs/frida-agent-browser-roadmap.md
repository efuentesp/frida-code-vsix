# `frida-agent-browser` — Roadmap post-Esencial

Inventario de funciones del paquete referencia (`pi-agent-browser-native`, v0.2.72, ~90
módulos) **no incluidas** en el porte Esencial, evaluadas por **valor para Frida ×
esfuerzo/riesgo**, y organizadas en fases incrementales. Cada fase entrega valor de uso y
es independiente o con dependencias explícitas.

> **Baseline (hecho):** porte Esencial — tool `agent_browser` con input-modes
> `args`/`semanticAction`/`job`/`qa`, sesión implícita, bash-guard, system-prompt, spawn
> `--json` + parseo básico (vuelca el JSON crudo como texto). 48 tests + smoke E2E real.

---

## Cómo se evalúa

- **Valor:** qué mejora directamente la efectividad o seguridad del agente en Frida.
- **Esfuerzo/riesgo:** líneas a portear, acoplamiento al contrato del binario, y si es
  Pi-TUI-específico (no aplica a Frida webview).

---

## Fase 1 — Presentación de resultados + categorías  🔥 (valor MUY alto) — ✅ HECHO

> **El gap más grande.** Hoy el porte vuelca el JSON crudo del binario como texto: el
> agente *puede* leerlo, pero es verboso y los `@refs` accionables no se destacan. Esta
> fase convierte la salida en agent-friendly.

**Implementado en `src/tools/frida-agent-browser/results/`** (`envelope`, `categories`,
`snapshot`, `next-actions`, `presentation`) + integrado en `run.ts`. Verificado con smoke
>real contra `agent-browser` 0.33.1 (open→"Opened … — …", snapshot→render compacto con
>@refs, error→selector-not-found + refresh-interactive-refs).

**Portear (de `results/`):**

- `snapshot-refs.js` / `snapshot.js` — parsear `data.snapshot` del binario → texto compacto
  con la lista de `@eN` interactivos (rol + nombre + value).
- `snapshot-high-value-controls.js` — destacar controles omitidos (searchboxes, botones…).
- `next-actions.js` / `action-recommendations.js` / `recovery-next-actions.js` —
  `details.nextActions`: payloads de seguimiento accionables (refresh-refs, retry-candidate,
  recover-fresh-session, dismiss-dialog).
- `categories.js` — clasificar `resultCategory`/`successCategory`/`failureCategory` para que
  el agente ramifique sin parsear prosa.
- **Patch `tool_result`** → poner `isError:true` cuando `failureCategory` lo indique (Pi sólo
  marca error si `execute` lanza).
- `presentation/batch.js` — matriz compacta de pasos de `job`/`batch`.

**Valor:** el agente lee snapshots 5-10× más rápido y se recupera de fallos solo.
**Esfuerzo:** medio-alto (≈8-12 módulos). **Depende de:** nada (siguiente paso natural).

---

## Fase 2 — Seguridad de refs (stale-ref guard + refSnapshot)  🔥 (valor MUY alto) — ✅ HECHO

> Evita el fallo silencioso más peligroso: que el agente haga click en un `@ref`
> **reciclado/inválido** tras navegar, sin darse cuenta (misclick silencioso).

**Implementado:** `ref-guard.ts` (lógica pura) + extensión de `ManagedSession`
(refSnapshot {origin, refs} + stale) + integración en `execute()` (guard **pre-spawn** +
tracking post-resultado). Smoke real: `click @e99` (desconocido) y `click @e1` tras
>navegación → bloqueados **antes de spawn** con `stale-ref` + nextAction
>`refresh-interactive-refs`; `click @e1` válido → pasa al binario real. (clickDispatch
>probe e in-página queda diferido.)

**Portear (de `session-page-state.js` + `orchestration/browser-run/`):**

- `refSnapshot` por sesión: alinear con el último `snapshot` (URL activa + ids de ref válidos).
- **Stale-ref guard:** rechazar argv con `@e…` de mutación *antes* del spawn si la URL de la
  pestaña cambió o el ref no estaba en el snapshot.
- `click-dispatch.js` — sonda in-page: fallar si un click reportó éxito pero ningún evento
  llegó al target (`details.clickDispatch`).
- `selector-recovery` / `editable-ref-evidence` — avisos de visibilidad y recuperación.

**Valor:** previene misclicks silenciosos (seguridad + confiabilidad).
**Esfuerzo:** medio. **Depende de:** Fase 1 (reusa el parser de snapshots).

---

## Fase 3 — Configuración propia + perfiles  (valor alto, fundacional) — ✅ HECHO

> Permite al usuario fijar qué Chrome/perfil usar y resuelve credenciales — base para la
> búsqueda web (Fase 5) y para tareas autenticadas.

**Implementado en `src/tools/frida-agent-browser/config/`** (`policy.ts` + `load.ts`):
carga por capas (global `~/.frida/config/frida-agent-browser/` + project
`<cwd>/.frida/config/…` + override `$PI_AGENT_BROWSER_CONFIG`), resolución de valores
(`$VAR`/`${VAR}` con escapes `$$`→`$`/`$!`→`!`), y guidance **advisory** en el system
>prompt (executablePath/defaultProfile — **sin** auto-inyectar flags). webSearch queda
>cargado para Fase 5. Smoke: config real → guidance en el system prompt.

**Portear (de `config.js` + `config-policy.js` + `executable-path.js`):**

- Config por capas: `~/.frida/config/frida-agent-browser/config.json` (global) +
  `<cwd>/.frida/config/frida-agent-browser/config.json` (proyecto) + `PI_AGENT_BROWSER_CONFIG`.
- Campos: `browser.defaultProfile`, `browser.executablePath`, `webSearch.{enabled,preferredProvider,exaApiKey,braveApiKey}`.
- Resolución de valores: literales, `$ENV`/`${ENV}`, `!command` (lazy).
- Guidance advisory en el prompt (perfiles/executable) — **sin** auto-inyectar flags.

**Valor:** tareas autenticadas/repetibles + base para Fase 5.
**Esfuerzo:** medio. **Depende de:** nada.

---

## Fase 4 — Verificación de artefactos  (valor alto) — ✅ HECHO

> Para workflows de evidencia: confirmar que screenshots/downloads realmente se guardaron
> antes de declarar éxito.

**Implementado en `results/artifacts.ts`** + integrado en `presentation.ts`/`index.ts`:
`details.artifactVerification` por archivo {absolutePath, exists, sizeBytes, kind, path,
>state, status} + counts (verified/missing/pending) + booleano `verified`; pre-spawn
>`ensureArtifactParentDirs` crea dirs padre. Smoke real: `screenshot sub/x.png` →
>`successCategory: artifact-saved` + `artifactVerification.verified:true` (3742 bytes);
>ausente → `state:missing` + WARNING. (artifactCleanup-on-close queda diferido.)

**Portear (de `results/artifact-manifest.js` + `artifact-state.js` + `presentation/artifacts.js`

- `orchestration/browser-run/prepare/`):**

- `details.artifactVerification`: por-archivo {path, exists, sizeBytes, kind, status,
  verified/missing/pending counts}.
- Crear directorios padre para rutas de artefacto; `direct-anchor-download` (descargas
  loopback directas).
- `details.artifactCleanup` + nota "Artifact lifecycle" en `close`.

**Valor:** PASS/FAIL confiable en flujos de evidencia/QA.
**Esfuerzo:** medio. **Depende de:** Fase 1 (presentation layer).

---

## Fase 5 — `agent_browser_web_search` (tool compañero)  (valor alto) — ✅ HECHO

> Búsqueda viva rápida (Exa/Brave) para descubrir URLs — evita los anti-bot/CAPTCHA de los
> buscadores públicos. Registrado condicionalmente (sólo si hay credencial).

**Implementado en `web-search/{schema,providers,credentials,tool}.ts`** + registro
>condicional en `index.ts` (`canRegisterWebSearch`). Adapters Exa/Brave (build+fetch+
>normalize), resolución lazy de credencial (literal/$ENV/${ENV}/!command + env fallback
>EXA_API_KEY/BRAVE_API_KEY), rate-gate (1.1s), recarga de config por llamada (disable
>aborta). Tests con fetch mockeado (results, sin credencial, disabled, HTTP 429).

**Portear (de `web-search.js`):**

- Segundo tool `agent_browser_web_search` (excluyente con `agent_browser`).
- Registro condicional en `session_start` según config + env (`EXA_API_KEY`/`BRAVE_API_KEY`).
- Adaptadores por proveedor (request → fetch JSON → normalizar → compact result).
- `loadConfigState` en cada ejecución (un disable de config aborta aunque la tool sea visible).

**Valor:** discovery de URLs sin chocar con anti-bot.
**Esfuerzo:** medio. **Depende de:** Fase 3 (config para las keys).

---

## Fase 6 — Flags launch-scoped + política de sesión  (valor medio) — ✅ HECHO

> Corrección: evitar confusión silenciosa de sesión.

**Implementado en `command-policy.ts`** + integrado en `execute`: `needsManagedSession`/
>`isSessionlessCommand` (skills/auth/plugin/mcp/dashboard/device/doctor/install/profiles/
>upgrade/session/state locales/inspección NO vinculan sesión), `isPlainTextInspection`
>(`--help`/`--version` sin `--json`), y **fail-clear** cuando un flag launch-scoped cae
>sobre una sesión implícita ACTIVA sin `sessionMode:"fresh"` (`policy-blocked` +
>nextAction retry-with-fresh-session, sin spawn). Smoke real: `--help`→sin sesión/JSON,
>`profiles`→sin sesión, `open`→con sesión.

**Portear (de `launch-scoped-flags.js` + `argv-grammar.js` + `command-policy.js` + `runtime.js`):**

- Detectar flags launch-scoped (`--profile`, `--restore`, `--executable-path`, `--cdp`…);
  **fallar claro** (en vez de ignorar) si aparecen sobre una sesión implícita activa sin
  `sessionMode:"fresh"`, con hint de recuperación.
- `needsManagedSession` — no vincular sesión para `--help`, `auth`, `profiles`, `skills`,
  `state list/show`, `doctor`, `device list` (inspección local).
- `isPlainTextInspectionArgs` (sesión inspector sin `--json` para `--help`).

**Valor:** elimina comportamiento silencioso confuso.
**Esfuerzo:** medio. **Depende de:** nada.

---

## Fase 7 — Electron desktop  (valor medio, paridad completa) — ✅ HECHO

> Automatizar apps Electron de escritorio (VS Code, Slack…).

**Implementado en `electron/{cdp,discovery,launch,cleanup,registry,compile,schema,host}.ts`**

- integrado en `compile`/`execute`/`session_shutdown`. `list` (scan macOS .app con gate de

>Electron Framework + plist; Linux .desktop), `launch` (spawn `--remote-debugging-port=0`
>
>- `--user-data-dir` aislado → poll DevToolsActivePort → CDP → registro + connect
>best-effort), `status`/`cleanup`/`probe` (registry wrapper-owned; cleanup mata child +
>rm userDataDir al apagar). Compiler fiel (validación por acción) + schema input-mode.
>Smoke real: `electron list` → 10 apps del host (Codex, Obsidian, Code…) con bundleIds.

**Portear (de `electron/` + `orchestration/electron-host/`):**

- `electron list/launch/status/cleanup/probe`.
- Perfil aislado wrapper-owned + CDP attach vía `connect` con `sessionMode:"fresh"`.
- Limpieza del `launchId` y `userDataDir` al apagar.
- Input-mode `electron` en el schema + compilers.

**Valor:** paridad con el referencia para apps desktop (nicho).
**Esfuerzo:** alto (≈8 módulos + spawn/CDP). **Depende de:** nada.

---

## Fase 8 — Contención allowed-domains  (valor bajo-medio) — ✅ HECHO

> Defensa en profundidad: `--allowed-domains` con chequeo de URL final.

**Implementado en `navigation-policy.ts`** + integrado en `execute`: parsea `--allowed-domains`
>del argv y, post-navegación, verifica que el host de la URL final esté en el allowlist
>(coincide exacto o subdominio). Si aterrizó fuera → `failureCategory: policy-blocked` +
>`details.allowedDomainsViolation`. El containment fuerte (request/worker/popup/WebRTC)
>lo hace el binario upstream; esto es defense-in-depth. Smoke: dominio permitido → sin
>falso-positivo.

**Portear (de `navigation-policy.js`):** política de allowed-domains (final-URL check).
**Valor:** aislamiento de red para scrapers confinados. **Esfuerzo:** bajo.

---

## ❌ No portear (bajo ROI / no aplica)

| Feature | Razón |
| --- | --- |
| `sourceLookup` / `networkSourceLookup` (`input-modes/lookups.js`) | Experimental, nicho (correlación UI→fuente). Bajo valor real. |
| Branch restore (`session-page-state` + transcript) | Pi-`session_tree`-específico. Frida no usa branching igual; complejidad alta, valor bajo. |
| Renderizado TUI (`pi-tool-rendering.js`) | Ink/TUI — Frida usa **webview**. N/A (eventual panel `fridaWeb` sería diseño aparte). |
| Recipes reutilizables | El propio referencia lo descarta explícitamente ("No reusable recipe layer yet"). |

---

## Resumen de priorización

| Fase | Feature | Valor | Esfuerzo | Depends |
| --- | --- | --- | --- | --- |
| 1 | Presentación + categorías + nextActions | 🔥 Muy alto | Medio-alto | — |
| 2 | Stale-ref guard + refSnapshot | 🔥 Muy alto | Medio | 1 |
| 3 | Config + perfiles | Alto | Medio | — |
| 4 | artifactVerification | Alto | Medio | 1 |
| 5 | web_search companion | Alto | Medio | 3 |
| 6 | Flags launch-scoped + sesión policy | Medio | Medio | — |
| 7 | Electron desktop | Medio | Alto | — |
| 8 | allowed-domains | Bajo-medio | Bajo | — |

**Estado: ✅ Fases 1–8 implementadas** (suite 453 tests, typecheck/build 0). Orden seguido:
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Las Fases 1 y 2 fueron el mayor salto de calidad
(salida legible + anti-misclick); la 3 desbloqueó la 5.
