# Entorno de desarrollo confiable con agentes de IA

> Guía portable de buenas prácticas. Copia este archivo al repo donde trabajes
> (solo o dentro de `docs/`) y úsalo como checklist cuando inicies un proyecto
> nuevo que vayas a desarrollar junto con agentes de IA (Claude Code, Codex,
> Cursor, Amp, Gemini CLI, Copilot, pi, etc.).

## 0. El problema

Cuando el humano o el agente levantan servicios (front, back, bd) en background,
ocurren estos fallos recurrentes:

| Síntoma | Causa raíz |
| --- | --- |
| El agente vuelve a levantar servicios que ya corren | El estado de los procesos vive solo en la conversación; al compactarse u avanzar el contexto, "se le olvida" |
| Aparecen servidores duplicados en puertos distintos (5173, 5174, 5175…) | Vite/CRA/Next auto-incrementan el puerto si está ocupado: el duplicado **no falla**, se muda en silencio |
| El e2e usa el puerto equivocado / no ve los cambios | Con duplicados escondidos, `localhost:5173` puede no ser el servidor que el agente acaba de modificar |
| El agente no sabe que el humano ya levantó los servers | El agente no ve tu terminal; solo confía en lo que puede verificar por sí mismo |

### Los 5 principios que lo resuelven

1. **Estado verificable, no memorable.** Toda pregunta sobre "¿está corriendo X?"
   debe responderse con un comando barato (`dev:status`), nunca con memoria de
   la conversación.
2. **Una sola entrada idempotente.** Solo existe un comando para levantar el
   stack (`dev:up`); correrlo dos veces es un no-op, no un duplicado. Humano y
   agente usan exactamente el mismo comando.
3. **Fallar ruidosamente.** Puertos fijos y estrictos (`strictPort`): si el
   puerto está ocupado, el servidor debe **morir con error**, nunca mudarse a
   otro puerto en silencio.
4. **Comandos autocontenidos.** `test:e2e` gestiona sus propias dependencias:
   reusa lo que corre, arranca lo que falta y apaga solo lo que él arrancó.
5. **Reglas escritas que se inyectan cada turno.** Las decisiones que dependen
   de "recordar" se convierten en reglas de `AGENTS.md` (y opcionalmente hooks
   del harness que las hacen cumplir automáticamente).

---

## 1. Orquestación del stack: una sola fuente de verdad

### 1.1 La regla de oro

> Ni tú ni el agente lanzan jamás `npm run dev` (o su equivalente) directo.
> Ambos usan el **mismo** comando orquestador, y ese comando es idempotente.

### 1.2 Opción A — Docker Compose para todo el stack

Ideal cuando ya usas Docker o quieres paridad total humano/agente/CI.

**Claves:**

- `healthcheck` en cada servicio + `depends_on` con `condition: service_healthy`:
  el arranque espera a que la bd *de verdad* acepte conexiones, no a que el
  contenedor "esté arriba".
- `docker compose up -d --wait` es idempotente por diseño: si ya corre, no-op;
  si falta algo, lo levanta y espera healthchecks.
- Puertos mapeados fijos (`ports: "5432:5432"`).
- **Perfiles** (`profiles:`) para servicios opcionales (adminer, mailhog,
  debug) que no arrancan por defecto: `docker compose --profile debug up`.
- Los servicios core (api, db) **sin** profile, para que siempre arranquen.

```yaml
# compose.yaml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]            # SIEMPRE fijo
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app_dev
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev -d app_dev"]
      interval: 2s
      timeout: 3s
      retries: 15

  api:
    image: node:22
    working_dir: /app
    command: npm run dev:api
    volumes: ["./:/app"]
    ports: ["3000:3000"]            # SIEMPRE fijo
    environment:
      DATABASE_URL: postgres://dev:dev@db:5432/app_dev
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:3000/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 12

  adminer:                           # opcional: solo con --profile debug
    image: adminer
    ports: ["8080:8080"]
    profiles: [debug]
    depends_on: [db]

volumes:
  pgdata:
```

```jsonc
// package.json
"dev:up":     "docker compose up -d --wait",
"dev:down":   "docker compose down",
"dev:status": "bash scripts/dev-status.sh"
```

**Ventaja decisiva con agentes:** Compose es el dueño de los procesos. El
agente puede morir/compactarse sin dejar huérfanos, y `dev:up` desde cualquier
terminal (tuya o del agente) converge al mismo estado. No hay PIDs que recordar.

**Límite:** para el *front* con hot-reload dentro de contenedor asegúrate de
que el watcher funcione (volúmenes con polling si el FS del host no emite
eventos: `CHOKIDAR_USEPOLLING=1` en Vite/webpack).

### 1.3 Opción B — Dev Container (el agente trabaja *dentro*)

La [Dev Container Spec](https://containers.dev/) define un entorno completo y
reproducible vía `devcontainer.json` (puede orquestar el mismo Compose de
arriba). VS Code / CLI / CI lo levantan idéntico.

**Cuándo conviene:**

- Quieres que el agente (que corre en tu editor/CLI dentro del devcontainer)
  use exactamente las mismas versiones de Node, Python, CLI, etc., que tú.
- Equipos grandes o contributors nuevos: cero "en mi máquina sí funciona".
- CI reusa el mismo contenedor (devcontainers/ci).

**Cuándo no:**

- Overkill para un proyecto pequeño con un stack estándar.
- Algunos agentes corren *fuera* del contenedor y entonces vuelven a ver "otro"
  localhost — verifica que tu agente corra dentro antes de asumir paridad.

Regla práctica: Dev Container para entornos reproducibles; Compose (1.2) para
servicios; no son excluyentes — devcontainer.json puede envolver el Compose.

### 1.4 Opción C — Procesos locales con tmux (sin Docker)

Cuando no quieres Docker, el token de singleton es una **sesión tmux con nombre**:

```bash
#!/usr/bin/env bash
# scripts/dev-up.sh — idempotente
set -euo pipefail
SESSION=dev
mkdir -p logs

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "✅ dev ya corre en tmux:$SESSION (attach: tmux attach -t $SESSION)"
  exit 0                       # <-- no-op: imposible duplicar
fi

tmux new-session  -d -s "$SESSION" 'npm run dev:api 2>&1 | tee logs/api.log' \; \
     split-window -h           'npm run dev:web 2>&1 | tee logs/web.log'

echo "🚀 Stack corriendo en tmux:$SESSION"
```

- Humano y agente comparten el mismo token (`tmux has-session -t dev`).
- El agente inspecciona salida viva: `tmux capture-pane -p -t dev` o
  `tail logs/*.log`.
- Los procesos sobreviven a que la sesión del agente muera (tmux es el dueño).
- `dev:down` = `tmux kill-session -t dev` (mata exactamente ese árbol).

### 1.5 Puertos fijos y estrictos (obligatorio en las tres opciones)

```ts
// vite.config.ts
export default defineConfig({
  server: { port: 5173, strictPort: true },  // muere si 5173 está ocupado
  preview: { port: 5173, strictPort: true },
})
```

- Backends (Express/Nest/FastAPI…) ya fallan con `EADDRINUSE`: déjalo así,
  **no** agregues lógica de "buscar otro puerto".
- Next.js: no uses `next dev -p 0`.
- Los puertos viven en **un solo lugar** (`.env` / `compose.yaml`) que también
  leen los e2e. Cero descubrimiento dinámico de puertos.

### Comparativa rápida

| | Docker Compose | Dev Container | tmux |
| --- | --- | --- | --- |
| Setup inicial | medio | medio-alto | mínimo |
| Paridad con CI/otros | alta | máxima | baja |
| Hot-reload | requiere cuidado | requiere cuidado | nativo |
| Aísla bd/dependencias | sí | sí | no |
| Agente dentro del entorno | no (opcional) | sí | no |
| Mejor para… | mayoría de los casos | equipos/entornos complejos | proyectos ligeros |

---

## 2. Estado reproducible de la base de datos

El segundo fuente de duplicación/confusión: la bd "sucia" entre corridas, seeds
que se aplican dos veces, y datos que hacen los e2e no deterministas.

### 2.1 Migraciones idempotentes + seed determinista

- **Migraciones** (Prisma Migrate, Drizzle, Knex, Flyway, Alembic…) versionadas
  en el repo: `db:migrate` debe poder correrse N veces sin romperse
  (idempotente por diseño: cada herramienta lleva registro de aplicadas).
- **Seed determinista**: mismo input → mismos datos (fixtures versionadas).
  Evita seeds con datos aleatorios que rompen asserts de e2e.
- Comandos separados: `db:migrate`, `db:seed`, y un **reset total**:

```bash
#!/usr/bin/env bash
# scripts/db-reset.sh — vuelve la bd a estado conocido
set -euo pipefail
docker compose down -v          # borra volúmenes: bd virgen
docker compose up -d --wait db
npm run db:migrate
npm run db:seed
echo "✅ bd en estado conocido"
```

### 2.2 Una bd dedicada para e2e (no la de desarrollo)

El error clásico: e2e corre contra `app_dev` y borra/destruye los datos con los
que estabas trabajando. Solución: **bases lógicas separadas** en el mismo
motor:

```yaml
# compose.yaml — misma bd, otra base lógica
environment:
  POSTGRES_MULTIPLE_DATABASES: app_dev,app_e2e
```

y `test:e2e` hace su propio reset de `app_e2e` (truncate + seed) antes de
correr. Así el humano y el e2e nunca pisan la misma data.

### 2.3 Estrategia por tipo de prueba

| Tipo de prueba | Estrategia de bd |
| --- | --- |
| Unitarias | Sin bd (mocks/fakes) |
| Integración | [Testcontainers](https://testcontainers.com/): contenedor efímero por corrida, puertos aleatorios gestionados por la librería — *aquí sí* está bien el puerto dinámico porque nadie lo comparte |
| E2E | bd dedicada (`app_e2e`), truncada y sembrada por el runner de e2e antes de empezar |

Testcontainers merece nota aparte: resuelve el problema de la bd efímera *sin
que el agente tenga que gestionar nada* — la librería levanta el contenedor,
espera el healthcheck, expone el puerto por env var y lo destruye al terminar.
Cero huérfanos, cero conflictos de puertos.

### 2.4 Regla para el agente

```markdown
- `db:migrate` y `db:seed` son idempotentes: correrlos de más es seguro.
- NUNCA borres manualmente datos de app_dev; usa `db:reset` si hace falta.
- e2e SIEMPRE contra app_e2e (definido en el .env de pruebas). Jamás apuntes
  e2e a app_dev.
```

---

## 3. Contrato con el agente: AGENTS.md, skills y hooks

Los agentes tienen tres mecanismos de "memoria", de débil a fuerte:

```text
memoria de la conversación  <  AGENTS.md (se inyecta cada turno)
                                  <  comandos idempotentes (la verdad está en el disco)
                                      <  hooks (verificación automática, imposible de ignorar)
```

### 3.1 AGENTS.md — el estándar universal

[AGENTS.md](https://agents.md/) es un formato abierto (stewardizado por la
Agentic AI Foundation / Linux Foundation) que **más de 60 mil proyectos** usan;
lo leen Codex, Cursor, Amp, Jules, Gemini CLI, Copilot, opencode, Aider, Zed,
Warp, Devin, Windsurf… Es un README para agentes: comandos, convenciones y
reglas que se inyectan en cada turno, así que no se "olvidan" ni con
compactación de contexto.

Reglas del formato:

- Markdown plano, sin campos obligatorios.
- En monorepos: `AGENTS.md` anidados; **el más cercano al archivo editado
  gana**, y los prompts explícitos del usuario vencen sobre el archivo.
- Trátalo como doc viva: actualízalo cuando cambien comandos o reglas.

**Sección plantilla** (cópiala y adapta puertos/comandos):

```markdown
## Entorno de desarrollo — REGLAS CRÍTICAS

Puertos FIJOS (nunca uses otros): api=3000, web=5173, db=5432.
Vite corre con strictPort: un duplicado FALLA, no se muda de puerto.

### Comandos (los ÚNICOS permitidos para gestionar servicios)
- `npm run dev:up`     → levanta TODO el stack (idempotente: si ya corre, no-op)
- `npm run dev:down`   → detiene todo
- `npm run dev:status` → verdad actual del entorno (salud por puerto)

### Reglas
- ANTES de levantar cualquier servicio o de asumir que corre: `npm run dev:status`.
- PROHIBIDO lanzar `npm run dev`, `npm run dev:api`, `npm run dev:web` u
  otros servidores directamente. Siempre `dev:up`.
- Si algo ya responde healthy en su puerto, REUTILÍZALO; no lo reinicies.
- Si el usuario dice que ya levantó los servers: corre `dev:up` igual — es un
  no-op seguro que confirma estado. Verifica, no reinicies.
- Si una prueba falla por conexión: `dev:status` y `tail logs/*.log`.
  NUNCA arranques otro servidor para "resolverlo".

### Pruebas e2e
- `npm run test:e2e` es AUTOCONTENIDO: reusa servidores corriendo, arranca los
  faltantes, apaga solo lo que él arrancó, y usa la bd app_e2e (no app_dev).
- PROHIBIDO levantar servidores manualmente antes de correr e2e.
- La bd de e2e se resetea sola; nunca apuntes e2e a app_dev.
```

Equivalencias por harness: Claude Code lee `CLAUDE.md` (y soporta AGENTS.md vía
config), Cursor usa `.cursor/rules/`, Gemini CLI `GEMINI.md`. Recomendación:
**mantén AGENTS.md como fuente única** y crea symlinks/archivos mínimos que lo
incluyan, para no duplicar reglas que luego divergen.

### 3.2 Skills — procedimientos reutilizables

Cuando el flujo es más largo que una regla ("cómo diagnosticar que las e2e no
conectan", "cómo actualizar el stack"), documéntalo como skill/procedimiento
del harness (p. ej. `.pi/agent/skills/…`, `.claude/skills/…`) que el agente
carga *on demand*. AGENTS.md = constitución corta; skills = manuales.

### 3.3 Hooks — las reglas hechas cumplir por máquina

Los mejores harnesses (p. ej. Claude Code) permiten **hooks**: comandos que se
ejecutan automáticamente en puntos del ciclo. Dos usos que eliminan el problema
de raíz:

**a) Inyectar el estado real en cada turno** (el agente ya nunca "no sabe" qué
corre). Un hook `UserPromptSubmit` imprime `dev:status` y el harness lo agrega
como contexto visible para el modelo:

```jsonc
// .claude/settings.json (proyecto, versionable)
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "npm run -s dev:status", "timeout": 10 }
        ]
      }
    ]
  }
}
```

El stdout de un hook de `UserPromptSubmit` con exit 0 se inyecta como contexto
que el agente ve — cada turno empieza con la verdad del entorno, no con lo que
recuerde.

**b) Bloquear el arranque manual de servidores** (exit 2 = bloqueo; el agente
recibe la razón):

```bash
#!/usr/bin/env bash
# .claude/hooks/block-direct-dev.sh
COMMAND=$(jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE 'npm run (dev|dev:api|dev:web)( |$)'; then
  echo "Bloqueado: no lances servidores directo. Usa 'npm run dev:up' (idempotente)." >&2
  exit 2
fi
exit 0
```

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-direct-dev.sh" }
        ]
      }
    ]
  }
}
```

Con este par, el agente **no puede** arrancar duplicados aunque "se le
olvide": el estado se le inyecta cada turno y el comando peligroso se bloquea.
Si tu harness no tiene hooks, la capa AGENTS.md + comandos idempotentes sigue
siendo efectiva (solo menos a prueba de balas).

---

## 4. Monitoreo y saneamiento: `dev:status` y `dev:doctor`

### 4.1 `dev:status` — la verdad del entorno

Un comando barato (<1 s) que responde "¿qué corre, dónde y con qué salud?":

```bash
#!/usr/bin/env bash
# scripts/dev-status.sh
check() {
  local name=$1 port=$2 path=$3
  if curl -sf -o /dev/null --max-time 2 "http://localhost:${port}${path}"; then
    printf "%-5s :%-5s ✅ healthy (pid %s)\n" "$name" "$port" \
      "$(lsof -ti tcp:$port | head -1)"
  else
    printf "%-5s :%-5s ❌ down\n" "$name" "$port"
  fi
}
check api 3000 /health
check web 5173 /
docker compose ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null | grep -v NAME || true
```

### 4.2 `dev:doctor` — detecta huérfanos y puertos extraviados

Corre cuando algo se porta raro. Detecta la firma del desastre: puertos
vecinos (5174, 5175 = duplicados de Vite) y procesos huérfanos:

```bash
#!/usr/bin/env bash
# scripts/dev-doctor.sh — diagnóstico del entorno dev
EXPECTED="3000 5173 5432"
echo "== Puertos esperados =="
for p in $EXPECTED; do
  pid=$(lsof -ti tcp:$p 2>/dev/null | head -1)
  [ -n "$pid" ] && echo "  :$p  ✅ pid $pid ($(ps -p $pid -o comm= ))" \
                || echo "  :$p  ⚪ libre"
done

echo "== SOSPECHOSOS: vecinos de puertos conocidos (duplicados) =="
for base in 3000 5173; do
  for off in 1 2 3 4 5; do
    p=$((base+off)); pid=$(lsof -ti tcp:$p 2>/dev/null | head -1)
    [ -n "$pid" ] && echo "  :$p  ⚠️  pid $pid — probable duplicado (mata: kill $pid)"
  done
done

echo "== Procesos dev huérfanos (node/vite/next fuera de tmux/compose) =="
pgrep -fl 'vite|next dev|nodemon|ts-node|uvicorn|flask run' | grep -v grep || echo "  ninguno"
```

Dale al agente la regla: *"ante comportamientos raros de puertos/conexión,
corre `dev:doctor` y sigue sus sugerencias"*.

### 4.3 `dev:down` robusto

Además del apagado orquestado, versión "cirugía" para huérfanos:

```bash
#!/usr/bin/env bash
# scripts/dev-down.sh
docker compose down 2>/dev/null || true
tmux kill-session -t dev 2>/dev/null || true
# cirugía de huérfanos en los puertos del proyecto:
for p in 3000 5173; do
  pids=$(lsof -ti tcp:$p 2>/dev/null) && kill $pids 2>/dev/null
done
echo "✅ stack detenido"
```

### 4.4 Logs a archivo

Todo servicio escribe a `logs/*.log` (vía `tee` en tmux, o `docker compose
logs api`). Le da al agente evidencia para diagnosticar sin adivinar:
`tail -50 logs/api.log`.

---

## 5. Checklist de adopción (al iniciar un proyecto)

Copia esta lista y márcala en orden:

1. [ ] Define puertos fijos y documéntalos (api/web/db) en un solo lugar (`.env`).
2. [ ] Activa `strictPort` en el front; confirma que el back muere con `EADDRINUSE`.
3. [ ] Elige orquestador: Compose (default) / Dev Container / tmux.
4. [ ] Crea `scripts/dev-up.sh` **idempotente** (token singleton: compose o tmux).
5. [ ] Crea `scripts/dev-status.sh` con health-checks por puerto.
6. [ ] Agrega `dev:up | dev:down | dev:status` a package.json (o Makefile).
7. [ ] Migraciones + seed idempotentes; `db:reset` recrea estado conocido.
8. [ ] bd lógica separada para e2e (`app_e2e`); e2e la resetea sola.
9. [ ] Configura el runner de e2e como autocontenido (p. ej. Playwright
      `webServer` con `reuseExistingServer: !process.env.CI`).
10. [ ] Escribe la sección "Entorno de desarrollo" en `AGENTS.md` (plantilla §3.1).
11. [ ] Logs a archivo bajo `logs/` (y `logs/` al `.gitignore`).
12. [ ] Opcional (blindaje): hook `UserPromptSubmit` que inyecta `dev:status`
        cada turno + hook `PreToolUse` que bloquea arranque directo de servers.
13. [ ] Primera semana: cuando el agente se desvíe de una regla, corrígelo Y
        actualiza AGENTS.md — es doc viva.

## 6. Plantilla Playwright autocontenida

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  use: { baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:5173' },
  webServer: [
    {
      name: 'api',
      command: 'npm run dev:api',
      url: 'http://localhost:3000/health',      // endpoint liviano
      reuseExistingServer: !ci,                  // local: reusa los del humano
      stdout: 'ignore', stderr: 'pipe',
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
    },
    {
      name: 'web',
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: !ci,
      stdout: 'ignore', stderr: 'pipe',
      timeout: 120_000,
    },
  ],
});
```

Semántica resultante (documentada por Playwright): si el puerto/URL ya responde
(2xx/3xx/401/403), **reusa** el servidor existente y no ejecuta `command`; al
terminar **solo apaga los que él arrancó**. En CI (`CI=true`) exige instancias
propias y falla si el puerto está tomado. Nota: `gracefulShutdown` con SIGTERM
es necesario si el comando es un `docker compose up`.

```jsonc
// package.json
"test:e2e": "npm run db:e2e:reset && playwright test"
// db:e2e:reset = truncate+seed de app_e2e (nunca app_dev)
```

---

## 7. Anti-patrones (qué NO hacer)

- ❌ Lanzar `npm run dev` directo (humano o agente) fuera del orquestador.
- ❌ Dejar el auto-incremento de puertos activo (sin `strictPort`).
- ❌ Puertos "descubribles" o dinámicos en dev (los dinámicos solo en tests
  con Testcontainers, donde nadie los comparte).
- ❌ Apuntar e2e a la bd de desarrollo.
- ❌ Seeds con datos aleatorios no versionados.
- ❌ Confiar en que el agente "recuerde" qué corre — dale `dev:status`.
- ❌ Matar procesos con `kill -9` a ciegas en vez de `dev:down` / `dev:doctor`.
- ❌ Duplicar las reglas en varios archivos de harness con textos que divergen;
  una sola fuente (AGENTS.md) y referenciarla.

## 8. Referencias

- Playwright — Web server (`webServer`, `reuseExistingServer`):
  <https://playwright.dev/docs/test-webserver>
- AGENTS.md — formato abierto (ecosistema de agentes, FAQ, anidados):
  <https://agents.md/>
- Claude Code — Hooks reference (PreToolUse/UserPromptSubmit, exit 2, settings
  versionables en proyecto): <https://code.claude.com/docs/en/hooks>
- Docker Compose — Profiles: <https://docs.docker.com/compose/how-tos/profiles/>
- Docker Compose — healthchecks y `depends_on: condition: service_healthy`
- Dev Container Specification: <https://containers.dev/overview>
- Testcontainers (Node/Java/Go/…): <https://testcontainers.com/>

---

## 9. Extensiones de Pi que complementan estas prácticas

Si tu agente es [Pi](https://pi.dev/), el catálogo
([pi.dev/packages](https://pi.dev/packages)) tiene un ecosistema completo de
extensiones de procesos en background. Evaluadas contra este problema
(descargas/mes a la fecha de investigación):

| Extensión | Descargas/mes | Veredicto | Aporte |
| --- | --- | --- | --- |
| `pi-background-tasks` | ~82K | ✅ Instalar | Registro durable de tareas con nombre; el agente SIEMPRE ve qué corre |
| `@gotgenes/pi-permission-system` | ~30K | ✅ Instalar | Bloquea por máquina el arranque directo de servidores (`deny`) |
| `@aliou/pi-processes` | ~5K | 👍 Opcional | Panel `/ps`, logs, wake automático cuando el server imprime "ready" |
| `pi-better-background-tasks` | ~4K | 👀 Watchlist | Watchers + detección de tareas stalled; muy joven |
| `@99percentpeople/pi-background-tasks` | ~3K | 👀 Solo PTY/SSH | Terminal vivo attach/detach (`Ctrl+]`), SSH remoto |
| `@haemmid/pi-processes` | ~0.2K | 👀 Watchlist | `ensure` idempotente + anti-duplicados por nombre: la feature exacta, adopción mínima |

### 9.1 `pi-background-tasks` — la base

```bash
pi install npm:pi-background-tasks
```

- **Tareas con nombre en registro durable**: `/jobs` o el tool `bg_status`
  responden "¿qué corre?" con un tool call — no con memoria de la conversación.
- **Salida a archivos fuera del contexto**: `/logs <id> <bytes>` lee acotado;
  sin dormir, sin polling, sin inundar el contexto.
- **Notificaciones que despiertan al agente**: si el server muere o el build
  termina, Pi retoma el turno automáticamente.
- **Footer dock** (Shift↓): tú ves el estado de los servidores sin salir de
  la conversación.
- *Limitación*: no deduplica por sí sola (no tiene `ensure`); combínala con
  9.2 o con las reglas de AGENTS.md.

### 9.2 `@gotgenes/pi-permission-system` — el blindaje

```bash
pi install npm:@gotgenes/pi-permission-system
```

Config **por proyecto** (viaja con el repo) que materializa el §3.3 con
sintaxis declarativa `allow/ask/deny` + wildcards:

```jsonc
// <proyecto>/.pi/extensions/pi-permission-system/config.json
{
  "permission": {
    "bash": {
      "npm run dev:up *": "allow",
      "npm run dev *": "deny",        // imposible arrancar duplicado directo
      "docker compose *": "allow"
    }
  }
}
```

Capas: `path` (niega `.env`/`~/.ssh` en todo) → `external_directory` →
per-tool → `bash`. La config de proyecto pisa la global.

### 9.3 Nota crítica: qué resuelven y qué no

Estas extensiones cubren el lado **agente→agente**: que el agente no olvide
ni duplique lo que él (o otra sesión de Pi) levantó. El lado
**humano→agente** — tú levantaste los servers en TU terminal, fuera de Pi —
no lo ve ningún registro de Pi: sigue requiriendo verificación por puerto
(`dev:status`, `ensure url=…`, health-checks). Conclusión: **las extensiones
complementan este documento, no lo reemplazan**.

```text
scripts idempotentes + AGENTS.md (este doc)   ← base, vale para cualquier agente
        + pi-background-tasks                  ← el agente SIEMPRE ve qué corre
        + pi-permission-system                 ← el agente NO PUEDE arrancar directo
        + (@aliou/pi-processes                 ← opcional: UX de panel + wake en "ready")
```

### 9.4 Extensiones de Pi para Docker

Si tu stack corre en Compose (§1.2), hay dos vías que agregan valor. Nota de
realidad: el ecosistema Docker de extensiones Pi nativas es **inmaduro** —
ninguna pasa de ~600 descargas/mes — así que evalúa antes de adoptar y prefiere
probar con carga de una sola vez (`pi -e npm:<paquete>`) sin instalar.

#### A. `container-dashboard` — gestión nativa desde Pi (82/mes, MIT)

```bash
pi -e npm:container-dashboard   # probar sin instalar
```

- Widget TUI en el sidebar con conteo vivo de contenedores.
- Comandos `/docker:ps|logs|stats|stop|start|restart|inspect|top|rm|prune` y
  **13 LLM tools** (`container_ps`, `container_logs`, `container_stats`…).
- Auto-detecta docker → podman → nerdctl; intercepta comandos peligrosos
  (`rm -f`, `prune -a`) con confirmación.
- **Aporte**: el principio 1 (estado verificable, no memorable) a nivel Docker —
  el agente consulta `container_ps` como tool estructurada en vez de parsear
  `docker compose ps` con shells, y tú ves el estado sin salir de la
  conversación. Complementa `dev:status` cuando el stack corre en Compose.

#### B. `@supernova123/docker-mcp-server` — vía MCP (366/mes, MIT)

Si ya usas `pi-mcp-adapter` (la extensión más popular del catálogo), solo
agregas el server MCP:

```jsonc
"docker": { "command": "npx", "args": ["-y", "@supernova123/docker-mcp-server"] }
```

~50 tools orientadas a que el agente **mantenga los contenedores corriendo**:

- `check_health` (HTTP/TCP/exec) y `watch_health(timeout)` — el "esperar a que
  de verdad acepte conexiones" del §1.2, como tool.
- Ciclo de vida Compose: `up/down/ps/logs/restart`.
- `watch_events` — detecta crashes/restarts/cambios de salud (el "wake").
- Flota: `fleet_status`, `search_logs(pattern, containers)`;
  `set_restart_policy` para auto-healing.
- Local, sin API keys, sin nube.

*Nota*: adopción baja también; su comparativa contra alternativas
(`ckreiling/mcp-server-docker` GPL y sin mantenimiento, `docker/hub-mcp` que
requiere auth de Docker Hub) es marketing propio — Docker publica un MCP
Toolkit oficial que conviene comparar antes de fijar elección.

#### C. Lo que NO instalar para este fin

- **Sandboxes** (`@christianmoesl/pi-sbx` 309/mes, `pi-container-sandbox`
  185/mes, `pi-sandbox-docker` 154/mes): aislan la ejecución del agente en un
  contenedor por **seguridad** (sin tu `$HOME`, SSH keys, creds). Problema
  distinto: aíslan al agente, no gestionan tu stack.
- `@artale/pi-stack` (57/mes): genera Compose de infra de IA local (Ollama,
  n8n, Supabase), no de tu app.
- `pi-odoo-develop` (613/mes): vertical Odoo.
- `@bytesbrains/pi-docker-logs` (73/mes): tail de logs acoplado a su
  plataforma "wrok.in AI Factory".

**Conclusión**: nada de esto reemplaza el corazón del documento (compose con
healthchecks + `dev:up` idempotente + AGENTS.md) — la CLI de Docker ya es de
por sí una API idempotente que el agente maneja bien vía bash. El valor
agregado es **visibilidad permanente** y **tools estructuradas en vez de
parseo de texto**: reducen la superficie de error del agente, no la necesidad
del contrato.

---

*Documento portable — llévalo de proyecto en proyecto y adáptalo al stack
concreto. Versión: 1.2*
