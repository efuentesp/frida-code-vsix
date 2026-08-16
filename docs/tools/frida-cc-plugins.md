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
| `{source:"github", repo, ref}` | Fase 2 (fetch remoto) — reportado |
| `{source:"url"/"git", url, ref, sha, path}` | Fase 2 — reportado |
| Marketplace local (path del FS) | ✅ Vía `marketplace add <path>` |

## Git

Marketplaces remotos usan `git clone --depth 1 --filter=blob:none` (spawn; git está
presente en prácticamente todo host con VS Code). Alternativa sin git binario:
`isomorphic-git` (documentado como fase 2). `#ref` en la referencia pinea branch/tag
(`--branch`). URLs SSH (`git@host:path.git`) soportadas.

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
