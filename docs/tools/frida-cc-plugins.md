# `frida-cc-plugins` (plugins de Claude Code en frida)

Instala y ejecuta en frida **plugins del ecosistema Claude Code**: consume sus
marketplaces (GitHub `owner/repo`, URLs https, o **paths locales**), lee el manifiesto
`.claude-plugin/plugin.json` y **convierte sus componentes** a la infraestructura
nativa de frida. Porte nativo del diseño de dos upstreams (ambos MIT, atribución en
ADR-0057): *readers* y contrato de compatibilidad de `@nklisch/pi-plugins`;
arquitectura runtime (`resources_discover` + root aislado + config declarativa +
staging atómico + colisiones MCP) de `pi-claude-marketplace` (acolomba).

## Por qué porte nativo (y no wrapper)

- **Windows soportado**: los prompts se materializan con `-` (NTFS prohíbe `:` en
  filenames; pi-claude-marketplace materializa `:` literal y no soporta Windows).
- Sin `node>=24`, sin sqlite, sin drift de receipts, sin TUI.
- **Frida ya es el host**: skills loader, prompts, `frida-subagents`,
  `frida-mcp-adapter`, permission gates.

## Tabla de conversión

| Componente Claude | Destino frida | Detalle |
| --- | --- | --- |
| `skills/<s>/SKILL.md` | Skills pi | Copia a `~/.frida/cc-plugins/resources/skills/<plugin>/<s>/` con `name` del frontmatter reescrito a `<plugin>-<s>` (strings puros, sin eval YAML). Invocación: `/skill:<plugin>-<s>` |
| `commands/<c>.md` | Prompts pi | Plano: `resources/prompts/<plugin>-<c>.md` (el loader deriva el nombre del filename; es no-recursivo). `$ARGUMENTS` idéntico |
| `.mcp.json` | `frida-mcp-adapter` | Llaves **con nombre original** en `~/.frida/mcp.json`; placeholders `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PROJECT_DIR}`/`${user_config:*}` sustituidos. Colisión = install falla con guía (nunca renombra — rompería referencias) |
| `agents/`, `hooks/`, `.lsp.json`, `monitors/`, `bin/`, `settings.json` | — | Metadata-only reportado en `/ccplugin info` (fase 2: agents vía frida-subagents; hooks con approval gates) |

## Layout y estado

```text
~/.frida/cc-plugins/
├── cc-plugins.json              # registro declarativo (fuente de verdad)
├── marketplaces/<slug>/         # clones git (los locales se referencian in situ)
├── installed/<plugin>@<rev>/    # contenido del plugin (copia inmutable)
└── resources/
    ├── skills/<plugin>/<s>/     # expuesto vía resources_discover
    └── prompts/<plugin>-<c>.md
```

- **Root aislado**: cero contaminación de dirs del usuario; uninstall = borrar el
  subdir; enable/disable = `resources_discover` no devuelve paths.
- **Registro declarativo + reconcile**: si falta material (máquina nueva, borrón), la
  factory re-instala desde el marketplace al cargar (self-healing; nunca bloquea la
  sesión). Las llaves MCP propias se excluyen del chequeo de colisión en re-installs.
- Escrituras atómicas (tmp + rename) en el registro.

## Uso

```text
# (auto) el primer arranque agrega el oficial solo (intento único)
/ccplugin bootstrap                        # manual: agrega anthropics/claude-plugins-official
/ccplugin marketplace add owner/repo       # https://...git, git@host:path.git, o ~/mi-marketplace
/ccplugin marketplace add owner/repo#v1.2  # `#ref` pinea branch/tag del clone
/ccplugin marketplace add ~/mi-marketplace # marketplace LOCAL (sin git)
/ccplugin list --available [mkt]           # catálogo instalable (remotos marcados)
/ccplugin info <plugin>[@mkt]              # inventario PRE-install desde el catálogo
/ccplugin add <plugin>@<marketplace>       # instala (refresca el catálogo si >30s)
/ccplugin list [--enabled|--disabled]      # estado + componentes omitidos
/ccplugin enable|disable <plugin>          # filtra resources_discover
/ccplugin remove <plugin>                  # limpia recursos + MCP + registro
/ccplugin marketplace list|update|remove   # ciclo de vida de marketplaces
/reload                                    # tras mutaciones
```

Los plugins de un marketplace se listan con su catálogo; la extensión **nunca instala
nada sola** — todo install requiere `/ccplugin add` explícito (gate D8:
`frida.ccPlugins.enabled`, default true; sesión main).

## Sources soportados (MVP)

| Source del catálogo | Estado |
| --- | --- |
| `"./path"` (relativo al marketplace) | ✅ Instala |
| `{source:"github"/"url"/"git-subdir", ..., ref, sha}` | ✅ **Fase 2 (#50)**: clone al instalar; `sha` (40 hex) = pin exacto verificado; `ref` → `--branch` |
| `{source:"npm", package, version, registry}` | ✅ `npm install` (registry https privado) |
| `{source:"archive", url, sha256}` | ✅ zip https ≤256 MiB + digest verificado + unzip propio (zlib, cero deps nuevas) |
| Marketplace local (path del FS) | ✅ Vía `marketplace add <path>` |

## Presentación de resultados

`ctx.ui.notify` es un toast efíreo — inadecuado para listas. Los widgets nativos
de VS Code (showQuickPick) quedan fuera del webview, roban foco y se cierran
solos; y el UiDialog de 203 filas sin filtro era inoperable (hallazgos e2e
#49). La UI es un **panel nativo del webview**:

- **Contrato** (`panel.ts`): el comando emite un `CcPanelRequest` (id, título,
  filas serializables con ficha markdown + ejecutor de acciones host-side) vía
  `opts.panel` (sink que `extension.ts` registra). El webview responde
  `ccplugins_panel_action {id, action, ref}`; el host ejecuta, confirma con
  toast corto y el comando re-emite filas frescas con el MISMO id (el componente
  conserva filtro y foco).
- **Componente** (`webview/components/CcPluginsPanel.tsx`): tabs Discover |
  Instalados | Marketplaces | Errores (estilo `/plugins` de Claude Code; Errores
  oculta si vacía). Discover/Instalados: lista fuzzy (subseqScore, como el
  autocompletado de `/`) a la izquierda + ficha markdown y botones a la derecha;
  chip de categoría por fila (no hay downloads públicos — la categoría+autor del
  catálogo son la señal) y "Actualizado"/autor/homepage en la ficha (el primero
  llega async: git log del dir en el clon, cacheado, vía `ccplugins_row_meta`).
  Marketplaces: tarjetas (contador, refreshedAt relativo, auto-update) con
  Actualizar/Quitar y campo Agregar (los 4 sources). Errores: avisos runtime
  (bootstrap/marketplace/install) con Reintentar. Zonas de foco tabs/list/buttons/add
  (estilo QuestionsPanel): `Tab` cicla · `←/→`/`1-4` tabs · escribir filtra ·
  `↑↓` mueve · `⏎` acción primaria · `Esc` sube de nivel hasta cerrar.
- **Output channel** `Frida — cc-plugins` (`presenter.ts`): append silencioso
  de cada comando — log de consulta, nunca roba foco.

Sin sink (tests/TUI) degrada al notify clásico. `/ccplugin info <nombre>`
resuelve el plugin en TODOS los marketplaces registrados y abre el panel con
su ficha.

## Arranque no bloqueante

Bootstrap auto del marketplace oficial, settings de equipo (`extraMarketplaces`/
`enabledPlugins`) y auto-update corren **en background** tras abrir la sesión (singleton):
la sesión abre al instante con lo ya instalado y los avisos llegan como notificaciones
("ejecuta /reload" al terminar) — paridad con Claude Code, que instala async y pide
`/reload-plugins`. Los spawns de git/npm llevan `GIT_TERMINAL_PROMPT=0` (sin prompts que
cuelguen el extension host) y timeout de 120s.

## Git

Marketplaces remotos usan `git clone --depth 1 --filter=blob:none` (spawn; git está
presente en prácticamente todo host con VS Code). Alternativa sin git binario:
`isomorphic-git` (documentado como fase 2). `#ref` en la referencia pinea branch/tag
(`--branch`). URLs SSH (`git@host:path.git`) soportadas.

**Lado autor (paridad con `claude plugin validate`, #51)**:

- `/ccplugin validate <dir>` — valida marketplaces y plugins con los MISMOS
  readers del loader (cero falsos OK): schema, duplicados, sources (traversal,
  https), versiones entry↔plugin.json, renames (terminación/ciclos),
  strict:false sin conflictos, descubribilidad de componentes. ✔/⚠/✖ por check;
  warnings no bloquean.
- `metadata.pluginRoot` — sources string sin `./` resuelven contra la base
  (`"formatter"` ≡ `"./plugins/formatter"`).
- `renames` — migración automática al cargar (reconcile): rename → uninstall del
  viejo + install del nuevo con notice (encadenado); `null` → uninstall limpio.
  Install con nombre viejo sigue el map y registra el nombre vigente.
- `strict: false` — la entrada del catálogo ES la definición (plugin.json
  opcional; si declara componentes → conflicto loud). Skills/commands/MCP solo
  de la entrada.
- Metadata de descubrimiento — `displayName` (en `list --available`), `owner`
  como objeto, `category`/`tags` parseados.

**Fase 2 (#50) — scopes, equipo, auto-update**:

- **Scopes**: `--scope user|project|local` al instalar. `project` escribe
  `<repo>/.frida/cc-plugins.json` (commit-eable); `local` escribe
  `.frida/cc-plugins.local.json` (no versionar). Lectura merged con precedencia
  local > project > user; uninstall/enable operan en el scope donde vive el plugin.
- **Team settings** (paridad `extraKnownMarketplaces`/`enabledPlugins`):
  `frida.ccPlugins.extraMarketplaces` (refs de marketplaces) y
  `frida.ccPlugins.enabledPlugins` (`"plugin@marketplace": true`) — el
  reconcile los instala al cargar.
- **Auto-update**: `/ccplugin marketplace autoupdate|noautoupdate <mkt>` —
  refresh background tras el arranque; rev nueva → re-install de sus plugins +
  notifica `/reload`. El oficial lo trae on (bootstrap).
- **Context cost**: `/ccplugin info` pre-install estima tokens/turno (bytes de
  skills+commands / 4).

**Paridad con `/plugin` de Claude Code** (mini-batch): bootstrap automático del
oficial en el primer arranque (intento único, offline no bloquea), `list --available`
con marcadores de instalado/remoto, `info` pre-install con inventario "instalará:",
refresh-before-lookup con throttle de 30s (offline degrada al catálogo cacheado) y
filtros `--enabled/--disabled`. Diferencias deliberadas: nombres MCP originales (no
`mcp__plugin_*`), prompts con `-` (Windows) y fuentes remotas de plugin (github/url)
quedan en fase 2.

## Tests

`test/frida-cc-plugins/` — `readers.test.ts` (validación de paths/repos/nombres,
manifiestos, catálogos con sources, discovery con no-soportados), `convert.test.ts`
(reescritura de frontmatter, namespacing con elisión, prompts planos, placeholders
MCP, merge/unmerge con colisión, registry atómico), `wrapper.test.ts` (E2E con
marketplace local: install → resources_discover → disable → uninstall → reconcile
self-healing → colisión MCP con guía → comando /ccplugin).

## Validación e2e (pendiente — criterio del issue #49)

1. Dev Host → `/ccplugin bootstrap` → marketplace oficial agregado.
2. `/ccplugin add <plugin-real>@claude-plugins-official` → instalar y `/reload`.
3. `/skill:<plugin>-<skill>` invocable; `/<plugin>-<command>` funciona con `$ARGUMENTS`.
4. Server MCP del plugin visible en `/mcp` (nombre original).
5. Uninstall/disable sin residuos.

## Referencias

- Issue [#49](https://github.com/efuentesp/frida-code-vsix/issues/49) · ADR-0057 ·
  Research `docs/research/cc-plugins-feasibility.md` (+ probe).
- Upstreams del diseño: `@nklisch/pi-plugins` (MIT, Nathan Klisch) ·
  `pi-claude-marketplace` (MIT, acolomba).
- Formato Claude: [plugins-reference](https://code.claude.com/docs/en/plugins-reference) ·
  [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces).
