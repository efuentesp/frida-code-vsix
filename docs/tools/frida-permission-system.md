# frida-permission-system

> **Estado:** <!-- TODO --> · [ADR-0001](../adr/0001-alcance-disuasivo-no-perimetro.md) · [ADR-0016](../adr/)

Sistema de permisos y **gates de aprobación**: intercepta las acciones del agente
(`bash`, `edit`, `write`) antes de ejecutarlas y pide visto bueno, con patrones
sensibles/destructivos bloqueados por defecto.

> **Stub.** Este documento sigue la [plantilla](./TEMPLATE.md) con lo esencial
> lleno; las secciones de API están marcadas `<!-- TODO -->` para detallar.

## ¿Qué es?

El componente que materializa el **perímetro disuasivo** de Frida (ver
[ADR-0001](../adr/0001-alcance-disuasivo-no-perimetro.md)). Consta de:

- Un **`ApprovalBridge`** compartido (webview ↔ host) por donde pasan los gates del
  chat principal **y** de las sesiones hijas (p.ej. las de frida-workflow).
- **Modos** de aprobación: `manual` / `auto-edit` / `auto`.
- **Patrones** sensibles (`.env`, `.pem`, …) y destructivos (`rm -rf /`, …) que se
  bloquean sin preguntar.
- Un **trail JSONL** append-only (`chmod 0600`) que alimenta la auditoría `/gates`.

## ¿Cuándo usarla?

<!-- TODO: casos reales. Y "cuándo NO" (auto en entorno desechable). -->

## Uso

- **Botón de modo** del panel, o **Frida: Cambiar modo de aprobación** → conmuta
  `manual` / `auto-edit` / `auto`.
- **`/gates`** → auditoría navegable (overlay) del historial de aprobaciones.
- **Configuración → Auto-Aprobación** (engrane ⚙ del webview) → editor visual de
  la política: tri-states por tool, patrones path/bash, límite del workspace,
  patrones aprobados por sesión (revocables) y toggle de auditoría (#55;
  reemplazó al overlay `/gates-config`, retirado).
- Settings `frida.gates.*` (extensiones/nombres sensibles, substrings peligrosos) —
  aplican **en vivo**, sin recargar.

## API / DSL

<!-- TODO: la API interna del sistema de permisos: cómo se construye el
     ApprovalBridge, cómo se registran los provider hooks (before_*, tool_call),
     cómo se definen categorías de gate (free/diff/always), y el formato del
     JSONL de auditoría. -->

## Configuración

| Clave | Default | Descripción |
| --- | --- | --- |
| `frida.gates.sensitiveExtensions` | `[]` | Extensiones extra bloqueadas (sin el punto). En vivo. |
| `frida.gates.sensitiveBasenames` | `[]` | Nombres exactos extra bloqueados. En vivo. |
| `frida.gates.sensitiveAllowBasenames` | `[]` | Nombres a permitir pese a patrón sensible. En vivo. |
| `frida.gates.dangerousCommandSubstrings` | `[]` | Substrings que bloquean `bash`. En vivo. |

## Integración con Frida

- **`ApprovalBridge`** compartido: las sesiones hijas (frida-workflow) lo reusan →
  un solo puente para todas las aprobaciones.
- El JSONL de aprobaciones vive en `globalStorageUri` (junto a las sesiones).

## Ver también

- [README §Gates de aprobación](../../README.md#gates-de-aprobación)
- [ADR-0001](../adr/0001-alcance-disuasivo-no-perimetro.md) — el gate es disuasivo.

## Estado y madurez

<!-- TODO: qué modos están listos, qué patrones cubren, qué falta. -->
