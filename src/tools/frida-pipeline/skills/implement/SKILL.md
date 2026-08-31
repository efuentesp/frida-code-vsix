---
name: implement
description: Ejecuta un plan de implementación aprobado de .frida/artifacts/plans/ fase por fase, aplicando cambios y verificando cada fase contra sus criterios de éxito antes de continuar. Úsala cuando el usuario invoque /implement, pida "implementar este plan", o quiera ejecutar un plan fase-por-fase existente.
argument-hint: "[plan-path] [Phase N]"
allowed-tools: Read, Edit, Write, Bash(*), Glob, Grep
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: side-effect
    meta:
      effect: code-mutation
  consumes:
    reads:
      plans:
        meta:
          artifactKind: plan
---

# Implement

Ejecuta un plan fase por fase. Aplica cambios al código fuente y verifica cada fase.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Leer plan → 2. Por cada fase: buscar feedback previo → aplicar → verificar → continuar → 3. Reportar

## Pasos

### Paso 1: Leer plan

Lee el plan (`.frida/artifacts/plans/*.md`) completo. Si se especifica `Phase N`, comienza desde esa fase.

### Paso 2: Ejecutar fase por fase

Por cada fase del plan, en orden:

1. **Leer la fase**: archivos a crear/modificar, código, success criteria. Si una fase tiene una elaboración (`.frida/artifacts/elaborations/`), léela y úsala como guía de código.
2. **Buscar feedback de reintentos previos (Obligatorio — rompe la amnesia del ciclo)**:
   - Antes de crear/aplicar cambios, busca en `.frida/artifacts/validation/*.md` el informe MÁS RECIENTE con `verdict: fail` cuya fase corresponda a la fase actual. Cómo reconocerlo: el id de fase NORMALIZADO (sin puntos, guiones ni espacios — p. ej. `F10c.2` → `f10c2`, `F11` → `f11`) aparece en el nombre del archivo.
   - Si existe un informe de fallo para TU fase: **léelo completo**. Ese informe es tu especificación de trabajo — contiene los errores exactos que la validación detectó (tests rojos, compuertas, análisis estático). Los cambios del intento anterior siguen en el árbol de trabajo y AUN ASO la validación falló: tu tarea NO es re-verificar si "ya está hecho", es **corregir exactamente esos errores**.
   - **Prohibido terminar sin cambios** mientras exista un `verdict: fail` abierto para tu fase cuyos errores no hayas abordado uno por uno.
   - Si un error del informe revela que la elaboración/especificación misma es inservible (no un bug de código), escala el reporte con ask_user_question proponiendo re-elaborar esa pieza — NO re-elabores por defecto: el ciclo regresa a implement, no a elaborate.
3. **Crear y aplicar cambios (Obligatorio)**:
   - Revisa la lista de **Archivos nuevos** (código de dominio, fixtures y archivos de test de la fase). Usa `Write` para crearlos TODOS si no existen en disco.
   - Aplica las modificaciones a archivos existentes con `Edit`.
   - **No te detengas ante archivos de test faltantes**: créalos e impleméntalos con `Write` ANTES de correr la verificación.
4. **Verificar**: corre los success criteria de la fase (comandos, tests en Docker, análisis estático PHPStan y Pint). Si hubo informe de fallo previo, verifica ESPECFICAMENTE los puntos que listingban ese informe.
5. **Iterar y corregir**: si algún test falla o hay errores de tipos/lint, usa `Edit` para corregir el código o el test y vuelve a correr la verificación hasta tener la fase en verde (`PASS`). Solo si un error requiere cambiar el diseño de fondo, escala el reporte.

### Paso 3: Reportar

```
Implementación completada:
{N} fases aplicadas, {M} archivos modificados.

**Siguiente paso:** /skill:validate .frida/artifacts/plans/<plan>.md
```

Si se pausó:

```
Implementación pausada en Fase {N}:
<motivo>

Reanudar con: /skill:implement <plan-path> Phase {N}
```

## Notas

- **Verifica antes de continuar**: cada fase debe pasar sus success criteria.
- **Reintentos**: en el ciclo implement↔validate del workflow, cada re-entrada a una fase ES un reintento con errores conocidos (el informe fail más reciente) — nunca una ejecución desde cero.
- **Mismatches código/plan**: surfácealos via ask_user_question, no improvises.
- **Para cambios a nivel plan**: usa /skill:revise.
- **Para pausas de sesión**: usa /skill:create-handoff.
