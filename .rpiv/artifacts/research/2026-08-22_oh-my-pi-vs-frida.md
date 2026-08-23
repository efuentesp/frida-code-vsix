# oh-my-pi (OMP) vs Frida — inventario y oportunidades

**Fecha:** 2026-08-22 · **Tipo:** investigación competitiva
**Pregunta:** ¿Qué funciones tiene oh-my-pi, qué enriquecería a Frida y por qué?

## Fuentes consultadas (primarias)

- Repo: `github.com/can1357/oh-my-pi` — API `repos/…` (metadatos) y `git/trees/main?recursive=1` (árbol completo: 6,575 archivos; crates 602; python 149; docs 137)
- `README.md` (vía raw.githubusercontent) — superficie completa: 21 capacidades numeradas, 31 tools, 60+ providers, paquetes monorepo
- `docs/tools/edit.md` — gramática completa de hashline
- `docs/memory.md` — 4 backends de memoria + pipeline de consolidación
- `docs/advisor-watchdog.md` — subsistema advisor (roster WATCHDOG.yml)
- `docs/ttsr-injection-lifecycle.md` — reglas de stream (abort+inyecta+reintenta)
- `docs/agent-hub.md` — supervisión de subagents

**Metadatos:** fork de pi-mono (Mario Zechner) por Can Bölük (can1357,_reverse engineer conocida). MIT. TypeScript + Rust (~80k LoC Rust + 80k vendored). 26,538 ⭐, 2,581 forks, activo (push diario). npm `@oh-my-pi/pi-coding-agent`. Sitio omp.sh. Nota: un intento de investigación por subagente falló por el permission-system (sin UI de aprobación); se investigó en sesión principal.

## Inventario funcional de OMP (verificado)

### Edición — hashline (docs/tools/edit.md)

- Patches anclados por hash de contenido: `[PATH#TAG]` + ops `PUT N.=M:`, `CUT N*`, registros con nombre, `MV`, `REM`.
- El tag (4 hex del contenido normalizado) proviene del último read/grep/edit → **editar archivo rancio se rechaza antes de corromper** (recovery por snapshot solo si es unívocamente seguro).
- Anclas de bloque sintáctico vía tree-sitter (`PUT N*`).
- Benchmarks declarados: Grok Code Fast 6.7%→68.3% éxito de edición; Grok 4 Fast −61% tokens de salida; MiniMax 2.1× pass rate.
- Gramática Lark para constrained decoding; modo aplicable por modelo (`resolveEditMode`: hashline/apply_patch/patch/replace).

### Memoria (docs/memory.md)

- 4 backends: `off` / `local` / `hindsight` (remoto) / `mnemopi` (SQLite local).
- Local: pipeline de 2 fases en background al arrancar — (1) extracción por sesión (rol default, concurrencia 8, leases), (2) consolidación cruzada (rol smol) → `MEMORY.md` + `memory_summary.md` + `skills/` generadas + `learned.md` (lecciones explícitas, cap 100, redacción de secretos).
- Inyección al arranque con límite compartido (5k tokens). URL `memory://` legible por `read`.
- Tools: `retain`/`recall`/`reflect`/`memory_edit`/`learn` (gated por backend).

### Advisor + WATCHDOG (docs/advisor-watchdog.md)

- 1..N modelos revisores leyendo el **delta** del transcript del agente primario en cada turno; contexto propio, append-only, con promoción/compactación/re-prime.
- Tool `advise` con severidades: `nit` (aside), `concern` (interrumpe/steerea), `blocker` (interrumpe incluso tras respuesta terminal).
- `WATCHDOG.md` (prioridades de revisión, solo del advisor) + `WATCHDOG.yml` (roster: nombre, modelo, tools, instrucciones).
- Emission guard: normalización NFKC, filtro de frases vacías ("lgtm"), dedupe exacto (FIFO 4096), máx 1 nota por update — anti-ruido.
- `advisor.syncBacklog` (off/1/3/5): espera acotada (30s) para que el advisor alcance al primario.
- Cuarentena de output inseguro (shell destructivo, override de instrucciones). Uso separado atribuido en `__advisor*.jsonl`.

### TTSR — reglas "time-traveling" (docs/ttsr-injection-lifecycle.md)

- Reglas con `condition` (regex) o `astCondition` (ast-grep) vigilando **streams** de texto/thinking/args de tools.
- Match interrumpible → `agent.abort()` inmediato → drop del parcial (`contextMode: discard`) → inyección `<system-interrupt>` → reintento desde el mismo punto.
- Match no-interrumpible → recordatorio in-band prependeado al toolResult (`<system-reminder>`).
- Repeat policies `once` / `after-gap N`; persistencia `ttsr_injection` en la sesión (sobrevive resume); reglas builtin + discovery con dedupe.

### Agent Hub (docs/agent-hub.md)

- Roster vivo de subagents: status, modelo, costo, tokens, toolCalls, edad; vista flat o árbol padre/hijo; inspector (tool actual, contexto, worktree branch).
- Entrar al transcript vivo del subagent, **steer** en caliente, revivir parked, matar atascado — sin abortar la sesión padre.
- Descubre subagents persistidos al resumir (JSONL → parked rows); advisors como filas read-only.

### Tools (31, README)

Archivos/búsqueda: read (URLs, PDFs, SQLite, ssh://, esquemas internos), write, edit, ast_edit (preview staged + `xd://resolve` accept), ast_grep (50+ gramáticas), grep, glob.
Runtime: bash (46 coreutils in-process, PTY, jobs), eval (Python+JS persistentes con **re-entrada a tools del agente** vía loopback).
Inteligencia: lsp (14 ops), debug (DAP: lldb/dlv/debugpy), security_scan.
Coordinación: task (fan-out con worktrees aislados + outputSchema), hub (mensajería entre agentes), todo, ask.
Desktop/web: browser (stealth, CDP, relay de Chrome propio), computer (ventanas, screenshots, input nativo, AX tree), web_search (23 backends en cadena auto + extracción site-aware: github/registries/arxiv/SO/NVD/OSV/KEV), github, generate_image, inspect_image, tts.
Memoria: checkpoint, rewind (poda exploratoria + reporte), retain, recall, reflect, memory_edit, learn, manage_skill.

### Providers y routing (README)

- 60+ providers; **10 roles** de modelo: default, smol (subagents baratos), slow (razonamiento), plan, commit, vision, designer, task, advisor, tiny.
- Fallback chains por rol/modelo (429/quota → siguiente).
- Round-robin de credenciales con afinidad de sesión y backoff por credencial.
- Path-scoped models (`path:` prefijo en enabledModels/disabledProviders).
- Custom providers YAML (`~/.omp/agent/models.yml`) con 9 APIs soportadas.

### Otros

- `/collab`: sesión viva en relay con link+QR, read-write o view-only, frames sellados client-side.
- `omp commit`: splits atómicos ordenados por dependencias, rechazo de ciclos, scoring fuente>tests>docs, lockfiles fuera del análisis.
- Esquemas internos: `pr://`, `issue://`, `agent://`, `skill://`, `conflict://N` (resolver con `@theirs`/`@ours`/`@base`), `memory://`, `history://`, `xd://`.
- Magic keywords en prosa: `ultrathink`, `orchestrate`, `workflowz`.
- Importers nativos de .claude/.cursor/.windsurf/.gemini/.codex/.cline/copilot (sin migración).
- Nativo: ripgrep/glob/find in-process; brush (bash embebido) + 58-67 coreutils; PTY; workspace isolation reflink (APFS/btrfs/zfs/overlayfs); snapcompact (compresión de contexto a bitmap frames); BPE in-process.
- 4 entradas: TUI, `-p` one-shot, SDK Node, RPC stdio, ACP (Zed).
- Benchmarks propios: metaharness + typescript-edit-benchmark.

## Superficie actual de Frida (para el contraste)

Webview estilo Copilot (chat, sessions, environment doctor, settings hub, productivity/usage, workflows panel, approvals, questions overlay) · providers Frida-Enterprise (OAuth+catalog+side-channels)/Antigravity/Ollama/OpenAI/custom, **un modelo activo sin roles** · frida-codebase-index (v0.30.0: 4 proveedores embeddings, ping, autoindex, progreso vivo) · frida-extensible-workflows (DSL JS con lanes) · frida-subagents (detached) + subagent_gate · frida-aidd (pipeline discover→validate) · frida-pipeline (skills-sync) · frida-agent-browser · frida-permission-system · frida-hermes-memory · frida-knowledge-base · frida-cc-plugins (marketplace) · frida-mcp-adapter · frida-git-sync · frida-sandboxes · todo-web · ask-user-question-web · forensics/goal/tea/context/supi/multi-skills/pix-skills · session-stats · worktrees (how-to-frida-worktrees.md) · skills commit/review de rpiv.

## Matriz comparativa (resumen)

| Dimensión | OMP | Frida hoy | Delta |
| --- | --- | --- | --- |
| Edición | hashline: anclas hash, −61% tokens, rechaza rancio | edit de pi (str-replace), sin guard de frescura | OMP gana claramente |
| Memoria | 4 backends, consolidación 2-fase, memory:// | hermes-memory (sin consolidación cruzada documentada) | OMP |
| Modelos | 10 roles, fallback chains, credenciales RR, path-scoped | 1 modelo activo, cambio manual | OMP |
| Revisión en vivo | advisor N-modelos, WATCHDOG.md/yml, severidades | review post-hoc (skills rpiv, subagent reviewers) | OMP |
| Reglas | TTSR stream (abort+inyecta+reintenta), repeat policies | AGENTS.md estático (context tax por turno), permission-system | OMP |
| Supervisión subagents | Agent Hub: roster/steer/revive/kill | detached-spawn + panel workflows; sin UI de supervisión de subagents | OMP |
| GitHub | pr://, issue://, gh tool, conflict:// | gh por bash, lifecycle manual por issues | OMP |
| Web search | builtin 23 backends + extracción site-aware | ninguno (depende de /web-tools; falló en esta sesión) | OMP |
| Workflows | workflowz keyword → task | frida-extensible-workflows: DSL más rico (lanes, gates, budgets) | Frida |
| UX host | TUI terminal | webview VS Code estilo Copilot | Frida |
| Corporativo | — | Enterprise OAuth, side-channels, AIDD, permission-system, issues lifecycle | Frida |
| Índice semántico | — (no index de codebase) | frida-codebase-index completo (v0.30.0) | Frida |
| Entorno/diagnóstico | — | environment doctor | Frida |

## Oportunidades para Frida (priorizadas)

1. **Roles de modelo (mínimo: default/smol/advisor/commit)** — smol enruta subagents y fases baratas (extracción de memoria, resúmenes) a Ollama local = costo cero; commit role para changelogs. Fallback chain Enterprise→Ollama = resiliencia corporativa. Frida ya tiene la infraestructura de providers multi; falta la capa de routing por intención.
2. **Advisor en vivo + WATCHDOG.md** — un reviewer (Ollama local, costo 0) leyendo deltas de cada turno con severidades nit/concern/blocker y emission guard anti-ruido. Encaja directo en la cultura de Frida (issues, validación humana): el advisor detecta "no referenciaste el issue", "rompiste tokens --vscode-*", "falta test". La webview renderiza las notas mejor que cualquier TUI.
3. **TTSR para reglas de proyecto** — reemplaza el context tax de reglas siempre-inyectadas: regex/AST sobre el stream, abort+inyecta+reintenta, repeat after-gap. Casos Frida: es-MX, `Refs #N` en commits, tokens --vscode-* en UI, no usar `Closes #N`. Requiere antes arreglar el clúster de abort (#85/#90/#96) — OMP demuestra que abort limpio es prerrequisito.
4. **Port de hashline** — paquete MIT standalone (`packages/hashline`) con gramática y applier; se puede portar como variante del edit de pi con `resolveEditMode` por modelo. Los números (6.7%→68.3% en modelos medianos) son el mayor multiplicador de calidad por token para Enterprise/Antigravity. La webview ya previewa diffs: la carta (proposed) + Accept de ast_edit es el patrón visual ya usado por Frida en approvals.
5. **Agent Hub tab en la webview** — Frida tiene mejor canvas que la TUI: roster vivo (costo, tokens, toolCalls), transcript en vivo, steering input, revive/kill. Aprovecha frida-subagents/detached-spawn existentes + session-stats para métricas.
6. **web_search builtin** — cadena de providers con fallback anónimo (duckduckgo/startpage sin key como piso) + extracción site-aware. Esta misma sesión de research quedó coja sin keys; un piso keyless habría funcionado.
7. **conflict:// en worktrees** — Frida documenta el flujo manual de worktrees; resolver conflictos con `@theirs/@ours/@base` por URL bajaría la fricción del flujo multi-rama del equipo.
8. **Memoria con consolidación 2-fase** — port del patrón (extracción por sesión → MEMORY.md + summary + skills generadas) sobre hermes-memory; roles smol la hacen barata.
9. **pi-voice para el dictado (#95)** — OMP ya resolvió audio (crate MIT pi-voice: captura, Opus, WebRTC) y TTS; base directa para el botón 🎤 pendiente.
10. **Magic keywords** — `workflowz`→frida-extensible-workflows, `orchestrate`→subagent_gate, `ultrathink`→thinking máximo. Barato, buen UX, cero UI nueva.

## Por qué estas y no otras

- La tesis de OMP es que el **harness** (no el modelo) mueve las métricas: edición confiable, routing por intención, revisión en vivo, reglas oportunas. Frida ya ganó en host UX y corporativo; el delta está exactamente ahí.
- Frida tiene ventaja estructural para advisor/roles: Ollama local ya configurado (#110, nomic-embed working) hace el rol smol/advisor prácticamente gratis, y Enterprise provee el modelo fuerte.
- Computer-use, collab, native Rust y evals quedan fuera: nicho, costo alto, o ya cubierto (ffgrep/fffind indexados; VS Code trae ripgrep).

## Nota de método

Subagente de investigación bloqueado por permission-system (aprobación sin UI) — se investigó en sesión principal vía API de GitHub + raw.githubusercontent. Afirmaciones de benchmarks son las declaradas por el autor de OMP en README/blog (no reproducidas aquí).
