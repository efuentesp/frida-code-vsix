---
name: pr-triage
description: "Triage un pull request de GitHub antes de comprometer esfuerzo de revisión — obtiene el hilo del PR (descripción, comentarios, issues vinculados, CI), evalúa el diff contra la arquitectura/estándares del repo, y emite una disposición (Revisar · Solicitar cambios · Retener · Rechazar) con tier de seguridad y drift de convenciones. Produce documentos de triage en .frida/artifacts/triage/. Read-only — nunca hace checkout ni muta el árbol."
argument-hint: "[número de PR | URL de PR | vacío = branch actual]"
shell-timeout: 15
contract:
  produces:
    kind: produces
    meta:
      artifactKind: triage
    data:
      type: object
      required: [security_flag, blockers_count]
      properties:
        status:
          enum: [in-progress, ready]
        security_flag:
          type: integer
          minimum: 0
          maximum: 2
        blockers_count:
          type: integer
          minimum: 0
---

# PR Triage

Triage un PR antes de revisarlo. Evalúa el diff, el CI, y la alineación con los estándares del repo.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Obtener PR → 2. Evaluar diff → 3. Verificar CI → 4. Triage → 5. Escribir

## Pasos

### Paso 1: Obtener PR

- **Número/URL**: usa `gh pr view <n>` para obtener descripción, comentarios, issues vinculados.
- **Vacío (branch actual)**: usa `gh pr view` para el PR del branch actual.
- Si no hay `gh` o no hay PR: usa `git log` y `git diff main...HEAD`.

### Paso 2: Evaluar diff

Lee el diff completo. Evalúa contra:

- **ADR-0001**: ¿respeta el alcance disuasivo?
- **ADR-0005**: ¿añade dependencias npm no listadas?
- **Convención AGENTS.md**: ¿comentarios/mensajes en español?
- **Estándares de Frida**: ¿usa el patrón de porte nativo (factory, hooks)?

### Paso 3: Verificar CI

Si hay CI: lee el estado de los checks (`gh pr checks`). Reporta pass/fail.

### Paso 4: Triage

Emite una disposición:
- **Revisar**: PR es seguro y alineado — procede con review detallada.
- **Solicitar cambios**: hay issues que el autor debe arreglar primero.
- **Retener**: faltan checks de CI o contexto — esperar.
- **Rechazar**: scope fuera del perímetro o cambios destructivos.

Clasifica:
- `security_flag`: 0 (ninguno) / 1 (precaución) / 2 (riesgo alto).
- `blockers_count`: número de issues bloqueantes.

### Paso 5: Escribir

Filename: `.frida/artifacts/triage/<slug>_pr-<n>.md`. Frontmatter `status: ready`.

## Notas

- **Read-only**: nunca hace checkout ni muta el árbol.
- **Stack-agnostic**: funciona en cualquier lenguaje/framework.
- **Sin architecture docs**: el triage funciona igual — evalúa lo que el repo lleva.
