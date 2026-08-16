# How-to: `frida-cc-plugins` — instala plugins de Claude Code en frida

> Guía paso a paso del ecosistema de plugins de Claude Code dentro de frida: desde el
> primer arranque hasta los usos clásicos de todas las opciones — consumir marketplaces
> (oficial, de terceros, propios), instalar plugins con skills/commands/MCP, compartir
> configuración por equipo, y **crear y publicar tu propio marketplace** como autor.
> Referencia técnica completa en [docs/tools/frida-cc-plugins.md](tools/frida-cc-plugins.md).

## Conceptos en 30 segundos

| Concepto | Qué es |
| --- | --- |
| **Marketplace** | Catálogo de plugins: un repo git (o carpeta local) con `.claude-plugin/marketplace.json` |
| **Plugin** | Carpeta autocontenida con skills, commands y servers MCP (manifiesto `.claude-plugin/plugin.json`) |
| **Source** | De dónde viene cada plugin: `./ruta` en el marketplace, repo `github`, URL git, paquete `npm` o `zip` https |
| **Scope** | Dónde vive la instalación: `user` (solo yo, todo proyecto), `project` (compartido en el repo), `local` (solo yo, este repo) |

**Conversión**: las skills del plugin se invocan `/skill:<plugin>-<skill>`, los commands
como prompts `/<plugin>-<command>` (con `$ARGUMENTS`), y los servers MCP se registran en
`~/.frida/mcp.json` **con su nombre original**.

## Prerrequisitos

- Frida instalado (gate `frida.ccPlugins.enabled`, default activado).
- `git` en el PATH para marketplaces y plugins de repos (para `npm`/`zip` no hace falta).
- Nada más: **todo install es explícito** — la extensión nunca instala plugins sola.

---

## 1. Uso básico: tu primer plugin (5 min)

**Paso a paso:**

1. Abre frida. En el **primer arranque** el marketplace oficial
   (`anthropics/claude-plugins-official`) se agrega **automáticamente en background** —
   verás la notificación cuando termine (la sesión abre al instante, sin esperar).
2. Explora qué hay: escribe en el chat

   ```text
   /ccplugin list --available
   ```

   El resultado llega por **tres canales a la vez**: un bloque en la conversación
   (persistente, queda en el historial), el **panel Output "Frida — cc-plugins"**
   (log de cada comando, copiable) y un **selector interactivo** — lista con búsqueda;
   `Enter` sobre un plugin abre sus acciones: *Detalle (documento markdown con
   inventario y costo)*, *Instalar*, *Deshabilitar/Habilitar*, *Desinstalar*. Todo se
   puede hacer desde ahí sin escribir más comandos.

3. Consulta el detalle ANTES de instalar (qué traerá y su costo):

   ```text
   /ccplugin info github@claude-plugins-official
   ```

   Verás "instalará: N skills, N commands, N MCP" y una estimación
   `(~N tokens/turno aprox.)`.

4. Instala uno pequeño para probar (p. ej. `commit-commands` del marketplace demo):

   ```text
   /ccplugin add commit-commands@claude-plugins-official
   ```

5. Ejecuta `/reload` cuando la notificación lo pida.

6. **Úsalo**: haz un cambio en un archivo y en el chat escribe

   ```text
   /commit-commands-commit
   ```

   (prompt del plugin con `$ARGUMENTS` — stagea, genera el mensaje y commitea).

**Caso de uso**: onboarding al ecosistema en un minuto — sin leer docs, con `list
--available` + `info` decides qué entra a tu agente y con qué costo.

## 2. Ciclo de vida diario

```text
/ccplugin list                        # instalados (con scope y componentes)
/ccplugin list --enabled | --disabled # filtrar por estado
/ccplugin info <plugin>[@mkt]         # detalle: skills/commands/MCP/omitidos
/ccplugin enable <plugin>             # reactivar sin reinstalar → /reload
/ccplugin disable <plugin>            # apagar sin perder la instalación → /reload
/ccplugin remove <plugin>             # desinstalar (recursos + MCP + registro) → /reload
```

**Caso de uso — "probé un plugin y estorba"**: `disable` lo silencia (el agente no ve
sus skills) pero conserva la instalación para reactivarlo en un `/reload`. `remove`
limpia TODO: skills convertidas, prompts, sus llaves MCP y el registro — sin tocar
servers MCP tuyos.

## 3. Marketplaces: agregar, actualizar, quitar

```text
/ccplugin bootstrap                          # agrega el oficial (y auto-update ON)
/ccplugin marketplace add owner/repo         # shorthand GitHub
/ccplugin marketplace add https://gitlab.com/equipo/plugins.git   # cualquier host git
/ccplugin marketplace add owner/repo#v2.0    # pinear branch/tag (#ref)
/ccplugin marketplace add git@gitlab.com:g/p.git                  # SSH
/ccplugin marketplace add ~/mi-marketplace   # carpeta LOCAL (sin git, para desarrollar)
/ccplugin marketplace list                   # registrados + rev + (auto-update)
/ccplugin marketplace update [nombre]        # refrescar catálogos
/ccplugin marketplace remove <nombre>        # quita el marketplace Y sus plugins
/ccplugin marketplace autoupdate <nombre>    # auto-update background ON
/ccplugin marketplace noautoupdate <nombre>  # ... OFF
```

**Notas**: los marketplaces locales se referencian in situ (quitarlos NO borra la
carpeta — es tuya). `remove` de un marketplace remoto desinstala en cascada los plugins
que salieron de él. Con `autoupdate`, tras cada arranque frida refresca el catálogo en
background y, si la revisión cambió, re-instala sus plugins y te notifica `/reload`.

**Caso de uso — canales stable/latest**: agrega el MISMO repo dos veces con refs
distintos (`equipo/plugins#stable`, `equipo/plugins#latest`) y comparte cada marketplace
con un grupo distinto vía settings del equipo (§5).

## 4. Scopes: quién ve qué

Al instalar, elige dónde vive la instalación:

```text
/ccplugin add pr-review@claude-plugins-official                      # user (default)
/ccplugin add pr-review@claude-plugins-official --scope project     # compartido
/ccplugin add pr-review@claude-plugins-official --scope local       # solo yo, aquí
```

| Scope | Archivo | Se comparte vía git | Ideal para |
| --- | --- | --- | --- |
| `user` | `~/.frida/cc-plugins/cc-plugins.json` | no | tus herramientas personales |
| `project` | `<repo>/.frida/cc-plugins.json` | **sí (commitéalo)** | estándar del equipo |
| `local` | `<repo>/.frida/cc-plugins.local.json` | no (gitignoréalo) | pruebas en este repo |

Precedencia de lectura: `local` > `project` > `user` (si instalas el mismo nombre en dos
scopes, gana el más específico). `remove`/`enable`/`disable` operan sobre el scope donde
vive el plugin.

**Caso de uso — equipo sincronizado**: el lead hace `--scope project` de los plugins del
flujo de trabajo (linter de commits, review toolkit), commitea `.frida/cc-plugins.json`;
cada dev abre el repo y frida muestra los mismos plugins — y con `enabledPlugins` (§5)
ni siquiera necesitan instalar nada.

## 5. Configuración de equipo (settings de frida)

En `settings.json` (workspace o user) — paridad con `extraKnownMarketplaces` y
`enabledPlugins` de Claude Code:

```json
{
 "frida.ccPlugins.extraMarketplaces": ["mi-org/claude-plugins#stable"],
 "frida.ccPlugins.enabledPlugins": {
  "code-formatter@mi-org": true,
  "pr-review@mi-org": true
 }
}
```

Al cargar la sesión, frida instala en background lo que falte y notifica con
"ejecuta /reload". Deshabilitar una entrada (`false`) no desinstala.

## 6. Los 5 tipos de source (al crear tus catálogos)

En `marketplace.json`, cada entrada declara de dónde baja el plugin:

```jsonc
{
 "name": "mi-org",
 "plugins": [
  { "name": "local-uno", "source": "./plugins/local-uno" },
  { "name": "gh-uno", "source": { "source": "github", "repo": "org/gh-uno" } },
  { "name": "gh-pin", "source": { "source": "github", "repo": "org/gh-uno", "sha": "a1b2...40hex" } },
  { "name": "monorepo", "source": { "source": "git-subdir", "url": "https://github.com/org/mono.git", "path": "tools/plugin" } },
  { "name": "npm-uno", "source": { "source": "npm", "package": "@org/plugin", "version": "^2.0.0", "registry": "https://npm.mi-org.com" } },
  { "name": "zip-uno", "source": { "source": "archive", "url": "https://artifacts.mi-org.com/p-2.1.0.zip", "sha256": "64hex..." } }
 ]
}
```

| Source | Cuándo usarlo | Detalle |
| --- | --- | --- |
| `./ruta` | El plugin vive en el mismo repo del marketplace | El más simple; se lee in situ |
| `github` / `url` | El plugin es un repo aparte | `ref` = branch/tag; `sha` (40 hex) = pin exacto verificado — si ambos, `sha` manda |
| `git-subdir` | Monorepo: el plugin es un subdirectorio | Clona y toma solo ese subdir |
| `npm` | Distribuyes por el registry (privado ok) | `version` admite rangos; registry https sin credenciales embebidas |
| `archive` | Hosts sin git/npm: S3, Artifactory, nginx | Zip https ≤256 MiB; `sha256` verificado = integridad |

## 7. Autor: crea y publica tu propio marketplace

**Paso a paso** (el walkthrough oficial de Claude funciona igual en frida):

1. Estructura:

   ```text
   mi-marketplace/
   ├── .claude-plugin/marketplace.json
   └── plugins/
       └── quality-review/
           ├── .claude-plugin/plugin.json   { "name": "quality-review", "version": "1.0.0" }
           ├── skills/quality-review/SKILL.md
           └── commands/review.md
   ```

2. `marketplace.json`:

   ```json
   {
    "name": "mi-plugins",
    "owner": { "name": "Tu Nombre" },
    "plugins": [
     { "name": "quality-review", "source": "./plugins/quality-review", "version": "1.0.0" }
    ]
   }
   ```

3. **Valídalo antes de compartir**:

   ```text
   /ccplugin validate ~/mi-marketplace
   ```

   Reporte `✔/⚠/✖` por check con los mismos lectores del loader (cero falsos OK):
   schema, duplicados, traversal, versiones entrada↔plugin.json, renames, strict.

4. Pruébalo como consumidor:

   ```text
   /ccplugin marketplace add ~/mi-marketplace
   /ccplugin add quality-review@mi-plugins
   /reload
   /skill:quality-review-quality-review
   ```

5. Publícalo: push a GitHub y comparte `/ccplugin marketplace add tu-org/mi-marketplace`
   (o configúralo por equipo con §5).

**Opciones de autor**:

- `metadata.pluginRoot: "./plugins"` → sources cortos: `"source": "quality-review"`.
- `renames: { "viejo": "nuevo", "eliminado": null }` → al actualizar el marketplace, las
  instalaciones existentes **migran solas** (rename con aviso; `null` desinstala limpio).
- `"strict": false` en una entrada → la entrada del catálogo ES la definición completa
  (sin plugin.json; skills/commands/MCP declarados ahí).
- `displayName`, `category`, `tags` → metadata de descubrimiento visible en `list`.

## 8. MCP: servers del plugin

- Se registran en `~/.frida/mcp.json` **con su nombre original** (las skills los
  referencian por nombre).
- Placeholders sustituidos al instalar: `${CLAUDE_PLUGIN_ROOT}` → carpeta instalada,
  `${CLAUDE_PROJECT_DIR}` → workspace.
- Si el nombre ya existe en cualquier config MCP → el install **falla con guía**
  (nunca renombra en silencio): renombra el existente o desinstala el plugin que lo trajo.
- `disable`/`remove` del plugin quita/repone sus entradas — tus servers propios jamás
  se tocan.
- Véalos con `/mcp` del adaptador de frida.

## 9. Salida de los comandos

Todo vive **dentro del webview de frida** (nada de paletas de VS Code):

- **Conversación**: cada `list`/`info` deja un bloque propio en el transcript —
  visible y persistente.
- **Diálogo de selección** (`list`, `list --available`): el mismo diálogo que usan
  las extensiones; elegir plugin → acción (instalar/detalle/habilitar/deshabilitar).
- **Output channel** `Frida — cc-plugins`: log silencioso de todos los comandos
  (`$ ccplugin …`); ábrelo desde el panel Output cuando lo necesites.
- **Documento markdown** (`info`, "Detalle"): ficha del plugin (componentes, costo
  estimado, omitidos) — también queda como bloque en el chat; el editor temporal es
  un extra para copiar.

## 10. Dónde vive todo (y limpieza manual)

```text
~/.frida/cc-plugins/
├── cc-plugins.json        # registro user
├── marketplaces/<slug>/   # clones de catálogos
├── installed/<p>@<rev>/   # contenido instalado (inmutable por revisión)
├── resources/skills|prompts/  # conversión → resources_discover
└── staging-sources/       # efímero del fetch
<repo>/.frida/cc-plugins[.local].json   # scopes project/local
~/.frida/mcp.json          # llaves MCP (solo las de plugins, marcadas)
```

## Troubleshooting rápido

| Síntoma | Causa | Solución |
| --- | --- | --- |
| "Conflicto de nombre MCP: 'x'" | Server con ese nombre ya configurado | Renombra el existente en tu config o quita el plugin que lo declaró |
| "sha no coincide" | Source pinea un commit que ya no resuelve así | Re-pin el sha correcto o usa `ref` |
| Skills del plugin no aparecen | Falta `/reload` tras install/enable | Ejecuta `/reload` |
| Marketplace no carga | URL/credenciales/red | `git ls-remote <url>` para probar; el oficial: `/ccplugin bootstrap` |
| Plugin renombrado por el autor | — | Nada: `renames` migra solo con aviso al cargar |
| Install remoto lento | Repo grande | Normal: clone --depth 1; timeout 120s con guía si la red falla |

## Referencias

- Issues: [#49](https://github.com/efuentesp/frida-code-vsix/issues/49) (base) ·
  [#50](https://github.com/efuentesp/frida-code-vsix/issues/50) (fase 2) ·
  [#51](https://github.com/efuentesp/frida-code-vsix/issues/51) (lado autor) ·
  ADR-0057.
- Doc técnica: [docs/tools/frida-cc-plugins.md](tools/frida-cc-plugins.md) ·
  Research: `docs/research/cc-plugins-feasibility.md`.
- Formato upstream: [plugins-reference](https://code.claude.com/docs/en/plugins-reference) ·
  [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces).
