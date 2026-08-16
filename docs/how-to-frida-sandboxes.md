# How-to: frida-sandboxes — la computadora propia del agente

> **frida-sandboxes** (#35) le da a cada agente su propia computadora Linux: un
> container Docker **local** y desechable con una copia de tu proyecto. El agente
> puede instalar, borrar, compilar y romper **sin riesgo** — tú revisas qué hizo y
> decides qué se mergea de vuelta. Es el tier-2 de aislamiento de Frida: el
> worktree (#13) aísla archivos por branch; el sandbox aísla la máquina completa.
>
> Referencia técnica: [docs/tools/frida-sandboxes.md](tools/frida-sandboxes.md) ·
> ADR-0047.

| Concepto | En una frase |
| --- | --- |
| **Sandbox** | Container Docker con tu proyecto copiado en `/workspace` |
| **Redirección** | Con un sandbox activo, los comandos `bash` del agente corren DENTRO (transparente) |
| **Changes** | `git status` in-container — qué modificó el agente allá |
| **Merge** | Traer archivos seleccionados del container a tu copia local |
| **Policy** | Refinamiento in-container: allowlist de dominios de red + write-paths |

## Prerrequisitos (2 min)

1. **Frida (VSIX) instalado** y **Docker corriendo** en el host:
   - macOS: Docker Desktop u OrbStack
   - Linux: docker.io
2. **Gate**: `frida.sandboxes.enabled` (default `true`).
3. Nada más: la imagen `node:22` (Debian con git+npm) se baja sola al primer
   sandbox. Si tu proyecto usa otro runtime, configura
   `frida.sandboxes.defaultImage` (debe incluir `git` — changes/merge lo usan).

**¿No tienes Docker?** Nada truena: el agente responde con una nota honesta de
una línea y sigue con las herramientas normales; el panel `/sandbox` muestra la
guía de instalación con botón "Reintentar detección".

Verifica tu setup:

```
/sandbox          → panel: estado de Docker + lista de sandboxes
/sandbox probe    → "✅ Docker disponible" o el motivo exacto si no
```

## El flujo mental (30 segundos)

```
TÚ                              AGENTE                        CONTAINER (frida-sbx-N)
"crea un sandbox y              sandbox_create        ───►   docker create + start
corre los tests dentro"                                       + copia del proyecto
                                npm test              ───►   docker exec … npm test
                                (redirigido: el bash
                                 del agente YA corre allá)
sandbox_changes          ◄───   git status            ───►   " M src/app.ts"
"mergea src/app.ts"             sandbox_merge         ───►   docker cp → tu copia
"destrúyelo"                    sandbox_destroy       ───►   docker rm -f
```

La regla de oro: **el daño vive en el container, la decisión de mantenerlo vive
en ti.**

## Casos de uso clásicos

### 1. Operaciones destructivas sin miedo (el caso bandera)

Tu proyecto necesita regenerar dependencias desde cero y no quieres jugar con
tu máquina.

```
Tú:   crea un sandbox, borra node_modules y reinstala desde cero,
      luego corre los tests para ver si el lockfile está sano
```

El agente: `sandbox_create` → sus comandos bash ya corren dentro →
`rm -rf node_modules && npm install && npm test` allá adentro. Tu host ni se
enteró. Si el resultado sirve: `sandbox_changes` + `sandbox_merge` del
`package-lock.json`. Si no: `sandbox_destroy` y adiós.

**Señal de que lo estás usando bien**: pides la operación SIN pensarte el
daño. El límite es una computadora que puedes tirar a la basura.

### 2. Probar código/script generado antes de ejecutarlo en tu host

El agente escribió un script de migración que toca la BD, renombra archivos o
hace llamadas en lote. Ejecutarlo a ciegas en tu máquina es el riesgo clásico.

```
Tú:   antes de correr esa migración en mi máquina, pruébala en un sandbox
```

El agente crea el sandbox, ejecuta el script allá, y te reporta output y
efectos (`sandbox_changes` = qué archivos tocó). Tú decides con evidencia, no
con fe.

### 3. "En mi máquina sí funciona" — entornos reproducibles

Un bug que solo sale (o solo NO sale) en tu máquina: caches locales, versiones
globales, config heredada.

```
Tú:   corre los tests en un sandbox limpio para descartar mi entorno
```

El container arranca desde la imagen limpia — sin tus caches, sin tu config.
Si los tests pasan allá pero fallan en tu host, el problema ES tu entorno, y el
output del sandbox es la evidencia para depurarlo.

### 4. Varios agentes en paralelo sin colisiones

Cada sandbox es su propio container: dos agentes pueden instalar versiones
distintas, levantar el mismo puerto o tocar los mismos archivos sin pisarse —
ni pisarte a ti. Crea uno por tarea (con nombre):

```
Tú:   crea un sandbox llamado "migrate" y otro llamado "audit",
      y que trabajen en paralelo
```

### 5. Instalar toolchains sin contaminar tu equipo

El proyecto necesita Postgres, Redis o un compilador para validar algo.

```
Tú:   en un sandbox: instala postgresql, levántalo y corre la migración
```

`apt install` dentro del container: tu host queda intacto. (Si el servicio
necesita puerto expuesto, pídelo explícito al crear:
`/sandbox create db --publish 5432:5432`.)

## Los dos modos de usarlo

### Modo agente (recomendado para trabajo)

Simplemente **pídelo en lenguaje natural** — "hazlo en un sandbox", "pruébalo
en un container" — o deja que el agente tome la iniciativa: su instrucción de
sistema lo dirige a usar `sandbox_create` cuando la tarea es destructiva y tú
dudas. La redirección es transparente: el agente sigue usando `bash` normal y
sus comandos corren allá.

Tools disponibles (el agente los usa; tú los conoces para auditar):

| Tool | Cuándo el agente la usa |
| --- | --- |
| `sandbox_create` | Crear el container + copiar el proyecto (activa redirección) |
| `sandbox_exec` | Comando explícito (cuando quiere apuntar a OTRO sandbox por nombre) |
| `sandbox_changes` | Reportar qué modificó antes de merge |
| `sandbox_merge` | Traer de vuelta SOLO los archivos que tú apruebas |
| `sandbox_status` | Inventario de sandboxes |
| `sandbox_destroy` | Limpiar — **rehúsa** si hay cambios sin mergear (te protege de perder trabajo) |

### Modo humano (panel /sandbox)

```
/sandbox
```

```
┌ [Activos 2]                                     [⟳] [X] ┐
│ 🔍 [Filtrar sandboxes______________________]           │
│  ❯ audit    node:22  ● corriendo                      │
│    migrate  node:22  ⏸ pausado                        │
│──────────────────────────────────────────────────────│
│  audit                                                │
│  Imagen node:22 · ● corriendo                        │
│  Proyecto /ruta/a/tu/proyecto · creado por agente     │
│  [Terminal] [Pausar] [Descartar]                     │
└───────────────────────────────────────────────────────┘
```

- **↑↓** navega · **⏎** consulta cambios pendientes · **Esc** cierra.
- **Terminal**: abre `docker exec -it` en la terminal de VS Code — entra a la
  computadora del agente y revisa con tus propios ojos.
- **Pausar/Reanudar**: congela el container sin destruirlo (ahorra recursos
  mientras decides).
- **Descartar**: destruye — pide confirmación en el propio panel; si hay
  cambios sin mergear, el comando te lo advierte (`--force` confirma).

## Recetas de ejemplo

### Ejemplo 1 — "¿el lockfile está sano?" (5 min)

```
Tú:   crea un sandbox llamado lock-check, borra node_modules,
      reinstala con npm ci y corre los tests

Agente: [sandbox_create → redirigido]
        $ rm -rf node_modules && npm ci        (dentro del container)
        $ npm test                             (dentro del container)
        ✅ 94/94 pasaron en entorno limpio

Tú:   ¿qué cambió?

Agente: [sandbox_changes]
        M package-lock.json (solo el lockfile se regeneró)

Tú:   mergea solo el lockfile

Agente: [sandbox_merge → package-lock.json] → tu copia local
Tú:   destruye el sandbox
```

### Ejemplo 2 — probar una migración de BD antes de tu host

```
Tú:   en un sandbox con nombre "migra": instala postgresql,
      levanta el servicio, aplica la migración db/migrate.ts
      y dime qué tablas resultaron

Agente: [sandbox_create migra]
        $ apt-get update && apt-get install -y postgresql   (allá)
        $ service postgresql start && psql -f …             (allá)
        $ npx tsx db/migrate.ts                             (allá)
        Tablas: users, orders, payments_audit (3 nuevas)

Tú:   se ve bien, mergea db/migrate.ts y destruye el sandbox
```

### Ejemplo 3 — dos tareas en paralelo sin choques

```
Tú:   quiero actualizar deps en un sandbox "deps" mientras
      otro sandbox "qa" solo corre la suite en el árbol actual

Agente: [sandbox_create deps] [sandbox_create qa]
        (cada uno trabaja su copia independiente)
        deps: npm update + build ✅
        qa:   94/94 ✅ sobre el árbol sin tocar

Tú:   mergea solo package.json del deps
```

## Política in-container (afina sin bloquear)

El container ES el aislamiento; la policy **refina** qué puede pasar allá
dentro (porte de pi-sandbox, ADR D4):

```jsonc
// settings.json
"frida.sandboxes.allowDomains": ["*.npmjs.org", "registry.yarnpkg.com", "github.com"]
```

- **allowDomains** (default `[]` = sin restricción): solo esos dominios de red
  dentro del container. Útil cuando el sandbox además debe ser hermético a
  red ("corre esto sin que llame a ningún lado salvo npm").
- **Write-paths**: `/workspace` + `/tmp` — destructivos fuera de ahí se
  bloquean con mensaje claro (¿para qué borrar `/etc` si es desechable?).

Si el agente choca con la policy, el error le dice exactamente qué regla y
por qué — no es un "no" seco.

## Buenos hábitos

1. **Nombra los sandboxes por tarea** (`migra`, `lock-check`, `audit`) — el
   panel y los reportes del agente se leen mejor que `sbx-3`.
2. **Changes antes que merge** — siempre pide `sandbox_changes` primero y
   aprueba archivos concretos; es tu diff de código review del container.
3. **Destroy al terminar** — los containers pausados ocupan disco. El agente
   rehúsa destruir con cambios sin mergear (protección deliberada), pero tú
   tienes `--force`.
4. **No mergees lo que no revisaste** — el merge es archivo a archivo por
   diseño: la granularidad es tu amiga.
5. **Sandbox ≠ worktree** — branch/commits aislados → worktree (`/worktree`,
   [how-to](how-to-frida-worktrees.md)); máquina completa aislada → sandbox.
   Se complementan: un sandbox puede incluso contener un repo con worktrees.

## Qué NO es frida-sandboxes

- **No es un reemplazo de los permisos** (`/gates-config`): permissions dicen
  QUÉ puede hacer; el sandbox DA dónde hacerlo. Complementarios.
- **No es cloud**: Docker local — sin costo por uso, sin vendor-lock, funciona
  en el avión.
- **No es un sandbox OS adicional**: el container ya es el boundary (por eso
  no portamos sandbox-runtime de pi-sandbox — solo su capa de policy).

## Relación con el resto de Frida

- **#26 better-subagents**: el modo detached ya está entregado (proceso
  propio que sobrevive al padre — ver
  [how-to-frida-subagents](how-to-frida-subagents.md)). La composición
  in-sandbox ("audita esto mientras yo sigo, en tu propia computadora") es
  el seguimiento pendiente del ADR-0047.
- **`withSandbox()` de workflows** (futuro): pasos de workflow con aislamiento
  declarativo, análogo a `withWorktree()`.
- **Panel `/sandbox` + chips de sesión**: la superficie visual seguirá
  creciendo con esas integraciones (diseño UX completo en el issue #35).
