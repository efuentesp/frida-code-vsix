# frida-sandboxes

> Container Docker **local** por agente — el "own computer" del modelo Agentic
> Engineering. Tier-2 de aislamiento: worktree (#13) aísla archivos por branch;
> sandbox aísla **la computadora completa**. Issue #35 · ADR-0047.

## Qué es

Cada sandbox es un container Docker con una copia del proyecto en `/workspace`.
Mientras la sesión tiene un sandbox activo, **los comandos `bash` del agente se
redirigen automáticamente al container** (hook `tool_call` reescribe
`input.command` → `docker exec …`). El host queda intacto: instala
dependencias, corre migraciones destructivas, prueba scripts — todo vive y
muere en el container.

```
agente: bash "npm install && npm test"   →   docker exec -w /workspace frida-sbx-audit …
```

## Superficie

### Tools del agente

| Tool | Qué hace |
| --- | --- |
| `sandbox_create` | Container + copia del proyecto → activa la redirección de `bash` |
| `sandbox_exec` | Comando explícito dentro del container (sujeto a policy) |
| `sandbox_status` | Inventario de sandboxes |
| `sandbox_changes` | `git status --porcelain` in-container (qué modificó) |
| `sandbox_merge` | `docker cp` archivo a archivo de vuelta al proyecto |
| `sandbox_destroy` | `docker rm -f` — rehúsa si hay cambios sin mergear (confirmar con usuario) |

### Comando `/sandbox`

```
/sandbox                        → panel del webview (Activos · terminal · pausar/descartar)
/sandbox create [n] [--image i] · list · pause/resume <n> · destroy <n> [--force] · probe
```

### Panel webview

Master-detail estilo `/ccplugin`: lista filtrable + ficha con **Terminal**
(`docker exec -it` en terminal de VS Code), Pausar/Reanudar, Descartar (con
confirmación en el webview) y cambios pendientes. Sin Docker: estado vacío
honesto con guía de instalación y **Reintentar detección**.

## Gating (sin Docker)

**Nada truena.** Probe de capability cacheado (60s): CLI + daemon. Sin Docker,
los tools devuelven una nota honesta de una línea ("📦 Sandbox no disponible —
continúa con tus herramientas normales"), el botón Terminal no aparece y el
panel muestra la guía (macOS: Docker Desktop/OrbStack · Linux: docker.io).

## Policy in-container (ADR D4)

El container es el **boundary**; la policy (porte de `pi-sandbox`) refina qué
puede tocar el agente DENTRO:

- `frida.sandboxes.allowDomains`: allowlist de dominios de red (glob:
  `*.npmjs.org`); vacía = sin restricción.
- Write-paths: `/workspace` + `/tmp` (destructivos fuera → bloqueados).

## Settings

| Llave | Default | Qué |
| --- | --- | --- |
| `frida.sandboxes.enabled` | `true` | Toggle de la extensión |
| `frida.sandboxes.defaultImage` | `node:22` | Imagen de nuevos sandboxes (debe traer git) |
| `frida.sandboxes.allowDomains` | `[]` | Allowlist de red in-container |

## Arquitectura

```
src/tools/frida-sandboxes/
├── constants.ts  nombres (frida-sbx-<n>), rutas ~/.frida/sandboxes/
├── docker.ts     adapter Docker (probe + lifecycle + exec + cp) — swap e2b→CLI
├── manager.ts    SandboxManager: registry persistente + sync/changes/merge
├── policy.ts     porte pi-sandbox (dominios + write-paths)
├── panel.ts      contrato del panel webview (patrón CcPanel)
└── index.ts      extensión: tools + /sandbox + redirección tool_call
```

- **Redirección**: hook `tool_call` de Pi (`event.input` mutable) — el patrón
  `createE2bReadOps` de `pi-extension-e2b`, sin el backend cloud.
- **Merge**: MVP archivo a archivo (`docker cp` OUT); merge por branch queda
  para la integración con `withSandbox()` de workflows.
- **Registro**: `~/.frida/sandboxes/registry.json` (estado deseado; la verdad
  viva la da `docker inspect` vía refresh).

## Dependencias y composición

- **Requiere**: Docker en el host (gating D5).
- **Compone con**: #26 better-subagents (detached-in-sandbox, opcional);
  futuro `withSandbox()` en frida-extensible-workflows.
- **No duplica** `frida-permission-system` (boundaries vs entorno).

## Prueba e2e (Dev Host con Docker)

1. `/sandbox` → panel con estado de Docker (o guía si falta).
2. Pide al agente: *"crea un sandbox y corre los tests dentro"* → `sandbox_create`
   → la sesión redirige `bash` → `npm test` corre en el container.
3. `sandbox_changes` → lista de archivos; `sandbox_merge` de uno → aparece en
   tu copia local.
4. Panel: Terminal, Pausar/Reanudar, Descartar con confirmación.
