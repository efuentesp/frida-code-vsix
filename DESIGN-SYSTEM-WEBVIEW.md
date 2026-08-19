# DESIGN-SYSTEM-WEBVIEW.md — System design y guía de estilo del webview de frida code

> **Lectura OBLIGATORIA antes de tocar `webview/`** (componentes, estilos, íconos, colores,
> animaciones). Basado en el renderer nativo de VS Code / Copilot Chat
> (`microsoft/vscode`, rama main, extraído 2026-08-19).
>
> Meta: que frida code use el lenguaje visual y la estructura de Copilot Chat, y que
> **cualquier tema de VS Code (Dark+/Light+/Alto contraste) se aplique a todo sin que nada
> desentone**.

## 0. Cómo usar este documento (agente que lo recibe)

**Este documento es una especificación autocontenida y normativa**: es el insumo
que recibe el equipo de frida code para que un agente de IA aplique el rediseño
del webview SIN acceso a los mockups ni a las fuentes de referencia. Todo lo
necesario para implementar está aquí; los mockups son material de apoyo visual
opcional (si se adjuntan, abrir `mockup-frida-transcript.html` como referencia
interactiva; las rutas en §11 son del workspace de origen).

Orden de aplicación recomendado para el agente:
1. Leer COMPLETO este documento (normas §1–§7 + modelo de datos §5.0).
2. Levantar inventario del repo objetivo: `webview/components/*`,
   `webview/styles.css`, `webview/types.ts` (mapa en §11).
3. Ejecutar la tabla de brecha §8 en orden de prioridad (P1 → P2 → P3), fila por
   fila. Cada fila es un cambio verificable de forma independiente.
4. Por cada fila: aplicar la anatomía de §5 correspondiente + animaciones §6 +
   interacción §7.
5. Cerrar cada fila con la verificación §9 (Definition of Done); no avanzar a la
   siguiente fila sin pasarla.
6. Conservar SIEMPRE la lógica de interacción existente (§8 nota final): este
   documento cambia piel y estructura visual, no comportamiento.

**Autorización de cambios de layout (regla dura):** los usuarios de frida code
están acostumbrados al posicionamiento actual de los elementos. Cambios de
**piel** —tokens, colores, tipografía, íconos, animaciones, espaciados— se
aplican libremente siguiendo este documento. Cambios de **layout** —mover o
reposicionar un elemento existente (p.ej. la barra de «procesando» de encima
del textbox al pie, como hace Copilot Chat), reordenar zonas, eliminar
elementos, alterar comportamientos establecidos— son decisiones de producto
que requieren **AUTORIZACIÓN EXPLÍCITA del dueño del producto antes de
aplicarse**. El agente puede y debe sugerirlos (con su justificación, vía
pregunta con opciones), pero nunca aplicarlos por iniciativa propia. Las filas
de §8 que son movimientos de layout están marcadas en su nota de
autorización.
>
> Referencias vivas:
> - Mockups navegables e interactivos: `.frida/artifacts/copilot-toolcall-style/`
>   (`mockup-frida-transcript.html` es el modelo integral; desde v018:
>   `../frida-llops/.frida/artifacts/copilot-toolcall-style/`).
> - Fuentes del core de VS Code (renderer de tool calls, input part, paneles, context
>   usage): `.frida/artifacts/copilot-toolcall-style/reference/vscode-core-renderer/`.
> - Investigación completa: `.frida/artifacts/copilot-toolcall-style/README.md`.

---

## 1. Reglas de oro (checklist rápido — si violas una, revisa)

1. **Cero colores hardcodeados.** Todo color pasa por `var(--vscode-*)`. Las únicas
   excepciones permitidas viven en la §2.3 y deben llevar comentario justificándolas.
2. **Una sola familia de íconos: Codicons** (`@vscode/codicons`, la fuente del
   workbench de VS Code — ver §4). Lucide queda como **legado en migración**: no
   usar en elementos NUEVOS; los existentes migran por slices (§8 fila 13). Los
   íconos de marca Frida (bot, favicon) son SVG inline y no migran. No usar
   emojis como íconos (los existentes en meta de sesiones `📁`/`⏱` son texto,
   tolerados; no agregar nuevos).
3. **Números tabulares** en toda métrica que cambie en vivo (duraciones, contadores,
   tokens, porcentajes): `font-variant-numeric: tabular-nums; font-feature-settings: "tnum"`.
4. **`prefers-reduced-motion: reduce`** desactiva TODA animación que agregues. Sin
   excepción.
5. **`<button>` siempre reestilizado**: `background: transparent; color: inherit;
   font: inherit; border: none|1px solid token; cursor: pointer`. El UA aplica
   `buttonface` claro y fuente Arial si lo olvidas (errata real: `.sub-version`).
6. **Cascada**: antes de confiar en una clase de ocultamiento (`display:none`) contra un
   contenedor con `display:flex`, gana por especificidad, no por orden (errata real:
   `.scrim.hidden-panel`). Regla práctica: define pares `.X.hidden-Y { display:none }`.
7. **Superficies raíz con fondo explícito**: `html/body` (o el contenedor superior del
   webview) SIEMPRE llevan `background: var(--vscode-editor-background)`. Sin eso, el
   tema "no cambia" aunque los tokens estén bien.
8. **`color-scheme`** (`dark`/`light`) según el tema activo, para que scrollbars y
   `<select>` nativos sigan el tema. El host lo inyecta; si hay fallback local,
   decláralo.
9. **DOM programático** para render dinámico: `createElement`/`createElementNS`,
   `textContent` — `innerHTML` está bloqueado por el linter del repo.
10. **Nada desentona**: si agregas un elemento, verifica en los 3 temas (§9) antes de
    cerrar. "Se ve bien en Dark+" no es suficiente.

---

## 2. Tokens de color

### 2.1 Tabla de uso (qué token para qué)

| Función | Token | Notas |
|---|---|---|
| Fondo base (transcript, body) | `--vscode-editor-background` | también `--vscode-terminal-background` para salida de terminal |
| Cajas/paneles elevados (dock, overlays, tarjetas) | `--vscode-editorWidget-background` | fallback `--vscode-quickInput-background` |
| Hover de fila/botón fantasma | `--vscode-list-hoverBackground` | |
| Texto principal | `--vscode-foreground` | títulos, valores |
| Texto secundario (subtítulos, meta, filas tool) | `--vscode-descriptionForeground` | |
| Bordes de cajas medianas | `--vscode-panel-border` | |
| Bordes de la familia input (composer, carrusel, plan review) | `--vscode-input-border` | con fallback a `--vscode-panel-border` |
| Guía vertical de grupo de tools | `--vscode-chat-requestBorder` | fallback `--vscode-panel-border` |
| Links / anclas de archivo | `--vscode-textLink-foreground` (hover: `…activeForeground`) | |
| Foco | `--vscode-focusBorder` | outline 1px, focus-visible |
| Error | `--vscode-errorForeground` | también `--vscode-testing-iconFailed` para semántica test |
| Éxito | `--vscode-testing-iconPassed` | checks, +N del diff |
| Warning | `--vscode-editorWarning-foreground` | anillo de contexto ≥70% |
| Info / ~N del diff | `--vscode-editorInfo-foreground` | |
| Botones primarios | `--vscode-button-background` / `-foreground` / `hoverBackground` | |
| Botones secundarios | `--vscode-button-secondaryBackground` / `-secondaryForeground` | hover con list-hover |
| Selects (`<select>`) | `--vscode-dropdown-background` / `-foreground` | |
| Progreso/activo (barra, dot de tarea) | `--vscode-button-background`; tareas en curso `--vscode-charts-blue` | |
| Shimmer del texto | `var(--vscode-chat-thinkingShimmer, var(--vscode-textLink-foreground))` | token de chat; SIEMPRE con fallback |

### 2.2 Tokens que NO existen en webviews de terceros

`--vscode-chat-*` son colores contribuidos por el chat integrado; en versiones viejas
del host pueden no llegar. **Regla: todo token de chat se usa con fallback** (ver
shimmer arriba). Los tokens base (`editor-*`, `button-*`, `list-*`, `dropdown-*`,
`testing-*`, `charts-*`) siempre están.

### 2.3 Excepciones documentadas (lista blanca de hardcode)

| Valor | Dónde | Motivo | Migración |
|---|---|---|---|
| `#6a5acd` (morado) | `.avatar.ai` | identidad de marca Frida | mantener; si se tematiza, definir `--frida-brand` |
| knobs de switch `#fff` | `.switch::after` | usar `--vscode-button-foreground` | pendiente |
| sombras `rgba(0,0,0,…)` | overlays | no hay token de sombra universal | mantener (inofensivas en light) |

Nueva excepción ⇒ comentario en el CSS + fila aquí. Si no está listada, es un bug.

---

## 3. Tipografía y métricas

| Concepto | Valor |
|---|---|
| Fuente UI | heredada del host (`-apple-system, "Segoe UI", Ubuntu, system-ui, sans-serif`) — NO fijar otra |
| Fuente mono | `--vscode-editor-font-family, monospace` (comandos, rutas, código) |
| Escala | 10.5/11 (meta, badges, hints) · 11.5/12 (filas tool, descripciones, botones) · 12.5 (títulos de panel) · 13 (base, títulos de overlay) |
| Radius | 3px hover de fila · 4–5px chips/botones chicos · 6px tarjetas/codecblocks · 8px paneles dock · 10px overlays · 50% submit/avatares/dots |
| Gaps | 4px dentro de fila · 6–8px entre elementos hermanos · 10px entre secciones |
| Paddings | fila tool `2px 6px 2px 2px` · header de panel `8px 12px` · cuerpo de panel `8–14px` |
| Separador de subtítulo | guion en-dash ` – ` (espacio, en-dash, espacio) via `content: " \2013 "` en `<small>::before` |
| Máx altura bloques de salida | ~13–14 líneas con scroll + "ver más" |

---

## 4. Iconografía (Codicons)

**Familia objetivo: Codicons** — la fuente de íconos del workbench de VS Code
(`codicon.ttf`), la misma que usa Copilot Chat. Es una **fuente**, no componentes:
se consume con clases y se dimensiona con `font-size`.

### 4.1 Instalación y wiring (una sola vez)

```bash
npm i @vscode/codicons
```

- `webview/main.tsx`: `import "@vscode/codicons/dist/codicon.css";`
- Vite emite `codicon.ttf` a `dist-webview/assets/` automáticamente (la `url()`
  relativa del CSS resuelve contra la URI webview del propio bundle).
- CSP: **ya soportado** — `webview-html-core.ts` emite `font-src ${cspSource}`
  (verificado 2026-08-19; no requiere cambios del host).
- `localResourceRoots` ya incluye `dist-webview/` ✓.
- Licencia CC BY 4.0: incluir atribución en los créditos/notice del VSIX.

### 4.2 Uso

```tsx
<span className="codicon codicon-check" />     // directo
<Codicon name="check" size={13} label="OK" /> // wrapper recomendado
```

Wrapper (`webview/components/Codicon.tsx`): un componente chico que emite el
`span.codicon.codicon-{name}` con `font-size` desde `size` y `aria-hidden` por
defecto (o `role="img"` + `aria-label` si es informativo). Evita repetir spans
y centraliza el sizing.

| font-size | Uso |
|---|---|
| 11–12 | meta inline, glifos de status echo |
| 13 | contenido: filas tool, acciones de fila, tabs |
| 14–15 | toolbar del header, controles del composer |
| 16 | status de fila (check/✗/spinner) |

Color por `currentColor` (la fuente hereda el `color` del contenedor). Sin
stroke-width ni multi-color — si necesitas eso, es SVG inline de marca (§2.3).

### 4.3 Tabla de migración Lucide → Codicon

| Lucide actual | Codicon |
|---|---|
| `ChevronRight` / `ChevronDown` | `codicon-chevron-right` / `codicon-chevron-down` |
| `Check` | `codicon-check` |
| `CheckCircle2` | `codicon-pass` |
| `CircleX` | `codicon-error` |
| `TriangleAlert` | `codicon-warning` |
| `LoaderCircle` (spin) | `codicon-loading` + animación §6 |
| `Circle` (fill, tarea en curso) | `codicon-record` |
| `Circle` (outline) | `codicon-circle-outline` |
| `ArrowUp` (submit) | `codicon-arrow-up` |
| `Square` (stop) | `codicon-debug-stop` |
| `Terminal` | `codicon-terminal` |
| `FileText` / `FilePen` / `PencilLine` | `codicon-file` / `codicon-edit` |
| `Search` / `ScanSearch` | `codicon-search` |
| `Settings` | `codicon-settings-gear` |
| `Plus` / `X` | `codicon-add` / `codicon-close` |
| `History` | `codicon-history` |
| `Wrench` | `codicon-tools` |
| `Library` / `BookOpen` / `Globe` | `codicon-library` / `codicon-book` / `codicon-globe` |
| `Brain` (thinking) | **sin equivalente** — mantener SVG inline (marca) o decidir sustituto en diseño |
| Bot Frida (avatar/splash) | **marca** — SVG inline, NO migra |

Ante duda del nombre exacto: cheat sheet en `node_modules/@vscode/codicons/dist/codicon.html`
o el repo `microsoft/vscode-codicons`.

### 4.4 Reglas

- Elementos NUEVOS siempre con codicons; lucide sólo mientras su componente no
  migre (coexistencia controlada por slices, §8 fila 13).
- Nunca incrustar paths de codicon a mano ni copiar el CSS de la fuente: usar el
  paquete (`@vscode/codicons`, NO el viejo `vscode-codicons`).
- El spinner es `codicon-loading` + rotación CSS (§6) — igual que el workbench.
- SVG dinámico restante (sólo marca) con `createElementNS` (§1.9).

---

## 5. Anatomía por zona (estructura objetivo)

El modelo integral es `mockup-frida-transcript.html` (app completa, interactiva).
Resumen normativo:

### 5.0 Modelo de datos de sesión (turnos y ejecuciones) — la fuente de verdad de la UI

Toda la UI del transcript se deriva de `webview/types.ts`. **Ninguna pieza visual
inventa estado**: si un dato no está en el modelo, no se pinta. Antes de tocar un
componente, sabe qué campo alimenta qué zona.

**Turn (un intercambio usuario→asistente):**
```text
Turn {
  id: number                    // clave de render (Fragment key)
  user: string                  // mensaje del usuario (o <skill> block → SkillBlockCard)
  images?: ImageAttachment[]    // adjuntos → fila de thumbnails
  segments: Segment[]           // ⭐ cronología REAL del asistente (texto⇄tool intercalados)
  status: "thinking" | "executing" | null   // null = turno COMPLETADO
  executingTool?: string         // nombre de la tool activa (hint de proc-bar/beam)
  bash?: BashRun                // ejecución del usuario (!/!!), NO va en segments
  error?: string                // error del turno → franja .err roja
  notice?: string               // mensaje de sistema (/todos) → bloque sin avatares
}
```

**Segment (unión ordenada — el renderer itera en orden, no agrupa por tipo):**
```text
| { kind: "text"; text }                              → .bubble (Markdown)
| { kind: "thinking"; text; startedAt; endedAt?; tokensLLM? }
                                                      → tarjeta thinking (live si !endedAt)
| { kind: "reasoning_hint"; tokens }                  → hint «razonó N tokens…» (ADR-1003-F3)
| { kind: "tool" } & ToolEntry                        → fila de tool (target: fila plana §5.2)
```

**ToolEntry (una ejecución):**
```text
state: "running" → "ok" | "error"     // ciclo de vida; running = shimmer/partial
startedAt / endedAt?                    // duración (ms) del subtítulo «– 318 ms»
result / diff                           // Salida: terminal/markdown | diff coloreado
partial?                               // salida fluyendo mientras running (auto-abre)
partialDetails?: SubagentProgressDetails // vista rica de sub-agente (turn/tools/tokens/activity)
toolCallId?                            // empareja tool_update/tool_end con su fila
tokensLLM?                              // atribución ~llm → «· 1.1k tok»
args: unknown                          // Entrada: filas dl/dt/dd por tool (TOOL_INFO)
```

**Ciclo de vida por eventos (host→webview, `InMessage`):**
`turn_active` (nuevo Turn, status thinking) → `thinking_delta` (acumula segment
thinking) → `delta` (texto de respuesta) → `tool_start` (segment tool, running) →
`tool_update` (partial/partialDetails vía toolCallId) → `tool_end` (result/diff/
isError → state ok|error) → … más segmentos … → `agent_busy:false` (turno completo,
status → null). En paralelo: `bash_start/chunk/end` (turn.bash),
`compact_start/compact_end` (CompactionEntry con `afterTurnId` → se inserta DESPUÉS
de ese turno, entre turnos), `history` (recarga de sesión: HistoryItem[] → mismos
segmentos), `queued` (mensajes encolados), `approvals`/`questionnaire` (paneles del
footer). El detalle completo de mensajes vive en `types.ts` (InMessage/OutMessage).

**Reglas de derivación de UI (vinculantes):**
1. **Turno en vivo** = `state.busy && turn === último`. Sólo él anima (shimmer,
   beam, cronómetro con Date.now()). Los demás turnos son estáticos.
2. **Turno completado** = `status === null` → target: envolver sus `kind:"tool"`
en
   el grupo colapsable «N herramientas · Σduración · Σtokens» (§5.2). Mientras
   el turno corre, las filas van sueltas — el grupo NO existe aún.
3. **Fila running** se auto-abre con `partial`/`partialDetails` o tras umbral
   (400ms); la intervención manual del usuario SIEMPRE gana (lógica ya resuelta
   en `CollapsibleCard` — conservarla, sólo cambia la piel).
4. **Duración/tokens/diff** siempre del modelo (`endedAt-startedAt`, `tokensLLM`,
   `diff`); nada se recalcula en la UI.
5. **Compaction/BranchSummary** son entradas ENTRE turnos (`afterTurnId`/
inicio
   del transcript), no segmentos — no entran al grupo de herramientas.
6. **Estados globales que mutan el footer**: `busy` (beam + submit↔stop +
   proc-bar sobre el textbox), `approvals`/`modelChanges`/`questionnaire` (qué panel reemplaza
   al composer, en ese orden de prioridad), `queued` (encolados), `usage`
   (ContextBar/anillo), `workspace` (WorkspaceBar).

Mapeo rápido modelo→zona: `Turn`→`.turn` (avatar user/ai + who) · `Segment.text`→
bubble · `thinking`→tarjeta thinking · `reasoning_hint`→hint · `tool`→fila tool ·
`bash`→BashCard · `error`→`.err` · `notice`→notice-block · `compactions`→
CompactionCard entre turnos · `branchSummaries`→BranchSummaryCard al inicio.

### 5.1 Header (`.toolbar`)
brand (avatar 18px + nombre) → badge worktree → badge lens → versión (mono, hover
azul link, clicable `/update`) → stats de sesión (tabulares) → [Detener (borde
errorForeground) si hay panel pendiente] → `spacer` → [+ nueva] [⏱ sesiones] │ [⇕
compactar (warn si ctx≥70%)] [🧠 razonamiento] │ [⚙ ajustes]. Botones 26×26
fantasma con hover list-hover.

### 5.2 Transcript (turnos)
- Turno = `.turn` con separador superior (border panel) entre turnos; filas `.row`
  avatar(22px, user=button-background, ai=brand) + `.body` (`.who` 11px + contenido).
- **Thinking**: fila colapsable propia (icono brain azul link); en vivo shimmer del
  label «Razonando…»; completado «Razonó 4.2s». Expansión perezosa.
- **Fila tool (la pieza central)** — plana, SIN caja:
  - Estados: **corriendo** = sin icono, verbo con shimmer parcial (solo el verbo
    brilla; contadores/archivos quietos), barra de progreso 2px encima si la tool
    reporta progreso · **terminada** = check verde SOLO opt-in (setting de
    accesibilidad), texto en pasado gris plano · **error** = `CircleX` rojo +
    salida colapsable roja.
  - Frase: `Verbo <ancla de archivo|code> – detalle tabular` (p.ej. «Leído
    `oauth.ts` – 212 líneas · 318 ms»). Badges +N/−N del diff como subtítulo
    coloreado (Passed/Failed).
  - Chevron fantasma (opacity 0 → .85 en hover) que rota 90° al expandir.
  - Cuerpo expandido: secciones **Entrada/Salida** (dl/dt/dd para args simples,
    codeblock bordeado máx ~13 líneas word-wrap, diff con líneas verdes/rojas y
    fondo tenue, terminal con `--vscode-terminal-background`).
- **Agrupación por turno** (`completed-response-disclosure` de VS Code): cuando el
  turno completa, sus tools se envuelven en un grupo colapsable — summary pill
  «**N herramientas** · duración · tokens» + **línea guía vertical**
  (`border-left` con `border-image` gradiente que se desvanece 10px antes del
  final). Colapsado por defecto; mientras el turno corre, las filas van sueltas.
- CompactionCard/BranchSummary entre turnos (caja compacta existente, ok).
- Botón flotante «ir al final» (sticky, círculo button-background).

### 5.3 Footer (input part, orden de `chatInputPart.ts`)
1. **Followups**: links de sugerencia (`textLink-foreground`, 12px, máx 3 líneas).
2. **Input-stack**: paneles dockeados (todo/preguntas/aprobación) + composer forman
   **UNA píldora** (`gap:0`, esquinas cuadradas donde se unen — clase
   `*-continues` — radio 8 solo en extremos).
3. **Composer**: borde `input-border` (foco → `focusBorder`), editor arriba, chips
   de archivos `@` en medio, **toolbars ABAJO**: selects
   proveedor/modelo/esfuerzo (Off/Bajo/Medio/Alto) + anillo de contexto (§5.5) a la
   izquierda · modo (escudo) + **submit circular** (ArrowUp; muta a ■ stop
   errorForeground cuando busy) a la derecha. **Border beam** mientras trabaja
   (§6).
4. **WorkspaceBar** (identidad frida, se conserva): cwd · sesión renombrable ·
   rama con +N ~N −N (Passed/Info/Failed) · ↑ahead.
5. **ContextBar**: strip fino con label «Contexto» + barra de nivel (low verde /
   mid gradiente / high errorForeground) + `89k / 143k` + métricas ↑↓R·W·CH·$ —
   y aquí vive el estado «Escribiendo respuesta…» + Cancelar (NO en barra aparte).

### 5.4 Paneles dockeados (cajas `editorWidget`, borde `input-border`, radius 8)
- **Preguntas** (question carousel): header (título semibold + paso N/M + colapsar
  + cerrar) · tabs pill por pregunta · ítems con label/desc y check a la derecha ·
  input libreform · footer con flechas + estado («falta: X»). La interacción de
  teclado por zonas del `QuestionsPanel` actual se conserva.
- **Tareas (todo)**: **widget persistente** siempre visible mientras haya tareas —
  colapsado «● tarea actual (2/4)» con dot azul pulsante; expandido «Tareas (2/4)»
  con ítems done(tachado)/run(azul)/pendiente; botón Limpiar deshabilitado si hay
  tarea corriendo. Las filas tool `todo` del transcript solo actualizan el widget.
- **Aprobaciones / workflow**: caja plan-review con header + cuerpo (comandos
  numerados mono, o pasos con estados) + botones Continuar / Permitir «patrón» /
  Cancelar.

### 5.5 Anillo de contexto (toolbar del composer)
SVG 14×14: círculo fondo (descriptionForeground op .5) + arco que llena en sentido
horario desde arriba (`stroke-dasharray/dashoffset`, rotate -90°). Estados normal
→ warning (≥70%) → error (≥90%). El % se revela en hover (label colapsada
max-width 0→4em, 100ms). Click → popup «Session Info»: costo · barra horizontal 4px
con uso sólido + **buffer de salida rayado** (repeating-linear-gradient -45°) ·
desglose por categorías · aviso de calidad.

### 5.6 Overlays (SettingsHub, SessionsPanel)
scrim `rgba(0,0,0,.45)` click-to-close + Esc → panel centrado
`editorWidget-background`, borde `input-border`, **radius 10**, sombra, máx
`min(520–560px, 80vh)`. Settings: tabs subrayadas (active `focusBorder`) con
icono 13px; tarjetas de proveedor con badge de estado; toggles switch
(`inputOption`/`textLink`). Sessions: seg-toggle Proyecto/Todas; filas con dot
azul de sesión actual, meta (msgs · 📁 proyecto · fecha), línea de stats ⏱↑↓;
renombrar inline; eliminar con confirmación inline (danger) y deshabilitado en la
sesión activa.

---

## 6. Animaciones (tabla normativa)

| Efecto | Duración/easing | Detalle |
|---|---|---|
| Expansión/colapso de fila o grupo | 180ms `cubic-bezier(.2,0,0,1)` | `grid-template-rows 1fr→0fr` + `opacity` 140ms + `visibility 0s linear 180ms` al cerrar |
| Grupo de turno | 200–260ms misma curva | `max-height` + opacity |
| Shimmer texto | 2s `linear infinite` | gradiente 400% clip-text, background-position 120%→−120%; **parcial**: solo el verbo (wrapper span) |
| Spinner icono | 1.25s `steps(45) infinite` | `codicon-loading` + rotación CSS (paridad workbench) |
| Spinner CSS (proc/working) | 0.9s `linear` | borde con top transparente |
| Border beam (composer working) | 2.6s `linear infinite` | `@property --beam-angle` 135°→495°, 2 anillos conic (beam 1px + glow blur 1.5px), mask composite |
| Dot de tarea en curso | 1.6s `ease-in-out` pulso opacidad | |
| Chevrons | transform .15s `ease` | rota 90° |
| Reveals de label (anillo %) | 100ms `ease-out` | max-width 0→4em |
| Cambio de tema | background .2s `ease` | |

**Obligatorio**: cada `@keyframes`/animación va acompañada de su cláusula
`@media (prefers-reduced-motion: reduce) { … animation: none }` (o estado estático
equivalente legible).

---

## 7. Interacción, estados y accesibilidad

- **Hover**: filas y botones fantasma → `list-hoverBackground`; links subrayan.
- **Focus**: `:focus-visible { outline: 1px solid var(--vscode-focusBorder) }` en
  TODO interactivo (botones, filas clicable, tabs, opciones).
- **Disabled**: `opacity .45` + `cursor: not-allowed` + tooltip del porqué.
- **ARIA**: `aria-expanded` en todo toggle (filas, grupos, paneles); chevrons
  decorativos `aria-hidden`; overlays con role dialog implícito + Esc.
- **Danger**: eliminar/cancelar en `errorForeground` solo al hover/confirmación
  inline, nunca destrutivo a un click.

---

## 8. Brecha actual → objetivo (checklist de migración)

Estado del webview hoy (`webview/components/*`) vs este design system. Prioridad:
P1 = mayor impacto visual, P2 = complementa, P3 = pulido.

| # | Área | Hoy | Objetivo | P |
|---|---|---|---|---|
| 1 | `ToolCard` | caja `.card` con borde/fondo, icono lucide 13 pulsante (`thinkingPulse`), título+label+status derecha | fila plana Copilot: sin caja, shimmer del verbo corriendo (sin icono), pasado al terminar, ✗ en error, subtítulo `– detalle` tabular, chevron fantasma (§5.2) · **HECHO F2 2026-08-19** | P1 |
| 2 | Agrupación | las tool cards van sueltas en el turno | grupo colapsable «N herramientas · duración» con guía vertical al completar el turno; sueltas mientras corre (§5.2) · **AUTORIZADO 2026-08-19 (Edgar); HECHO F3 2026-08-19** | P1 |
| 3 | Footer estructura | `proc-bar` separada + cajas dock flotantes + submit rectangular | input-stack píldora + submit circular ↑↔■ + beam (§5.3) · **HECHO F4 2026-08-19. F5 (working en ContextBar) REVERTIDA el mismo día por el usuario: el indicador se encimaba con la info de contexto → proc-bar vuelve a su posición original sobre el textbox (§10.10)** | P1 |
| 4 | Toolbars del composer | selects + modo + enviar en `bar-controls` (ya abajo ✓) | añadir anillo de contexto + popup de detalles (§5.5); mantener selects reales | P2 |
| 5 | Todo | solo filas ToolCard con status echo | widget persistente dockeado + sincronización filas→widget (§5.4) | P2 |
| 6 | SettingsHub | `cfg-panel` fullscreen (`inset:0`) | scrim + panel centrado radius 10, tabs subrayadas (§5.6) | P2 |
| 7 | SessionsPanel | overlay quickInput (ya es overlay ✓) | alinear radios/sombras/badges al sistema; mantener interacción (§5.6) | P3 |
| 8 | Followups | no existe | links de sugerencia sobre el input (§5.3.1) | P3 |
| 9 | Switch knob `#fff` | hardcode | `--vscode-button-foreground` | P3 |
| 10 | Thinking | caja `card--thinking` con borde azul link | fila colapsable Copilot (brain azul, shimmer en vivo), misma lógica de CollapsibleCard | P2 |
| 11 | Salidas de tool | `pre` máx 320px | codeblock bordeado máx ~13 líneas + ver-más + diff coloreado (§5.2) | P2 |
| 12 | ContextBar | barra fija (identidad frida) | conservar + niveles low/mid/high por tokens · **working descartado tras F5: se encimaba con la info de contexto (revertido 2026-08-19, §10.10)** | P1 |
| 13 | Iconografía | `lucide-react` en ~20 componentes | Codicons (`@vscode/codicons`) con wrapper `<Codicon>` (§4); marca Frida en SVG inline; migración por slices verificando `grep -rn 'from "lucide-react"' webview` → sólo decrece | P2 |

Notas: la **lógica de interacción ya resuelta se conserva siempre** (auto-apertura
con umbral/parcial, prioridad del usuario, stick-to-bottom, zonas de teclado del
QuestionsPanel, confirmaciones). Este sistema cambia la **piel y la estructura
visual**, no el comportamiento.

**Nota de autorización (ver §0):** estas filas REPOSICIONAN elementos
existentes y necesitan autorización explícita del dueño del producto antes de
aplicarse: **fila 3** (estado «procesando» pasa del proc-bar sobre el textbox al
ContextBar inferior; submit muta a stop), **fila 5** (todo pasa de filas
sueltas a widget persistente dockeado sobre el input), **fila 6** (Settings
deja de ser fullscreen y pasa a overlay centrado) y **fila 2** (las tools del
turno completado se agrupan y colapsan por defecto — cambia lo que el usuario
ve al terminar un turno). El resto son cambios de piel o adiciones.
Cuando se autorice una de estas filas, registrar la decisión (fecha + quién) en
la propia fila de §8.

---

## 9. Verificación (Definition of Done para cambios de UI)

1. **Tokens**: `grep -nE "#[0-9a-fA-F]{3,8}" webview/styles.css` → sólo §2.3 (con
   comentario) o nuevos tokens `:root` con fallback. Cero hex sueltos.
2. **3 temas**: probar Dark+, Light+ y Alto contraste (cambiar el tema del editor y
   recargar el webview). Verificar: fondos, texto, bordes, selects/scrollbars
   (color-scheme), hover/focus. El mockup `mockup-frida-transcript.html` con su
   switcher sirve de referencia visual lado a lado.
3. **Reduced motion**: activar `workbench.reduceMotion` y verificar que shimmer/
   spinners/beam/expand colapsen a estático legible.
4. **Contraste**: texto secundario legible sobre `editor-background` en light (el
   gris de descriptionForeground del tema lo garantiza si NO lo hardcodeas).
5. **Botones**: click visual (hover), teclado (Enter/Espacio), focus-visible.
6. **Suite**: `npm run typecheck` + suite completa (baseline 12 fallas) + rebuild
   del VSIX si tocaste `src/` o `webview/`.
7. **Íconos**: elementos nuevos usan codicons (§4);
   `grep -rn 'from "lucide-react"' webview` sólo decrece con la migración, nunca
   crece. Si agregaste la fuente: verificar que el `.ttf` llegó a
   `dist-webview/assets/` tras el build y que los glifos renderizan (sin tofu □).

---

## 10. Erratas de estilo aprendidas (no repetir)

1. **Cascada**: `.hidden-panel { display:none }` vs `.scrim { display:flex }` —
   misma especificidad, gana el último en la hoja ⇒ el overlay nunca se ocultaba.
   Fix: `.scrim.hidden-panel { display:none }` (spec (0,2,0)).
2. **UA de `<button>`**: sin `background: transparent` + `font: inherit`, el
   navegador pinta `buttonface` claro con Arial (`.sub-version` ilegible).
3. **Fondo raíz**: sin `background` en `html/body`, el tema "no cambia" (el blanco
   del UA domina la página).
4. **`color-scheme`**: sin él, scrollbars y `<select>` nativos quedan claros en
   dark.
5. **`innerHTML`**: bloqueado por el linter — DOM programático (`createElementNS`
   para SVG; el CSS estila `svg` por selector de clase).
6. **Emuladores DOM (linkedom/jsdom) no computan estilos**: para bugs visuales
   verificar con navegador real (Chromium headless + `getComputedStyle`, ver
   técnica en la sesión 2026-08-19) o a ojo con el switcher del mockup.
7. **Narrowing de closures (TS)**: variables `let` mutadas dentro de
   `forEach`/callbacks y leídas DESPUÉS del loop se narrowean a `never`
   (group-stats F3). Usar `for` plano en el mismo scope — TS sí rastrea la
   asignación.
8. **JSX comment como rama de ternary**: `{cond ? ( {/* … */} <div/> ) : …}
   es error de parse (un comentario no es expresión). El comentario va ANTES
   del ternary o dentro de un fragment.
9. **Limpieza por regex: verificar qué se llevó puesto** — al borrar bloques
   por patrón, las declaraciones intercaladas (`type X`, `const str`) pueden
   desaparecer con ellos. Revisar tsc tras cada limpieza, no confiar en el
   match.
10. **El estado «working» NO vive en el ContextBar (revertido 2026-08-19):**
    al integrar spinner+label en la fila de contexto (F5) se encimaba con la
    info de tokens y desplazaba la lectura del nivel de contexto. Decisión del
    usuario tras verlo en vivo: el indicador «pensando» vuelve a la proc-bar
    sobre el textbox (posición original de frida). El beam del Composer (F4)
    sí se conserva — es decorativo del borde, no ocupa renglón. Lección: los
    strips de estado inferiores son de LECTURA (contexto); lo mutable/en vivo
    va arriba del input, donde no compite con métricas.
11. **Métricas de grep consistentes**: comparar archivos (`-l`) con archivos,
   líneas (`-n`) con líneas — el criterio "lucide no crece" del plan se definió
   en archivos; contar líneas da otro número y falsas alarmas.

---

## 11. Fuentes y referencias

- Renderer de tool invocations (VS Code): `reference/vscode-core-renderer/
  chatToolInvocationPart.ts`, `chatToolInputOutputContentPart.ts`,
  `chatProgressContentPart.ts`, `chat.css` (4931 líneas).
- Input part / footer: `chatInputPart.ts` (5002 líneas), `chatInputStack.ts/css`,
  `chatFollowups.ts`, `modePickerActionItem.ts`.
- Paneles: `chatTodoListWidget.ts`, `chatQuestionCarouselPart.ts` (+css),
  `chatPlanReviewPart.ts` (+css), `askQuestionsTool.ts`.
- Contexto: `chatContextUsageWidget.ts/css`, `chatContextUsageDetails.ts/css`.
- Mockups: `mockup.html` (anatomía), `mockup-frida-copilot.html` (todas las tools),
  `mockup-frida-transcript.html` (**integral**: app completa, 3 temas, dock,
  overlays, beam, anillo).
- Webview actual de frida: `webview/components/*` (ToolCard, CollapsibleCard,
  Composer, QuestionsPanel, SettingsHub, SessionsPanel, ContextBar, WorkspaceBar…)
  y `webview/styles.css` (4658 líneas).
- Íconos: paquete `@vscode/codicons` (cheat sheet en `dist/codicon.html` del
  paquete; repo `microsoft/vscode-codicons`). Lucide (`lucide-react`) queda como
  legado hasta completar la fila 13 de la §8.
