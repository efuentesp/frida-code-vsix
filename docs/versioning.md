# Política de versionado y releases

> **Disclosure**: este documento es la fuente de verdad del versionado de Frida
> Code. El [`AGENTS.md`](../AGENTS.md) solo apunta aquí — **léelo antes de
> cambiar el número de versión o publicar un release**. El bump de versión es
> automático (`npm run release`) y se rige por los [Conventional
> Commits](https://www.conventionalcommits.org/es/) + [SemVer](https://semver.org/lang/es/).

---

## 1. SemVer (x.y.z)

Dado un número `MAYOR.MENOR.PARCHE`:

- **MAYOR** (x): cambios incompatibles (breaking). P.ej. `0.6.0 → 1.0.0`.
- **MENOR** (y): nueva funcionalidad retrocompatible. P.ej. `0.6.0 → 0.7.0`.
- **PARCHE** (z): correcciones retrocompatibles. P.ej. `0.6.0 → 0.6.1`.

### Fase pre-1.0 (0.y.z)

Mientras la versión `MAYOR` sea `0`, la API y el comportamiento pueden cambiar
entre versiones `MENOR`. Aun así respetamos el mapeo de Conventional Commits
(sección 2) para que el bump sea predecible: `feat:` sube `MENOR`, `fix:` sube
`PARCHE`, y `BREAKING CHANGE` sube `MAYOR` (→ `1.0.0` cuando toque).

---

## 2. Conventional Commits → bump

El tipo de cada commit determina el bump y la sección del `CHANGELOG.md`:

| Tipo de commit                          | Bump     | Sección CHANGELOG |
| --------------------------------------- | -------- | ----------------- |
| `feat:`                                 | **MENOR**| Añadido           |
| `fix:`                                  | **PARCHE**| Corregido        |
| `perf:` / `refactor:`                   | **PARCHE**| Cambiado         |
| `docs:` / `style:` / `test:` / `chore:` / `ci:` / `build:` | — (no publican) | Interno |
| `feat!:` o `BREAKING CHANGE:` en el body| **MAYOR**| Añadido           |

Reglas:

- El bump resultante es el **mayor** entre todos los commits desde el último
  release (`MAYOR > MENOR > PARCHE`).
- Si desde el último release solo hay commits que **no publican** (`docs:`,
  `chore:`, etc.), **no hay release**: `npm run release` aborta sin cambios.
- Un commit puede llevar **scope**: `feat(webview): …`, `fix(frida-subagents): …`.
  El scope se usa como etiqueta en el CHANGELOG, no afecta al bump.

### Ejemplos

```
feat(webview): lista de sesiones con stats + filtro    → MENOR (0.6.0 → 0.7.0)
fix(frida-subagents): limpiar worktrees al cerrar       → PARCHE (0.7.0 → 0.7.1)
docs: política de versionado                            → sin release
feat!: cambia el formato del archivo de sesión          → MAYOR (0.7.1 → 1.0.0)
```

---

## 3. El script `npm run release`

Automatiza el bump de versión + `CHANGELOG.md`. **No publica** (no compila el
`.vsix` ni abre el GitHub Release; eso es el runbook de la sección 4).

Qué hace, paso a paso:

1. Lee la versión actual de `package.json`.
2. Busca el último commit `chore(release):` como **punto de corte** (si no hay
   tags, este commit marca el último release).
3. Escanea los commits Conventional Commits desde el corte.
4. Determina el **bump** (mayor entre todos). Si ninguno justifica release,
   aborta con `Nada que releasear` y no toca nada.
5. Calcula la nueva versión.
6. **CHANGELOG.md**: mueve el contenido de `## [Unreleased]` a
   `## [X.Y.Z] - <fecha>` (preservando lo que escribiste a mano) y abre un nuevo
   `## [Unreleased]` vacío. Si `[Unreleased]` estaba vacío, autogenera los
   bullets a partir de los commits.
7. Actualiza `version` en `package.json`.
8. Hace `git add package.json CHANGELOG.md` + `git commit -m "chore(release): X.Y.Z"`.

Es **idempotente** y seguro: si se ejecuta dos veces seguidas, la segunda aborta
(no hay commits nuevos desde el release).

### Por qué un script propio y no `standard-version`/`release-please`

- Cero dependencias externas; lo puede ejecutar el agente o el dev localmente.
- Control total sobre el formato del `CHANGELOG.md` (en español, secciones
  Añadido/Cambiado/Corregido/Interno).
- Encaja con el flujo actual: sin CI, releases manuales en el repo
  [`efuentesp/frida-code-vsix`](https://github.com/efuentesp/frida-code-vsix), y
  el `.vsix` se compila aparte.

---

## 4. Runbook: publicar un release

Desde la raíz del repo, con el `main` limpio y actualizado:

```bash
# 1) Bump automático de versión + CHANGELOG (aborta si no hay nada que publicar)
npm run release

# 2) Compilar el .vsix
npm run package            # genera frida-code-<versión>.vsix

# 3) Crear la GitHub Release y subir el .vsix
gh release create v<versión> frida-code-<versión>.vsix \
  --repo efuentesp/frida-code-vsix \
  --title "<versión>" \
  --notes-file <(awk '/^## \[<versión>\]/{f=1;next}/^## \[/{exit}f' CHANGELOG.md)
```

> El paso 3 toma las notas de la sección `[<versión>]` del `CHANGELOG.md` (lo que
> el script acaba de generar). Sustituye `<versión>` por el número real (p.ej.
> `0.7.0`).

### Checklist del release

- [ ] `main` está limpio y sincronizado.
- [ ] Los commits desde el último release siguen Conventional Commits.
- [ ] `npm run release` hizo el bump y el commit `chore(release):`.
- [ ] `npm run package` generó `frida-code-<versión>.vsix`.
- [ ] `gh release create` subió el `.vsix` a `efuentesp/frida-code-vsix`.
- [ ] Verificar la release en
      <https://github.com/efuentesp/frida-code-vsix/releases/tag/v><versión>.

---

## 5. Dónde vive el número de versión

Únicamente en dos lugares (mantenidos por el script o por ti):

- **`package.json`** → campo `version`.
- **`CHANGELOG.md`** → cabecera `## [X.Y.Z] - <fecha>`.

No hay otras docs que lo dupliquen; si alguna vez lo necesitas en un README u
otra doc, **no lo hardcodees**: referencia `package.json` o el CHANGELOG.
