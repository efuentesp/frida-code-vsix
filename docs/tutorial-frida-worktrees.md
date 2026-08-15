# Tutorial: Frida Worktrees — requerimientos paralelos sin choques

Cómo trabajar **varios requerimientos al mismo tiempo** en Frida Code usando git
worktrees: una ventana VS Code y una sesión de chat por requisito, sin que se
piensen entre sí, y cómo integrarlos a la base común (`main`) para commit y
push.

> Implementación: comando **`Frida: Worktrees`** (paleta / botón SCM) y slash
> command **`/worktree`** (chat). Porte nativo de `@narumitw/pi-worktree`
> (issue #13).

---

## Concepto en 30 segundos

Cada **worktree** es una copia del repo en su propia carpeta con su propia rama:

```
~/.worktrees/<repo>/<rama>/
```

Frida abre cada una en una **ventana VS Code aparte**, con su propia sesión de
chat (cwd = el worktree). Trabajas los requerimientos en paralelo sin pisarte.

Puntos clave:

- **La integración no la hace el comando de worktrees**: es flujo git normal
  (`merge` + `push`) desde tu ventana principal.
- **Los worktrees NO se eliminan solos al integrarse**: al final los quitas
  explícitamente con **Remove** (borra la carpeta, **conserva la rama**).
- "Abrir/Switch" siempre abre una **ventana nueva** con sesión propia, porque
  Frida fija el cwd de la sesión al workspace.

---

## 1. Crear los worktrees (una sola vez)

Desde tu ventana principal de Frida:

1. Paleta (`Cmd+Shift+P`) → **`Frida: Worktrees`**
   (o el ícono de rama `$(git-branch)` en la barra del SCM).
2. Elige **Add**.
3. **Rama para el nuevo worktree**: p. ej. `req-1` → Enter.
4. **Punto de inicio**: déjalo vacío (usa la rama por defecto, p. ej. `main`)
   → Enter.
   - Nota: sólo se pregunta si la rama no existe; una rama existente se
     conecta directo.
5. **Path del worktree**: vacío → usa el default
   `~/.worktrees/<repo>/req-1` → Enter.
6. Confirma **Crear Git worktree**.
7. Pregunta **¿Abrir en ventana nueva?** → Sí. Se abre la ventana del
   requisito 1 con esa rama ya checked out.

Repite desde el paso 2 para cada requisito (`req-2`, `req-3`, …). Siempre
desde la **ventana principal**, para que el chat que crea cada worktree no sea
el de otro requisito.

> **Ventana cerrada por accidente**: vuelve a ella con
> `Frida: Worktrees` → **Abrir/Switch** → elige la rama del requisito.

### Verificar el estado (opcional)

```bash
git worktree list
# main      /ruta/al/repo                    [main]
# req-1     ~/.worktrees/<repo>/req-1        [req-1]
# req-2     ~/.worktrees/<repo>/req-2        [req-2]
# req-3     ~/.worktrees/<repo>/req-3        [req-3]
```

---

## 2. Trabajar cada requisito

En **cada ventana** Frida corre con cwd = ese worktree y la rama ya checked
out:

- Pídele al agente el trabajo del requisito, revisa los cambios.
- Haz **commits ahí mismo** como normalmente (`git add` + commit, o `/commit`):

  ```bash
  git commit -m "feat(req-1): lo que sea"
  ```

- Las ventanas son independientes: editar en una **no toca** las otras ni tu
  ventana principal. Cada SCM muestra sólo los cambios de su requisito.

---

## 3. Integrar a la base común (al ir terminando cada requisito)

No hay prisa: integra el requisito 1 hoy, el 2 mañana… El orden y el ritmo los
decides tú.

### Integración simple

En la **ventana principal** (rama `main`):

```bash
git merge req-1        # trae los commits del requisito 1
# si hay conflictos: resuélvelos, git add ., git commit
```

### Si `main` avanzó mientras trabajabas el requisito

Primero actualiza el requisito (en la **ventana del requisito**):

```bash
git merge main          # o git rebase main
# resuelve conflictos ahí
```

Luego integra en la **ventana principal**:

```bash
git merge req-2
```

### Liberar

Cuando estén integrados los requerimientos que quieres liberar:

```bash
git push origin main
```

---

## 4. Qué pasa con los worktrees al integrarse

**Nada — siguen existiendo** (carpeta + rama + registro en git). El merge solo
copia commits a `main`; no borra nada.

Después de integrar y pushear, límpialos explícitamente:

1. **Cierra la ventana VS Code** del requisito terminado.
2. Ventana principal → `Frida: Worktrees` → **Remove** → elige el worktree.
   - Si contiene datos ignorados (`node_modules`, `dist*`, build…), te los
     **lista y pide confirmación explícita** antes de borrar — es la
     protección de seguridad del porte (con re-validación post-confirmación).
   - Borra la **carpeta**, **no la rama**: la rama queda como respaldo por si
     quieres auditar o reintegrar.
3. Opcional, si la rama ya no la necesitas:

   ```bash
   git branch -d req-1     # -d sólo borra si ya está mergeada
   ```

4. Si alguna vez borraste la carpeta a mano (o algo quedó a medias):
   `Frida: Worktrees` → **Prune**. Primero muestra el **preview (dry-run)** de
   la metadata huérfana y luego, si confirmas, la limpia.

---

## 5. Configurar el root de worktrees (opcional)

Por defecto los worktrees viven en `~/.worktrees/<repo>/<rama>`. Para usar otro
directorio en tu máquina:

`Frida: Worktrees` → **Configure** → ingresa la nueva ruta.

Los worktrees nuevos se crearán ahí (los existentes no se mueven). El root
efectivo se muestra en el menú principal del comando.

---

## Ciclo de vida resumido

```
main ──┬── merge req-1 ──┬── merge req-2 ──┬── merge req-3 ──► push origin main
       │                 │                 │
req-1 ─┘   req-2 ────────┘    req-3 ───────┘
(cada rama vive en ~/.worktrees/<repo>/<rama>, con su ventana propia)

Terminado → Remove worktree (borra carpeta) → opcional: git branch -d <rama>
```

**Regla práctica**:

| Concepto | Rol |
| --- | --- |
| Worktree (carpeta) | Espacio de trabajo **vivo** del requisito |
| Rama | Historial **persistente** del requisito |
| Merge | Integración a la base común |
| Remove | Limpieza de la carpeta (la rama sobrevive) |
| Prune | Limpieza de metadata huérfana |

Mientras no hagas Remove, puedes seguir trabajando un requisito incluso
después de integrarlo (merge de ida y vuelta: `main` ↔ requisito).

---

## Protecciones de seguridad (qué esperar)

El porte conserva toda la seguridad del original:

- **Git vía argv** (sin shell): nombres de rama con espacios o caracteres
  especiales se pasan literales, sin inyección.
- **Targets ocupados**: Add rechaza paths ya registrados o directorios no
  vacíos existentes.
- **Symlinks irresolubles** y eliminaciones con riesgo de pérdida: rechazadas.
- **Confirmaciones destructivas con re-validación**: entre tu confirmación y la
  ejecución se re-verifica el estado (TOCTOU) y el inventario de datos
  ignorados.
- **Detached HEAD durable**: no depende de refs frágiles para sobrevivir.

---

## Comandos rápidos

| Quiero… | Cómo |
| --- | --- |
| Crear worktree | `Frida: Worktrees` → Add |
| Volver a una ventana de requisito | `Frida: Worktrees` → Abrir/Switch |
| Eliminar worktree terminado | `Frida: Worktrees` → Remove |
| Limpiar metadata huérfana | `Frida: Worktrees` → Prune |
| Cambiar root default | `Frida: Worktrees` → Configure |
| Lo mismo desde el chat | `/worktree` |
| Ver todos los worktrees | `git worktree list` |
