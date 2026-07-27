# pi-lens: apagar sus mutaciones y visibilizar sus diagnósticos en el panel

**Estado:** aceptado.

`pi-lens` ya se descubre y carga por [ADR-0005](./0005-descubrimiento-de-recursos-abierto.md)
(instalado en `~/.pi/agent`). Con el descubrimiento abierto, eso incluye sus
**mutaciones automáticas** (auto-format y auto-fix tras cada write/edit del agente)
y su **LSP propio**. Este ADR registra dos decisiones de costura sobre cómo Frida se
relaciona con esas piezas: **(1)** desactivar las mutaciones, y **(2)** visibilizar
los diagnósticos en el panel del webview —**no** en el editor.

Ambas son consistentes con D16 (CONTEXT.md §4): el LSP de VS Code sirve al *humano*
que edita; pi-lens sirve al *agente*. No compiten por función, sólo por proceso.

## (1) Desactivar auto-format y auto-fix de pi-lens

**Razón.** Por defecto pi-lens reformatea y auto-fixea los archivos que el agente
toca. Eso (a) **duplica** el formateo on-save de VS Code (que el dev ya tiene
configurado) y (b) **muta archivos fuera del gate de aprobación** (D7): una mutación
que no pasa por el evento `tool_call` y, por tanto, no se aprueba ni se audita.

**Decisión.** Forzar `format.enabled = false` y `autofix.enabled = false` en la
config global de pi-lens **dentro del proceso de Frida**, dejando activos los tools
orientados al agente (`module_report`, `read_symbol`, `ast_grep_*`, `symbol_search`,
`lsp_navigation`, `lsp_diagnostics`) y el LSP (consulta puntual del modelo).

**Mecanismo.** `PI_LENS_CONFIG_PATH` reemplaza la config global que lee pi-lens: si
está definido, pi-lens lee ese archivo en vez de `~/.pi-lens/config.json`. Frida
escribe `<globalStorageUri>/pilens-config.json` = **merge** de la config del usuario
(respetamos sus `ignore` y sub-campos como `format.mode`) forzando solo esos dos
flags (`src/pilens-config.ts`). Como es una variable de entorno **process-global**,
sólo afecta al extension host de VS Code: el CLI `pi` del usuario corre en otro
proceso y sigue leyendo su `~/.pi-lens/config.json` intacto.

**Opciones consideradas.**

- **(A) `PI_LENS_CONFIG_PATH` con merge (elegida).** Aisla la config al proceso de
  Frida y respeta la del usuario.
- **(B) Escribir `~/.pi-lens/config.json` global.** Descartada: afectaría a todo uso
  de pi-lens, incluido el CLI `pi` del usuario.
- **(C) Escribir `.pi-lens.json` en el repo del proyecto.** Descartada: mete un
  archivo en el repo del usuario (commit noise) y afecta a otros agentes pi en ese repo.
- **(D) Registrar los flags `no-autoformat`/`no-autofix` desde una factory propia.**
  Descartada: pi-lens los registra con `default: false` y el orden de carga no es
  garantizable; frágil.

## (2) Visibilizar diagnósticos en el panel del webview (no en el editor)

**Razón.** pi-lens calcula diagnósticos tras cada edición del agente. Esa señal hoy
**sólo** alimenta al LLM (como contexto/advisory); el usuario no la ve en Frida. VS
Code ya muestra squiggles propios en el editor, así que replicarlos sería redundante
(descartado). Pero un **resumen agregado por turno** en el panel del webview sí aporta
visibilidad sin duplicar al editor.

**Decisión.** Escuchar el evento `pilens:diagnostics` del bus de Pi y publicar un
resumen al webview: "✕ N errores · ⚠ M warnings · K archivos" + lista plegable por
archivo. No se toca el editor (sin `DiagnosticCollection`, sin squiggles).

**Mecanismo.** Una factory `lens-diagnostics-bridge` (`src/lens-diagnostics-bridge.ts`)
se suscribe a `pi.events.on("pilens:diagnostics", …)` —el mismo bus que usan los gates
(D7) y `ask_user_question` (ADR-0006)—. El host acumula diagnósticos por turno
(`src/extension.ts`: `lensAccum`) y publica el resumen en `turn_end` y `agent_end`
(canales `lens_diagnostics` al webview); la cascade tardía se auto-publica cuando el
agente no está ocupado. El webview lo renderiza en `LensDiagnostics.tsx` (footer,
junto a `TodoPanel`), auto-oculto si no hay errores/warnings.

## Opciones consideradas (parte 2)

- **(A) Panel en el webview vía `pilens:diagnostics` (elegida).** Evento robusto y
  siempre emitido; no toca el editor; respeta `hasUI=false` (ADR-0006).
- **(B) Squiggles/Problems en el editor (`DiagnosticCollection`).** Descartada por
  redundante con el LSP de VS Code (decisión de D16).
- **(C) Estado LSP explícito (activo/fallido) y advisory textual del turno.**
  Descartada por ahora: pi-lens publica el estado LSP vía `ctx.ui.setStatus`, que es
  `hasUI=false` en Frida (no hay canal del bus para ello); y el advisory textual se
  inyecta al LLM o persiste en archivos internos de pi-lens (`.pi-lens/cache/`),
  sin evento del bus. Recuperarlos requeriría leer archivos internos (frágil) o un
  cambio upstream. Fuera de alcance de este ADR.
- **(D) Construir tools propios sobre el LSP de VS Code (`vscode.execute*Provider`).**
  Descartada: reimventaría el funnel/ranking/blast-radius encima de primitivos sin
  afinar y amarraría al agente a lo que VS Code tenga indexado. pi-lens ya cumple ese rol.

## Consecuencias

- **No reabre ADR-0005:** no cargamos ni instalamos ninguna extensión ajena nueva;
  sólo **consumimos** el bus de la ya descubierta y sobreescribimos su config **en
  nuestro proceso**. No genera egress (texto local) ni mutaciones por parte del host.
- **Auto-format/autofix desactivados en Frida:** el agente pierde el reformateo
  automático de pi-lens, pero VS Code formatea on-save y el gate (D7) controla todas
  las mutaciones. Si un proyecto quisiera reactivarlos, bastaría no forzar esos flags
  (o leer un setting `frida.piLens.autoFormat` futuro).
- **El LSP de pi-lens sigue activo:** no hay campo de config para `no-lsp`; si su
  overhead de proceso (doble server) pesara, `--no-lsp` es una perilla futura (pierde
  `lsp_navigation`/`lsp_diagnostics`, conserva todo lo basado en tree-sitter).
- **El panel refleja sólo el turno actual:** el acumulador se reinicia en cada
  `turn_start`; diagnósticos de turnos previos no se acumulan. La cascade tardía tras
  `agent_end` sí se muestra (se publica sola).
- **Punto frágil a regresar en cada bump de Pi** (junto a los de D12/ADR-0006): el
  canal del bus `pilens:diagnostics` y la forma de su payload (`{v, source, cwd, seq,
  ts, files:[{path, diagnostics:[{range, severity, message, code?, source?,
  semantic?}], truncated?}]}`), la variable `PI_LENS_CONFIG_PATH` y los campos
  `format.enabled`/`autofix.enabled` de la config global de pi-lens.
