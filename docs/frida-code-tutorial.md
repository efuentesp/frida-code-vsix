# Tutorial de Frida Code: Desarrollo Spec-Driven con Next.js + PocketBase

> **Audiencia:** Desarrolladores del equipo que aprenderán a usar **Frida Code** end-to-end construyendo una aplicación real.
> **Duración estimada:** 6-8 horas (puede hacerse en 2-3 sesiones).
> **Stack del proyecto:** Next.js 15 + shadcn/ui + PocketBase + Docker.
> **Nivel:** Intermedio. Asume familiaridad con TypeScript y React básicos.

---

## Tabla de contenidos

### Parte 0 — Preparación

- [0.1 ¿Qué es Frida Code y por qué usarlo?](#01-qué-es-frida-code-y-por-qué-usarlo)
- [0.2 Prerrequisitos](#02-prerrequisitos)
- [0.3 Instalación de Frida Code](#03-instalación-de-frida-code)
- [0.4 Configuración inicial](#04-configuración-inicial)
- [0.5 Anatomía de la extensión](#05-anatomía-de-la-extensión)

### Parte 1 — Conceptualización con spec-driven development

- [1.1 El flujo spec-driven: del "qué" al "cómo"](#11-el-flujo-spec-driven-del-qué-al-cómo)
- [1.2 Descubrimiento del problema con `/skill:discover`](#12-descubrimiento-del-problema-con-skilldiscover)
- [1.3 Investigación profunda con `/skill:research`](#13-investigación-profunda-con-skillresearch)
- [1.4 Diseño de la arquitectura con `/skill:design`](#14-diseño-de-la-arquitectura-con-skilldesign)

### Parte 2 — Inicialización del proyecto

- [2.1 Scaffold del proyecto Next.js](#21-scaffold-del-proyecto-nextjs)
- [2.2 Configuración de shadcn/ui](#22-configuración-de-shadcnui)
- [2.3 Levantar PocketBase con Docker](#23-levantar-pocketbase-con-docker)
- [2.4 Schema inicial de la base de datos](#24-schema-inicial-de-la-base-de-datos)
- [2.5 Cliente PocketBase en Next.js](#25-cliente-pocketbase-en-nextjs)
- [2.6 Primera conversación con Frida](#26-primera-conversación-con-frida)

### Parte 3 — Autenticación

- [3.1 Diseño del flujo de auth con frida-pipeline](#31-diseño-del-flujo-de-auth-con-frida-pipeline)
- [3.2 Implementación con `/wf build`](#32-implementación-con-wf-build)
- [3.3 Verificación con `/wf vet`](#33-verificación-con-wf-vet)
- [3.4 Subagentes de revisión con frida-subagents](#34-subagentes-de-revisión-con-frida-subagents)

### Parte 4 — CRUD de tareas

- [4.1 Spec de la feature con frida-pipeline](#41-spec-de-la-feature-con-frida-pipeline)
- [4.2 Plan de implementación con `/skill:plan`](#42-plan-de-implementación-con-skillplan)
- [4.3 Implementación iterativa con `/skill:implement`](#43-implementación-iterativa-con-skillimplement)
- [4.4 Validación con `/skill:validate`](#44-validación-con-skillvalidate)

### Parte 5 — Mejoras con herramientas avanzadas

- [5.1 Inspección de UI con frida-agent-browser](#51-inspección-de-ui-con-frida-agent-browser)
- [5.2 Búsqueda web con frida-agent-browser](#52-búsqueda-web-con-frida-agent-browser)
- [5.3 Integración con bases de datos externas vía MCP](#53-integración-con-bases-de-datos-externas-vía-mcp)
- [5.4 Auto-regulación con frida-context](#54-auto-regulación-con-frida-context)
- [5.5 Gates de aprobación con frida-permission-system](#55-gates-de-aprobación-con-frida-permission-system)

### Parte 6 — Pruebas y release

- [6.1 Suite de pruebas con frida-pipeline](#61-suite-de-pruebas-con-frida-pipeline)
- [6.2 Code review con `/skill:code-review`](#62-code-review-con-skillcode-review)
- [6.3 Changelog y release notes](#63-changelog-y-release-notes)
- [6.4 Deploy con Docker](#64-deploy-con-docker)

### Apéndices

- [A. Referencia rápida de slash commands](#a-referencia-rápida-de-slash-commands)
- [B. Configuración de MCP servers](#b-configuración-de-mcp-servers)
- [C. Solución de problemas comunes](#c-solución-de-problemas-comunes)

---

## 0.1 ¿Qué es Frida Code y por qué usarlo?

**Frida Code** es una extensión de VS Code que integra el agente de IA **Pi** con tu flujo de trabajo de desarrollo. A diferencia de asistentes genéricos, Frida está diseñada para ser **spec-driven**: la IA trabaja con specs explícitas, fases estructuradas, y herramientas que la mantienen enfocada.

### Las 9 herramientas de Frida

| Herramienta | Propósito | Cuándo usarla |
| --- | --- | --- |
| **frida-workflow** | Motor de workflows (cadenas de etapas) | `/wf build`, `/wf vet`, `/wf polish` |
| **frida-pipeline** | Orquestador con 27 skills y 15 subagentes | Skills como `/skill:discover`, `/skill:plan` |
| **frida-subagents** | Subagentes paralelos | `Agent({...})` tool |
| **frida-mcp-adapter** | Integración con servidores MCP (GitHub, DBs, etc.) | `mcp({...})` tool |
| **frida-context** | Snapshot de presión del contexto | Auto-regulación |
| **frida-permission-system** | Gates de aprobación | Comandos sensibles |
| **frida-agent-browser** | Browser real + búsqueda web | `agent_browser` tool |
| **frida-args** | Argumentos en skills | `$1`, `$ARGUMENTS` |
| **ask-user-question-web** | Preguntas estructuradas con UI | `ask_user_question` tool |

### ¿Por qué spec-driven?

El enfoque tradicional de "prompt-and-pray" lleva a:

- ❌ Código que no compila porque la IA inventó APIs.
- ❌ Features incompletas porque la IA asumió sin preguntar.
- ❌ Refactors infinitos porque no hubo diseño previo.

**Spec-driven** invierte el flujo:

```
Spec → Diseño → Plan → Slices → Implementación → Validación
  ↑                                                       ↓
  └───────────── Iteración basada en feedback ────────────┘
```

Frida estructura este flujo con **workflows** (`/wf build` ejecuta 7 stages automáticamente) y **skills** que producen artefactos verificables.

---

## 0.2 Prerrequisitos

Necesitas instalar antes de empezar:

| Software | Versión mínima | Cómo verificar |
| --- | --- | --- |
| **VS Code** | 1.85+ | Abrir VS Code → Help → About |
| **Git** | 2.30+ | `git --version` |
| **Node.js** | 20+ | `node --version` |
| **Python** | 3.10+ | `python --version` |
| **Docker Desktop** | 4.0+ | `docker --version` |

### Instalación por sistema operativo

**macOS (con Homebrew):**

```bash
brew install node git python docker
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y nodejs npm git python3 python3-pip docker.io
sudo usermod -aG docker $USER  # Reiniciar sesión después
```

**Windows (con Chocolatey):**

```powershell
choco install nodejs-lts git python docker-desktop
```

---

## 0.3 Instalación de Frida Code

### Paso 1: Descargar el VSIX

Ve a [github.com/efuentesp/frida-code-vsix/releases](https://github.com/efuentesp/frida-code-vsix/releases) y descarga la última versión (`frida-code-X.Y.Z.vsix`).

### Paso 2: Instalar el VSIX

**Opción A — Desde la UI de VS Code:**

1. Abre la paleta de comandos: `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows/Linux).
2. Escribe: `Extensions: Install from VSIX...`.
3. Selecciona el archivo `.vsix` descargado.

**Opción B — Desde terminal:**

```bash
code --install-extension frida-code-0.4.0.vsix
```

### Paso 3: Verificar la instalación

1. Recarga VS Code: `Cmd+R` / `Ctrl+R`.
2. Abre la paleta de comandos y escribe `Frida Code`.
3. Deberías ver comandos como "Frida Code: Open".

✅ **Si ves la barra lateral con el ícono lila de Frida, la instalación fue exitosa.**

---

## 0.4 Configuración inicial

### Configurar el provider de IA

Frida Code usa Pi como motor de IA. Necesitas configurar un provider (proveedor de modelos).

#### Opción A: Softtek DevEngine Gateway (entorno corporativo)

1. Abre el panel de Settings: `Cmd+,` / `Ctrl+,`.
2. Busca `Frida Code: Provider`.
3. Selecciona `softtek` en el dropdown.
4. Ingresa tu API key cuando se solicite.

#### Opción B: z.ai (GLM models)

1. Settings → `Frida Code: Provider` → `zai`.
2. Ingresa tu API key de [z.ai](https://z.ai).

#### Opción C: GitHub Copilot

1. Settings → `Frida Code: Provider` → `github-copilot`.
2. Sigue el flujo OAuth: se abrirá un browser, autorizas, y vuelves a VS Code.

### Directorio de trabajo

Frida almacena estado en `~/.frida/`:

```bash
ls ~/.frida/
# agents/       # Subagentes globales
# artifacts/    # Artefactos generados (specs, planes, etc.)
# extensions/   # Extensiones externas (.ts)
# skills/       # Skills globales
# global/       # Config global
```

---

## 0.5 Anatomía de la extensión

### La barra lateral

Al hacer clic en el ícono lila en la barra de actividad, se abre la vista principal. Verás:

- **Header:** Versión (`v0.4.0`) + botones de acción.
- **Chat:** Donde conversas con la IA.
- **Input:** Tu prompt + tools inline.

### El modelo de conversación

A diferencia de otros asistentes, Frida usa **slash commands** y **tools** que la IA invoca directamente. La conversación es estructurada:

```
Tú: /skill:discover
Frida: [Skill discover se activa]
        Investigando el problema...
        [Llama tools: bash, read, etc.]
        [Genera spec en .frida/artifacts/]
        ✅ Spec creado en .frida/artifacts/discover/...
```

### El comando `/help`

Escribe `/help` para ver la lista completa de slash commands disponibles.

---

## 1.1 El flujo spec-driven: del "qué" al "cómo"

El spec-driven development tiene 4 fases que mapean a skills/workflows de Frida:

| Fase | Skill/Workflow | Salida |
| --- | --- | --- |
| **Descubrimiento** | `/skill:discover` | Spec del problema |
| **Investigación** | `/skill:research` | Hallazgos + decisiones |
| **Diseño** | `/skill:design` | Arquitectura + ADRs |
| **Planificación** | `/skill:plan` | Plan ejecutable con tareas |
| **Implementación** | `/skill:implement` | Código por slice |
| **Validación** | `/skill:validate` | Tests + checks |

Y el workflow `/wf build` automatiza las fases de build en una sola invocación.

---

## 1.2 Descubrimiento del problema con `/skill:discover`

En esta sección vamos a descubrir el problema de la app de tareas. Empezamos desde cero.

### Paso 1: Crear el directorio del proyecto

```bash
mkdir ~/projects/todo-frida
cd ~/projects/todo-frida
git init
code .
```

### Paso 2: Inicializar la estructura mínima

Crea un archivo `AGENTS.md` (las convenciones de tu equipo):

```bash
cat > AGENTS.md <<'EOF'
# Proyecto: Todo Frida

## Stack
- Next.js 15 (App Router)
- shadcn/ui (componentes)
- PocketBase (auth + DB)
- Docker (PocketBase + futuro deploy)

## Convenciones
- TypeScript estricto
- Commits en español
- Branches: `feat/`, `fix/`, `chore/`
- Tests con Vitest
EOF
```

### Paso 3: Invocar la skill discover

En el chat de Frida, escribe:

```
/skill:discover Necesito construir una app de tareas personal con autenticación.
Los usuarios deben poder registrarse, iniciar sesión, y gestionar sus propias tareas
(crear, listar, marcar como hechas, eliminar). Quiero usar Next.js + shadcn + PocketBase.
El diferenciador es que las tareas deben soportar categorías y prioridades.
```

La skill discover:

1. Hace preguntas estructuradas (usando `ask_user_question`).
2. Investiga el dominio.
3. Genera un archivo `.frida/artifacts/discover/2025-XX-XX_todo-app.md`.

✅ **Checkpoint:** Verifica que existe `.frida/artifacts/discover/2025-XX-XX_todo-app.md`. Ábrelo y revisa que la spec captura tus requisitos.

### Ejemplo de output

```markdown
# Spec: App de tareas personal

## Problema
Los usuarios necesitan una forma simple de organizar sus tareas diarias
con categorización y priorización.

## Usuarios objetivo
- Developers que quieren trackear tareas técnicas
- Equipos pequeños que necesitan un Kanban ligero

## Features MVP
- [ ] Registro + login con email/password
- [ ] CRUD de tareas (título, descripción, categoría, prioridad)
- [ ] Filtros por estado/categoría
- [ ] Marcar como hecha
- [ ] Eliminar

## Fuera de alcance
- Colaboración en tiempo real
- Notificaciones push
- App móvil nativa
```

---

## 1.3 Investigación profunda con `/skill:research`

Una vez que tienes la spec, necesitas investigar decisiones técnicas. Por ejemplo: ¿cómo estructurar el schema de PocketBase para tareas con categorías?

### Paso 1: Iniciar research

```
/skill:research Cómo modelar tareas con categorías en PocketBase. Considerar:
- ¿Relación many-to-many entre tareas y categorías, o campo de texto libre?
- ¿Cómo manejar prioridades (enum vs número)?
- ¿Soft delete vs hard delete?
```

La skill research:

1. Investiga documentación oficial de PocketBase.
2. Lee código existente si hay.
3. Compara alternativas.
4. Genera un reporte con recomendaciones.

✅ **Checkpoint:** Lee `.frida/artifacts/research/2025-XX-XX_pocketbase-schema.md`. Debe incluir pros/contras de cada opción.

### Ejemplo de output

```markdown
# Research: Schema de tareas en PocketBase

## Hallazgos

### Categorías: relación vs texto libre
**Opción A: Texto libre (string en `task`)**
- ✅ Simple, sin JOIN
- ❌ Duplicación, typos, no se puede normalizar

**Opción B: Colección `categories` + relación**
- ✅ Reutilizable, autocomplete fácil
- ❌ JOIN en queries, una colección más

**Recomendación:** Opción B. PocketBase maneja relaciones nativamente y shadcn
tiene Combobox que facilita el selector.

### Prioridades: enum vs número
**Recomendación:** Enum (string "low"/"medium"/"high").
Más legible en queries y permite validación con TypeScript.
```

---

## 1.4 Diseño de la arquitectura con `/skill:design`

Con la spec + research, puedes diseñar la arquitectura. Esta fase produce ADRs (Architecture Decision Records).

### Paso 1: Invocar design

```
/skill:design Diseña la arquitectura de la app de tareas. Usa la spec en
.frida/artifacts/discover/ y la research en .frida/artifacts/research/.
Necesito: estructura de directorios, schema de PocketBase, rutas de Next.js,
componentes shadcn a usar, y ADRs para las decisiones clave.
```

La skill design:

1. Lee la spec + research.
2. Propone estructura de directorios.
3. Diseña el schema.
4. Genera ADRs.
5. Identifica riesgos.

✅ **Checkpoint:** Revisa `.frida/artifacts/design/2025-XX-XX_todo-app-architecture.md`.

### Ejemplo de output (ADR)

```markdown
# ADR-001: Usar App Router de Next.js 15

## Contexto
Next.js 15 introduce el App Router como default. Ofrece server components,
layouts anidados, y streaming.

## Decisión
Usar App Router para toda la app.

## Consecuencias
- ✅ Server components por default (menos JS al cliente)
- ✅ Layouts compartidos (sidebar, header)
- ⚠️ Requiere "use client" para componentes interactivos
- ⚠️ Algunas libs (ej. framer-motion) requieren client wrapper
```

---

## 2.1 Scaffold del proyecto Next.js

Ahora que tienes el diseño, vamos a inicializar el proyecto. Usaremos `create-next-app` con todas las opciones correctas.

### Paso 1: Crear el proyecto

```bash
cd ~/projects/todo-frida
npx create-next-app@latest . \
  --typescript \
  --app \
  --tailwind \
  --eslint \
  --src-dir \
  --import-alias "@/*" \
  --use-npm
```

Responde a las preguntas interactivas:

- Would you like to use Turbopack? → **Yes** (más rápido)
- Would you like to customize the import alias? → **No**

✅ **Verifica:** `package.json` debe tener `next: "^15.x.x"`.

### Paso 2: Estructura inicial

```bash
ls -la
# .next/         (build cache)
# node_modules/
# public/
# src/
#   app/
#     layout.tsx
#     page.tsx
#     globals.css
#   components/
#   lib/
#   ...
# package.json
# tsconfig.json
```

### Paso 3: Commit inicial

```bash
git add .
git commit -m "chore: scaffold Next.js 15 con TypeScript y Tailwind"
```

---

## 2.2 Configuración de shadcn/ui

shadcn/ui no es una librería tradicional — copia componentes a tu proyecto para que los puedas modificar libremente.

### Paso 1: Inicializar shadcn

```bash
npx shadcn@latest init
```

Responde:

- Which style would you like to use? → **New York** (más limpio)
- Which color would you like to use as base? → **Slate**
- Do you want to use CSS variables for colors? → **Yes**

### Paso 2: Agregar componentes que usaremos

```bash
npx shadcn@latest add button card input label form select checkbox dialog dropdown-menu table badge toast sonner
```

✅ **Verifica:** `src/components/ui/` debe tener 14 archivos `.tsx`.

### Paso 3: Commit

```bash
git add .
git commit -m "chore: agregar componentes shadcn/ui"
```

---

## 2.3 Levantar PocketBase con Docker

PocketBase es una base de datos con auth y admin UI incluidos. La levantamos con Docker.

### Paso 1: Crear `docker-compose.yml`

```bash
cat > docker-compose.yml <<'EOF'
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    container_name: todo-pb
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - ./pb_data:/pb_data
      - ./pb_public:/pb_public
    environment:
      - PB_ADMIN_EMAIL=admin@todo.local
      - PB_ADMIN_PASSWORD=admin12345
EOF
```

### Paso 2: Levantar el servicio

```bash
docker compose up -d
```

✅ **Verifica:** Abre [http://localhost:8090/_/](http://localhost:8090/_/) — debes ver el admin UI de PocketBase.

### Paso 3: Commit

```bash
git add docker-compose.yml
echo "pb_data/" >> .gitignore
echo "pb_public/" >> .gitignore
git add .gitignore
git commit -m "chore: docker-compose para PocketBase"
```

---

## 2.4 Schema inicial de la base de datos

Ahora creamos las colecciones en PocketBase. Haremos esto desde el admin UI.

### Paso 1: Acceder al admin UI

1. Abre [http://localhost:8090/_/](http://localhost:8090/_/).
2. Login con `admin@todo.local` / `admin12345`.

### Paso 2: Crear colección `users` (built-in)

PocketBase ya tiene `users` con auth built-in. Solo necesitamos:

1. Ir a Settings → Users.
2. Habilitar "Username" como campo opcional.
3. Habilitar "Verified" para forzar verificación de email (opcional en MVP).

### Paso 3: Crear colección `categories`

1. Click en "New collection".
2. Nombre: `categories`.
3. Schema:
   - `name` (text, required, max 50)
   - `color` (text, max 7, formato hex `#RRGGBB`)
   - `user` (relation → users, required, cascade delete)
4. API Rules:
   - List/View: `user = @request.auth.id`
   - Create/Update/Delete: `@request.auth.id != "" && user = @request.auth.id`

### Paso 4: Crear colección `tasks`

1. Click en "New collection".
2. Nombre: `tasks`.
3. Schema:
   - `title` (text, required, max 200)
   - `description` (text, max 2000)
   - `priority` (select: low, medium, high, default medium)
   - `done` (bool, default false)
   - `due_date` (date, optional)
   - `user` (relation → users, required, cascade delete)
   - `category` (relation → categories, optional, cascade delete)
4. API Rules:
   - List/View: `user = @request.auth.id`
   - Create/Update/Delete: `@request.auth.id != "" && user = @request.auth.id`

### Paso 5: Verificar schema

En el admin UI:

- Collections → `users`: tiene campos email, password, verified.
- Collections → `categories`: tiene name, color, user.
- Collections → `tasks`: tiene title, description, priority, done, due_date, user, category.

✅ **Checkpoint:** Las 3 colecciones existen con las API rules correctas.

### Paso 6: Commit del schema

PocketBase guarda el schema en `pb_data/`. Como está en `.gitignore`, lo exportamos a un JSON:

```bash
# Crear script para exportar schema
cat > scripts/export-schema.sh <<'EOF'
#!/bin/bash
mkdir -p pb_schema
curl -s http://localhost:8090/api/health > /dev/null || {
  echo "PocketBase no está corriendo. Levantando..."
  docker compose up -d pocketbase
  sleep 3
}
# Login como admin
TOKEN=$(curl -s -X POST http://localhost:8090/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@todo.local","password":"admin12345"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
# Exportar collections
curl -s -H "Authorization: $TOKEN" \
  http://localhost:8090/api/collections \
  > pb_schema/collections.json
echo "Schema exportado a pb_schema/collections.json"
EOF
chmod +x scripts/export-schema.sh
```

✅ **Verifica:** `./scripts/export-schema.sh` debe crear `pb_schema/collections.json`.

```bash
git add scripts/
git commit -m "feat: script para exportar schema de PocketBase"
```

---

## 2.5 Cliente PocketBase en Next.js

Ahora conectamos Next.js a PocketBase. Usaremos el SDK oficial de JS.

### Paso 1: Instalar el SDK

```bash
npm install pocketbase
```

### Paso 2: Crear el cliente

```bash
mkdir -p src/lib
cat > src/lib/pocketbase.ts <<'EOF'
import PocketBase from "pocketbase";
import { cookies } from "next/headers";

const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://localhost:8090";

// Cliente del lado del servidor (lee cookie de auth)
export async function getServerPocketBase() {
  const pb = new PocketBase(POCKETBASE_URL);
  const cookieStore = await cookies();
  const authCookie = cookieStore.get("pb_auth");
  if (authCookie) {
    pb.authStore.loadFromCookie(authCookie.value);
  }
  return pb;
}

// Cliente del lado del cliente (singleton)
let clientPb: PocketBase | null = null;
export function getClientPocketBase() {
  if (typeof window === "undefined") {
    throw new Error("getClientPocketBase solo se puede usar en el cliente");
  }
  if (!clientPb) {
    clientPb = new PocketBase(POCKETBASE_URL);
  }
  return clientPb;
}
EOF
```

### Paso 3: Configurar variables de entorno

```bash
cat > .env.local <<'EOF'
POCKETBASE_URL=http://localhost:8090
EOF
echo ".env.local" >> .gitignore
```

### Paso 4: Commit

```bash
git add .
git commit -m "feat: cliente PocketBase para server y client components"
```

---

## 2.6 Primera conversación con Frida

Ahora vamos a usar Frida para verificar que todo está bien configurado.

### Paso 1: Abrir el chat de Frida

1. Click en el ícono lila de Frida en la barra lateral.
2. Escribe: `Hola, revisa la configuración de mi proyecto y dime si hay algún problema`.

Frida va a:

- Leer `package.json`, `docker-compose.yml`, `src/lib/pocketbase.ts`.
- Verificar que las versiones sean compatibles.
- Reportar issues (ej. `pocketbase` no está en `dependencies` si lo agregaste mal).

### Paso 2: Verificar la skill de discover

Escribe:

```
/skill:discover
```

Deberías ver la skill ejecutándose y preguntando qué quieres descubrir. Esta skill es la misma que usaste en la sección 1.2 — ahora confirmas que está disponible en tu proyecto.

### Paso 3: Usar el comando `/version`

```
/version
```

Frida reporta su versión (`v0.4.0` en este tutorial) y la del SDK de Pi.

✅ **Checkpoint:** Las 3 interacciones (chat libre, `/skill:discover`, `/version`) funcionan.

---

## 3.1 Diseño del flujo de auth con frida-pipeline

Ahora vamos a usar el workflow completo `/wf build` para implementar autenticación. Este workflow automatiza 7 stages:

1. **Spec** — leer la spec existente.
2. **Design** — diseñar la feature.
3. **Plan** — generar tareas.
4. **Slice** — descomponer en slices.
5. **Implement** — implementar cada slice.
6. **Test** — escribir tests.
7. **Review** — revisar el código.

### Paso 1: Crear la spec de auth

En el chat de Frida:

```
/skill:discover Necesito implementar autenticación en la app de tareas.
Los usuarios deben poder:
- Registrarse con email + password
- Login (guardar sesión en cookie)
- Logout
- Ver su perfil

Restricciones:
- PocketBase para auth (ya está corriendo)
- Next.js 15 App Router (server actions)
- shadcn/ui para forms
```

✅ **Verifica:** Existe `.frida/artifacts/discover/2025-XX-XX_auth.md`.

---

## 3.2 Implementación con `/wf build`

### Paso 1: Invocar el workflow

En el chat de Frida:

```
/wf build "Implementar autenticación completa (registro, login, logout, perfil)"
```

El workflow automáticamente:

1. Lee las specs en `.frida/artifacts/discover/`.
2. Diseña la feature.
3. Genera un plan con tareas.
4. Para cada tarea: implementa, testea, revisa.
5. Genera un reporte al final.

✅ **Verifica:** Existe `.frida/artifacts/wf/2025-XX-XX_auth-build.md` con el reporte completo.

### Paso 2: Inspeccionar los archivos generados

```bash
git status
# Verás archivos nuevos en:
#   src/app/(auth)/login/page.tsx
#   src/app/(auth)/register/page.tsx
#   src/app/api/auth/login/route.ts
#   src/lib/auth.ts
#   tests/auth.test.ts
```

### Paso 3: Probar manualmente

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) y:

1. Click en "Register".
2. Crea un usuario (`test@example.com` / `password123`).
3. Verifica que redirige a `/dashboard` (o la ruta que haya creado el workflow).
4. Logout.
5. Login de nuevo.

✅ **Checkpoint:** El ciclo completo de auth funciona.

### Paso 4: Commit

```bash
git add .
git commit -m "feat: autenticación completa con PocketBase"
```

---

## 3.3 Verificación con `/wf vet`

`/wf vet` es un workflow de revisión enfocado (2 stages): auditoría de seguridad y revisión de patrones.

### Paso 1: Invocar vet

```
/wf vet
```

Frida analiza:

- ¿Las passwords se hashean? (PocketBase lo hace automáticamente, pero verifica).
- ¿Las cookies son httpOnly y secure en producción?
- ¿Hay CSRF protection en los forms?
- ¿Los API endpoints validan inputs?

✅ **Verifica:** Existe `.frida/artifacts/wf/2025-XX-XX_auth-vet.md` con findings.

### Paso 2: Aplicar fixes

Si hay findings, Frida te dirá qué corregir. Aplica los cambios y vuelve a correr `/wf vet`.

---

## 3.4 Subagentes de revisión con frida-subagents

Otra forma de revisar código es lanzar subagentes paralelos. Frida tiene 3 subagentes built-in:

- **Explore** — read-only, para entender código existente.
- **Plan** — read-only, para diseñar cambios.
- **general-purpose** — tiene todas las tools, hereda contexto.

### Paso 1: Lanzar subagentes de revisión

En el chat de Frida:

```
Lanza 3 subagentes en paralelo para revisar la autenticación:
1. Explore: "Encuentra todas las rutas de auth y documenta el flujo"
2. Plan: "Propón mejoras de seguridad para los forms de auth"
3. general-purpose: "Escribe tests E2E con Playwright para el flujo de auth"
```

Frida invocará el tool `Agent` 3 veces (probablemente en background con `run_in_background: true`).

### Paso 2: Esperar resultados

```
get_subagent_result de los 3 agentes
```

Frida te mostrará los 3 reportes.

### Paso 3: Aplicar mejoras

Revisa los reportes y aplica las sugerencias más relevantes. Commit:

```bash
git add .
git commit -m "refactor: mejoras de seguridad basadas en review de subagentes"
```

✅ **Checkpoint:** Los 3 subagentes completaron y generaron artefactos útiles.

---

## 4.1 Spec de la feature con frida-pipeline

Ahora implementamos el CRUD de tareas. Igual que con auth, empezamos con una spec.

### Paso 1: Spec de tareas

```
/skill:discover Feature: CRUD de tareas
- Los usuarios autenticados pueden crear tareas con título, descripción, prioridad, categoría, fecha de vencimiento
- Pueden listar sus tareas (filtros: por categoría, por estado done/undone, por prioridad)
- Pueden editar tareas
- Pueden marcar como hechas
- Pueden eliminar tareas
- La UI debe ser responsive (mobile-first)
```

✅ **Verifica:** Spec creada en `.frida/artifacts/discover/`.

### Paso 2: Research específica

```
/skill:research Cómo implementar filtrado y ordenamiento en PocketBase
con la sintaxis de filter. Considerar:
- ¿Cómo combinar múltiples filtros (categoría + prioridad + done)?
- ¿Cómo ordenar por múltiples campos?
- ¿Paginación con cursor vs offset?
```

---

## 4.2 Plan de implementación con `/skill:plan`

Con la spec + research, generamos un plan ejecutable.

### Paso 1: Invocar plan

```
/skill:plan Feature: CRUD de tareas. Usa las specs en .frida/artifacts/.
Genera un plan con tareas atómicas (cada una < 2 horas de trabajo).
```

✅ **Verifica:** Plan creado en `.frida/artifacts/plan/2025-XX-XX_tasks.md`.

### Ejemplo de plan

```markdown
# Plan: CRUD de tareas

## Tareas

### Slice 1: Schema y tipos
- [ ] Agregar tipos TypeScript para Task, Category, Priority
- [ ] Crear helpers de validación con Zod
- [ ] Tests unitarios de los tipos

### Slice 2: Server actions
- [ ] `createTask` con validación
- [ ] `updateTask` con optimistic locking
- [ ] `deleteTask` con confirmación
- [ ] `toggleTaskDone` con animación

### Slice 3: UI: lista
- [ ] Componente `TaskList` con shadcn Table
- [ ] Filtros: CategoryFilter, PriorityFilter, DoneFilter
- [ ] Empty state cuando no hay tareas

### Slice 4: UI: forms
- [ ] `TaskForm` con shadcn Form + Zod resolver
- [ ] `TaskCard` para vista mobile
- [ ] Dialog de confirmación de delete

### Slice 5: Integración
- [ ] Wire up server actions con useOptimistic
- [ ] Toast notifications con Sonner
- [ ] Tests E2E
```

---

## 4.3 Implementación iterativa con `/skill:implement`

Ahora implementamos slice por slice. Cada invocación de `/skill:implement` toma una tarea y la ejecuta.

### Paso 1: Implementar slice 1

```
/skill:implement Slice 1 del plan en .frida/artifacts/plan/2025-XX-XX_tasks.md
```

Frida:

1. Lee el plan.
2. Identifica la primera tarea.
3. Implementa el código.
4. Corre los tests.
5. Marca la tarea como completada en el plan.

✅ **Verifica:** Los tipos existen en `src/lib/types.ts` y los tests pasan.

### Paso 2: Iterar por cada slice

Repite para slices 2-5:

```
/skill:implement Siguiente slice
```

Frida continúa donde quedó.

### Paso 3: Verificar el progreso

Abre `.frida/artifacts/plan/2025-XX-XX_tasks.md` — verás los checkboxes actualizándose.

---

## 4.4 Validación con `/skill:validate`

Una vez implementado, validamos con la skill de validate.

### Paso 1: Invocar validate

```
/skill:validate Feature: CRUD de tareas. Ejecuta todos los checks:
- typecheck
- tests unitarios
- tests E2E
- linter
- build
```

✅ **Verifica:** Reporte en `.frida/artifacts/validate/2025-XX-XX_tasks.md`.

### Paso 2: Aplicar fixes

Si hay errores, Frida te dirá qué corregir. Para cada error:

```
/skill:implement Corrige el error reportado en .frida/artifacts/validate/
```

---

## 5.1 Inspección de UI con frida-agent-browser

Frida incluye un tool para abrir un browser real y tomar snapshots de la UI. Útil para verificar visualmente.

### Paso 1: Iniciar el dev server

```bash
npm run dev
```

### Paso 2: En el chat de Frida

```
agent_browser abre http://localhost:3000 y dime si la página se ve bien
```

Frida:

1. Abre un browser headless.
2. Navega a la URL.
3. Toma un snapshot del DOM.
4. Reporta problemas visuales (errores en consola, elementos rotos, etc.).

### Paso 3: Iteración visual

```
agent_browser toma un screenshot de /dashboard y compara con el diseño
```

✅ **Checkpoint:** Frida confirma visualmente que la UI está correcta.

---

## 5.2 Búsqueda web con frida-agent-browser

Frida también puede buscar en la web usando Exa o Brave. Útil para investigar librerías o patrones.

### Paso 1: Buscar documentación

```
agent_browser_web_search "shadcn ui data table pagination example"
```

Frida busca y devuelve los mejores resultados.

### Paso 2: Leer documentación

```
agent_browser abre https://ui.shadcn.com/docs/components/data-table y
extrae el código del componente
```

---

## 5.3 Integración con bases de datos externas vía MCP

Frida incluye integración con servidores MCP. Vamos a usar el MCP de GitHub para automatizar issues.

### Paso 1: Configurar MCP de GitHub

Crea `.mcp.json` en la raíz del proyecto:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${input:github_token}"
      }
    }
  }
}
```

### Paso 2: Recargar Frida

`Cmd+Shift+P` → `Developer: Reload Window`.

### Paso 3: Probar MCP

En el chat:

```
mcp({ search: "issues" })
```

Frida lista los tools de GitHub disponibles.

### Paso 4: Crear una issue

```
mcp({ tool: "create_issue", args: { owner: "mi-usuario", repo: "todo-frida", title: "Bug: filtro de prioridad no funciona" } })
```

✅ **Checkpoint:** La issue se crea en GitHub via MCP.

---

## 5.4 Auto-regulación con frida-context

A veces las conversaciones se vuelven largas y el contexto se llena. Frida tiene un tool para auto-regularse.

### Paso 1: Ver presión del contexto

```
/context
```

Frida muestra:

- % de contexto usado
- Tamaño de la conversación
- Sugerencias (compactar, resumir, dividir en subagentes)

### Paso 2: Compactar

```
/compact Resume los archivos modificados y la conversación en un resumen
```

Frida reemplaza la conversación con un resumen compacto, liberando espacio.

---

## 5.5 Gates de aprobación con frida-permission-system

Frida tiene un sistema de gates para comandos sensibles (borrar archivos, push a git, deploys).

### Paso 1: Configurar gates

Settings → `Frida Code: Permissions`:

| Gate | Acción | Requiere aprobación |
| --- | --- | --- |
| `bash:rm` | Borrar archivos | ✅ |
| `bash:git-push` | Push a remote | ✅ |
| `deploy:docker` | Deploy con Docker | ✅ |
| `bash:curl-POST` | HTTP POST | ❌ |

### Paso 2: Probar un gate

En el chat:

```
Borra el archivo .env.local
```

Frida te pedirá aprobación antes de ejecutar `rm`.

✅ **Checkpoint:** El gate bloquea la acción hasta que apruebas.

---

## 6.1 Suite de pruebas con frida-pipeline

Frida tiene una skill dedicada a testing.

### Paso 1: Configurar Vitest

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
```

```bash
cat > vitest.config.ts <<'EOF'
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
EOF

cat > vitest.setup.ts <<'EOF'
import "@testing-library/jest-dom";
EOF
```

### Paso 2: Escribir tests

```
/skill:implement Escribe tests unitarios para src/lib/auth.ts y
src/lib/tasks.ts. Usa Vitest + React Testing Library.
```

### Paso 3: Correr tests

```
npm run test
```

---

## 6.2 Code review con `/skill:code-review`

Antes de hacer merge, una review de código.

### Paso 1: Crear branch y PR

```bash
git checkout -b feat/crud-tareas
git push origin feat/crud-tareas
gh pr create --title "CRUD de tareas" --body "Implementa spec X"
```

### Paso 2: Invocar code review

```
/skill:code-review Revisa el código de la PR #1
```

Frida:

1. Hace `git diff main..feat/crud-tareas`.
2. Analiza cada archivo modificado.
3. Genera un reporte con findings.

✅ **Verifica:** Reporte en `.rpiv/artifacts/discover/2025-XX-XX_pr-1-review.md`.

---

## 6.3 Changelog y release notes

Frida tiene una skill para generar changelogs.

### Paso 1: Generar changelog

```
/skill:changelog Genera el changelog desde el último release
```

Frida:

1. Lee los commits desde el último tag.
2. Los clasifica (feat, fix, chore, etc.).
3. Actualiza `CHANGELOG.md`.

### Paso 2: Release

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --generate-notes
```

---

## 6.4 Deploy con Docker

Para deployar, agregamos un Dockerfile para Next.js.

### Paso 1: Dockerfile

```bash
cat > Dockerfile <<'EOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
EOF
```

### Paso 2: Actualizar next.config.ts

```typescript
const nextConfig = {
  output: "standalone",
};
export default nextConfig;
```

### Paso 3: Build de la imagen

```bash
docker build -t todo-frida:latest .
```

---

## A. Referencia rápida de slash commands

| Comando | Descripción |
| --- | --- |
| `/help` | Lista todos los comandos |
| `/version` | Versión de Frida y SDK de Pi |
| `/update` | Verificar actualizaciones |
| `/compact` | Compactar contexto |
| `/context` | Ver presión del contexto |
| `/pipeline` | Estado del pipeline de frida-pipeline |
| `/frida-update-agents` | Re-sincronizar agentes globales |
| `/frida-models` | Editor de overrides de modelo |
| `/agents` | Estado de subagentes |
| `/todo` | Gestor de TODOs |
| `/wf build "<feature>"` | Workflow completo (7 stages) |
| `/wf vet` | Revisión enfocada (2 stages) |
| `/wf polish` | Pulido estructural (4 stages) |
| `/mcp` | Panel MCP |
| `/mcp-auth` | Autenticación MCP |
| `/skill:<nombre>` | Invocar skill específica |

### Skills disponibles (28)

- **Descubrimiento:** `discover`, `research`, `explore`
- **Diseño:** `design`, `design-slice`, `design-review`, `slice`
- **Planificación:** `plan`, `blueprint`, `synthesize`, `elaborate`, `revise`
- **Ejecución:** `implement`, `validate`, `grade`, `amend`, `commit`
- **Revisión:** `code-review`, `architecture-review`, `pr-triage`
- **Utilidades:** `create-handoff`, `resume-handoff`, `changelog`
- **Anotación:** `annotate-guidance`, `annotate-inline`, `migrate-to-guidance`
- **Frontend:** `frontend-design`

---

## B. Configuración de MCP servers

### GitHub

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

### PostgreSQL

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "postgresql://user:pass@host:5432/db" }
    }
  }
}
```

### Filesystem

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    }
  }
}
```

Ver [docs/tools/frida-mcp-adapter.md](./tools/frida-mcp-adapter.md) para más detalles.

---

## C. Solución de problemas comunes

### Frida no aparece en la barra lateral

1. Verifica que la extensión está habilitada: Settings → Extensions.
2. Recarga VS Code: `Cmd+Shift+P` → `Developer: Reload Window`.
3. Revisa la consola: Help → Toggle Developer Tools → Console.

### "Failed to load extension: Invalid URL"

Este es un bug conocido de Frida 0.3.0 con extensiones externas. Solución:

- Actualiza a Frida 0.3.1 o superior.
- O mueve las extensiones a `~/.frida/extensions/` (no en subdirs).

### El modelo no responde

1. Verifica tu API key: Settings → Frida Code → Provider.
2. Verifica tu conexión a internet.
3. Revisa los logs: View → Output → "Frida Code".

### Docker no levanta PocketBase

```bash
docker compose down
docker volume prune  # ⚠️ Borra volúmenes huérfanos
docker compose up -d
```

### Los tests E2E fallan

Verifica que PocketBase esté corriendo:

```bash
curl http://localhost:8090/api/health
# {"code":200,"message":"API is healthy.","data":{}}
```

### MCP server no conecta

1. Verifica `.mcp.json` es válido: `python3 -m json.tool .mcp.json`.
2. Recarga Frida: `/reload` en el chat.
3. Revisa los logs: `/mcp` → "Reconnect".

---

## Recursos adicionales

- [Repositorio de Frida Code](https://github.com/efuentesp/frida-code)
- [Documentación completa](./README.md)
- [ADRs (Architecture Decision Records)](./adr/)
- [Pi Agent SDK](https://github.com/earendil-works/pi-coding-agent)
- [Next.js docs](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [PocketBase docs](https://pocketbase.io/docs)

---

> **Versión del tutorial:** 1.0
> **Compatible con:** Frida Code 0.4.0+
> **Última actualización:** 2025-07-31
