# `frida-cc-plugins`: porte nativo para plugins de Claude Code

**Estado:** aceptado (#49). *Investigación previa: `docs/research/cc-plugins-feasibility.md` (3 rondas) + probe empírico anexo.*

## Contexto

El issue #49 pide instalar en frida **plugins del ecosistema Claude Code**: consumir sus
marketplaces (GitHub shorthand, `anthropics/claude-plugins-official`, `claude-community`),
leer el manifiesto `.claude-plugin/plugin.json` y ejecutar sus componentes.

Dos upstreams de referencia (ambos MIT, ambos probeados/leídos a fondo — research):

- **`@nklisch/pi-plugins`** — readers de formato Claude puros + contrato
  `COMPATIBILITY.md` (tabla evento Claude↔pi, matcher de tools, placeholders,
  verdicts). Su runtime (sqlite/journals/TUI, `node>=24`) NO se portea.
- **`pi-claude-marketplace`** (acolomba) — la mejor referencia de **arquitectura
  runtime**: `resources_discover` + root aislado, config declarativa con reconcile,
  staging+rename atómicos, chequeo de colisiones MCP, `isomorphic-git`.
  Limitación fatal para envolverlo: materializa prompts con `:` literal en
  filenames (*"Windows is explicitly not targeted"*) y frida sí soporta Windows.

**Frida ya es el host** (skills loader, prompts, `frida-subagents`,
`frida-mcp-adapter`, permission gates). Falta la capa de lectura + conversión.

## Decisión

**D1 — Porte nativo.** Módulo `src/tools/frida-cc-plugins/`: readers propios
(diseño nklisch), installer, convertidores y exposición de recursos (patrón
pi-claude-marketplace). Sin sqlite, sin TUI, sin `node>=24`. Estado en JSON.

**D2 — Root aislado + `resources_discover` (patrón acolomba).**

```text
~/.frida/cc-plugins/
├── cc-plugins.json              # registro declarativo (fuente de verdad)
├── marketplaces/<name>@<rev>/   # clones de marketplaces (git spawn --depth 1)
├── installed/<plugin>@<rev>/    # contenido del plugin (copia inmutable)
└── resources/
    ├── skills/<plugin>/<skill>/ # SKILL.md con name reescrito
    └── prompts/<plugin>-<cmd>.md
```

La factory registra un handler `resources_discover` que devuelve
`skillPaths`/`promptPaths` bajo `resources/` — el resource loader del SDK los carga
como recursos de extensión. **Cero contaminación de dirs del usuario**; enable/disable
= no devolver paths; uninstall = borrar el root del plugin. Reconcile al cargar:
el registro es declarativo y la factory re-materializa lo faltante (self-healing).

**D3 — Skills: copia + reescritura de frontmatter.** Nombre de invocación =
frontmatter `name` (validado `^[a-z0-9-]+$`). El conversor copia cada `skills/<s>/`
a `resources/skills/<plugin>/<s>/` y reescribe/asegura `name: <plugin>-<s>` —
**manipulación de strings pura, sin eval YAML** (mitigación de inyección de
contenido no confiable, patrón acolomba). Invocación: `/skill:<plugin>-<s>`.

**D4 — Commands: prompts con hyphen (no colon).** El loader de prompts deriva el
nombre del **filename** (basename sin `.md`). El conversor materializa
`commands/<c>.md` → `resources/prompts/<plugin>-<c>.md` (frontmatter compatible,
`$ARGUMENTS` idéntico). **Hyphen y no `:`** porque frida soporta Windows (NTFS
prohíbe `:` en filenames — la razón por la que no envolvemos pi-claude-marketplace).
Elisión de prefijo: si el comando ya empieza con `<plugin>-`, no se duplica.
Commands en subdirectorios → metadata-only reportado en el MVP.

**D5 — MCP: nombres originales + colisión = fallo (patrón acolomba).** Los servers
del plugin se registran bajo su **nombre original** en `~/.frida/mcp.json`
(quiero que skills/commands referencien los servers por nombre; renombrar rompería
las referencias). Antes de instalar se chequea colisión contra los slots de config
que lee el adaptador (`~/.config/mcp/mcp.json`, `~/.frida/mcp.json`, `<cwd>/.mcp.json`,
`<cwd>/.pi/mcp.json`); si el nombre ya existe → el install **falla con guía**.
Placeholders sustituidos al materializar: `${CLAUDE_PLUGIN_ROOT}` → root instalado,
`${CLAUDE_PROJECT_DIR}` → cwd, `${user_config:*}` → config del plugin si existe.
Entradas escritas con marker de procedencia; uninstall limpia solo sus llaves.

**D6 — MVP: skills + commands + MCP.** `agents/*.md`, `hooks/hooks.json`,
`.lsp.json`, `monitors/`, `bin/`, `settings.json` → **metadata-only reportado**
(degradación suave del contrato nklisch: instala, salta, reporta — nunca bloquea).
Fase 2: agents vía `frida-subagents` (con `--map-model` estilo acolomba), hooks con
approval gates + dispatcher propio (referencia: `docs/hooks-compatibility.md` de
acolomba), PATH de `bin/`.

**D7 — Git y atomicidad.** MVP: spawn de `git clone --depth 1` (git presente en
prácticamente todo host con VS Code; guía accionable si falta). `isomorphic-git`
(puro JS, sin binario) documentado como alternativa para hosts sin git. Escrituras
con staging + rename atómico en el mismo FS (patrón acolomba); receipt idempotente
por plugin en `cc-plugins.json` (misma rev = no-op).

**D8 — Gate y superficie.** Setting `frida.ccPlugins.enabled` (default `true`: la
extensión no instala nada sola — todo install requiere `/ccplugin add` explícito).
Comandos `/ccplugin marketplace add|list|remove|update`, `/ccplugin
add|remove|list|enable|disable` (factory, sesión main). Panel webview → PRD.

**D9 — Atribución.** Readers y contrato: `@nklisch/pi-plugins` (MIT, Nathan
Klisch). Arquitectura runtime (resources_discover, config declarativa, staging
atómico, colisiones MCP): `pi-claude-marketplace` (MIT, acolomba). Se atribuye en
este ADR y en `docs/tools/frida-cc-plugins.md`.

## Alternativas consideradas

- **Wrapper de `@nklisch/pi-plugins`** — factible (probe) pero arrastra Node 24+,
  drift de receipts y duplicación (research §Ronda 1).
- **Wrapper de `pi-claude-marketplace`** — arquitectura liviana y correcta, pero
  prompts con `:` en filename (sin Windows) y peer `pi-subagents` distinto del
  nuestro (research §Ronda 3).
- **Solo skills (CLI `skills` de vercel-labs)** — subconjunto; sin commands/MCP ni
  ciclo de vida.
- **Esperar al marketplace del PRD** — orthogonal: este porte construye el
  adaptador "plugin Claude" que ese marketplace necesita.

## Consecuencias

**Positivas**: cero requisito de Node, cero drift, aislamiento total de artefactos
(uninstall trivial), instalaciones declarativas y repetibles, UX nativa VS Code,
nombres de MCP estables, Windows soportado.

**Negativas**: frida mantiene readers + convertidores (costo bajo; formato Claude
estable; ambos upstreams como referencia viva); namespacing `-` no es el `:` de
Claude (documentado); commands anidados fuera del MVP.

## Referencias

- Issue **#49** · Research `docs/research/cc-plugins-feasibility.md` (+ probe).
- `@nklisch/pi-plugins` (MIT) ·
  [COMPATIBILITY.md](https://github.com/nklisch/pi-extensions/blob/main/packages/pi-plugins/docs/COMPATIBILITY.md).
- `pi-claude-marketplace` (MIT) ·
  [repo](https://github.com/acolomba/pi-claude-marketplace) ·
  [hooks-compatibility](https://github.com/acolomba/pi-claude-marketplace/blob/main/docs/hooks-compatibility.md).
- Formato Claude: [plugins-reference](https://code.claude.com/docs/en/plugins-reference) ·
  [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces).
- Infra destino: `resources_discover` del SDK · `frida-mcp-adapter`
  (`~/.frida/mcp.json`, 4 slots de config) · #16 `frida-plugins` (complementario).
