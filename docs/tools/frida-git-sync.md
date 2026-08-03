# `frida-git-sync`

> **Estado:** ✅ **Porte funcional (MVP)** · [ADR-0026](../adr/0026-frida-git-sync-porter-pi-git-sync.md)

Mantiene la **misma configuración de frida en cada máquina** sincronizando el
agentDir (`~/.frida`) vía un **repositorio Git privado**.

```text
Máquina A ──/fridasync──> repo privado <──/fridasync── Máquina B
```

## ¿Qué es?

Porte nativo de [`@jachy/pi-git-sync`](https://github.com/jachy-h/pi-git-sync)
(v0.6.2). Sincroniza `settings.json`, `AGENTS.md`, `SYSTEM.md`,
`keybindings.json` y los directorios `extensions/`, `skills/`, `prompts/`,
`themes/` entre equipos, con comparación *three-way* (baseline → local → remoto),
rebase no destructivo, secret-scanning antes de push, backups pre-apply con
rollback y resolución de conflictos interactiva.

## ¿Cuándo usarla?

- Tienes **varias máquinas** (desktop, laptop, servidor) y quieres la misma
  configuración de frida en todas.
- Cambiaste de equipo y quieres **restaurar** tu configuración.
- Quieres **versionar** tus extensions/skills/agents en un repo privado.

## Uso

| Comando | Propósito |
| --- | --- |
| `/fridasync` | Configura una máquina o ejecuta una sincronización completa |
| `/fridasync status` | Muestra el estado de Git y la comparación three-way |
| `/fridasync diff` | Previsualiza los cambios pendientes antes de sincronizar |

En la **primera máquina**: crea un repo privado vacío en GitHub (sin README),
ejecuta `/fridasync` y pega la URL. En las demás: instala frida, ejecuta
`/fridasync` con la misma URL. Ejecuta `/fridasync` de nuevo tras cambiar la
configuración.

Mientras corre una sincronización, el **footer** muestra el progreso (fase,
mensaje, elapsed) y un botón **Cancel** que aborta la operación (mata el proceso
git en curso).

## Qué se sincroniza

| Contenido | Comportamiento |
| --- | --- |
| `settings.json` | Sync de archivo completo; los packages `file:` locales se conservan en cada dispositivo |
| `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `keybindings.json` | Copiados al agentDir |
| `extensions/`, `skills/`, `prompts/`, `themes/` | Desde sus directorios bajo `sync/` |

Estos paths **siempre se bloquean** (hard-deny, por seguridad):

```text
auth.json  sessions/**  trust.json  models-store.json  npm/**  git/**
node_modules/**  **/node_modules/**  .pi-sync/**  **/.env  **/*.pem
**/id_rsa  **/id_ed25519
```

## Modelo de sincronización

```text
agent files
   ├─ capturar y commitear cambios locales
   ├─ fetch de la rama configurada
   ├─ rebase de commits locales (o fast-forward si sólo hay cambios remotos)
   ├─ aplicar la configuración resultante a frida
   └─ push de la rama compartida + la rama de recuperación del dispositivo
```

Un paso que falla detiene la operación. Los archivos **nunca** se sobrescriben
silenciosamente cuando ambos lados cambiaron (se pide resolución de conflictos).

## Conflictos y seguridad

```text
                 cambió en un lado ──> continúa automáticamente
baseline ────────┤
                 cambió en ambos ──> pide decisión antes de aplicar
```

Para un conflicto de contenido: **pedir al agente** que mergée, elegir contenido
**local** o **remoto** para los paths en conflicto, o **abortar** y mergear
manualmente. Los cambios no conflictivos y la rama de recuperación de cada
dispositivo permanecen disponibles.

Otros resguardos: escrituras atómicas, backups pre-apply, lock de operación,
verificación de boundaries de paths, aprobación de paquetes y rollback tras
instalaciones fallidas.

## Arquitectura

```text
src/tools/frida-git-sync/
├── index.ts            # createFridaGitSync() factory + /fridasync + integración widget
├── constants.ts        # paths ~/.frida, namespace
├── store.ts            # syncWidgetStore reactivo (footer)
├── GitSyncWidget.tsx   # panel React (spinner + elapsed + Cancel)
├── panel.ts            # wireGitSyncWidget (footer idempotente)
└── src/                # árbol porteado de pi-git-sync
    ├── system/         # git (+ setGitExecutor), lock, security, backup, state,
    │                   # path-safety, conflict-resolution, packages, operation-context
    ├── orchestration/  # commands, setup/pull/push/conflict-flow, apply-transaction, phases
    ├── sync/           # config, inventory (3-way), capture, materialize, validate, glob
    └── extension/      # operation-runner (watchdog), ui (ANSI)
```

**Decisiones de porte** (ver ADR-0026): capa git enruta por `pi.exec` (inyección
`setGitExecutor`); paquetes sin cambios (CLI `pi` en PATH); UI webview
(notify/confirm/input/select) + panel `fridaWeb` con Cancel; agentDir `~/.frida`.

## Estado y madurez

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | ADR-0026 firmado | ✅ |
| 1 | Árbol porteado + adaptaciones de acoplamiento | ✅ |
| 2 | Factory `createFridaGitSync` + registro | ✅ |
| 3 | Panel fridaWeb + cancelación manual | ✅ |
| 4 | Tests (upstream + integración git) | ⏳ pendiente |
| 5 | README + CHANGELOG | ⏳ pendiente |

### Limitaciones conocidas del MVP

- **`pi.exec` y el árbol SSH**: al cancelar, se mata el proceso `git` pero no
  está garantizado que mate procesos `ssh` hijos. Se mitiga con timeout/watchdog.
- **Cancelación en diálogos**: el botón Cancel aborta la operación git en curso;
  los diálogos `input`/`confirm` (URL del repo, aprobación de paquetes) no son
  cancelables desde el footer (sí cerrándolos).
- **`/fridasync diff`**: se muestra como notificación truncada (el `ctx.ui.custom`
  del upstream es no-op en frida).
