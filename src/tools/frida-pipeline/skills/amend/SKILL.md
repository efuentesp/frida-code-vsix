---
name: amend
description: Arregla quirúrgicamente UN artefacto (research, plan, o cualquier doc) para limpiar las dimensiones fallidas que un panel de grade marcó — lee el artefacto más sus veredictos de dimensión, aplica sólo el feedback de los findings citados, y re-emite el artefacto in-place. Pasada única, sin subagentes, sin self-review, sin preguntas. El reviser generalizado parametrizado por flags.
argument-hint: "--<channel> <artifact-path> --<channel>-verdicts <verdict-path> [--<channel>-verdicts <verdict-path> ...]"
allowed-tools: Read, Edit, Write, Grep, Glob
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
---

# Amend

Arregla un artefacto basado en veredictos de grade. Estado revise del gate — no standalone.

## Flujo

1. Leer artefacto + veredictos → 2. Identificar findings → 3. Aplicar arreglos → 4. Re emitir

## Pasos

### Paso 1: Leer artefacto + veredictos

Lee el artefacto a arreglar. Lee TODOS los veredictos de dimensión (`--<channel>-verdicts`).

### Paso 2: Identificar findings

Por cada veredicto con `pass: false`:

- Extrae los `findings` con sus `severity` y `message`.
- Filtra sólo los `high` y `medium` (los `low` son opcionales).

### Paso 3: Aplicar arreglos

Edita el artefacto in-place para limpiar cada finding:

- **Finding de completitud**: añade la sección/fase/archivo que falta.
- **Finding de consistencia**: unifica la interface/contract conflictiva.
- **Finding de calidad**: reescribe la sección problemática.

Aplica SÓLO el feedback citado — no reescribas secciones que no fueron marcadas.

### Paso 4: Re-emitir

Usa Edit para modificar el artefacto existente. No crees un archivo nuevo.

## Notas

- **Quirúrgico**: sólo arregla los findings citados, nada más.
- **Sin self-review**: no te auto-califiques después de arreglar.
- **El workflow lo vuelve a calificar**: después de amend, el panel de grade re-corre.
- **Generalizado**: funciona con cualquier canal (research, plan, design, etc.).
