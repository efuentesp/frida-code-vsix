# How-to: modo goal — deja que el agente trabaje hasta terminar

> Normalmente tú eres el motor: el agente responde UNA corrida por prompt y para, y
> para tareas grandes tienes que estar escribiendo "sigue", "¿qué falta?",
> "continúa con el siguiente" una y otra vez. **`/goal` invierte eso**: defines el
> objetivo una vez y tu propia sesión se auto-continúa hasta terminarlo — con todo
> el contexto acumulado (no sub-agentes amnésicos) y con frenos de seguridad.
>
> Referencia técnica: [docs/tools/frida-goal.md](tools/frida-goal.md) · ADR-0031.

## El modelo en 30 segundos

```text
Tú:        /goal migra los 47 tests de la carpeta X al patrón nuevo y deja la suite verde
Agente:    trabaja turno tras turno (archivos, tests, gates normales)
Frida:     🎯 migra los 47 tests… · 12/25      ← chip del footer, avance en vivo
Agente:    [llama goal_complete] "47/47 migrados, suite verde (1236 pasados)"
Frida:     🎯 complete ✓
```

- **Tu sesión principal**: el loop conserva la memoria completa de la conversación.
- **Todo pasa por tus gates**: cada bash/tool se aprueba con tus reglas de siempre.
- **Tú puedes intervenir en cualquier momento**: tu mensaje interrumpe y redirige.

## Cuándo usarlo (y cuándo no)

**Úsalo para**: trabajo largo y tedioso con criterio de término claro — migraciones
multi-archivo, resolver una lista de issues, generar documentación en serie, limpiar
una baseline de tests.

**No lo uses para**: exploración abierta sin fin definido (usa una conversación
normal) ni análisis de ángulos múltiples (eso es un `workflow` tipo code-review /
adversarial-review — ancho, no profundo).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/goal <objetivo>` | Arranca el goal (el prompt inicial es tu turno) |
| `/goal <objetivo> --tokens 100k` | Con presupuesto máximo de tokens |
| `/goal status` | Estado actual (avance, budget, motivo de pausa) |
| `/goal pause` | Deja de auto-continuarse (el contexto queda) |
| `/goal resume` | Reanuda (limpia contadores de guards) |
| `/goal edit <nuevo objetivo>` | Cambia el objetivo al vuelo |
| `/goal clear` | Descarta el goal |

## Qué verás

- **Chip 🎯 en el footer** junto a los datos de git: azul mientras trabaja
  (`objetivo · N/25`), amarillo si se pausó/bloqueó, verde al completar. El tooltip
  muestra el objetivo completo, tokens y cómo retomarlo.
- **Avisos** en el panel cuando el agente completa (`🎯 Goal completo: …`), se
  bloquea o un guard lo frena.
- El agente **llama tools visibles** `goal_complete` / `goal_blocked` — son su forma
  de señalizar el fin o un impasse real; el runtime los valida (id del goal, 3
  turnos con el mismo blocker, evidencia obligatoria).

## Cómo el agente "sabe" cuándo parar

El prompt del goal instruye al modelo a: no redefinir el éxito a algo más chico,
verificar requisito por requisito con evidencia autoritativa (tests, comandos,
artefactos) antes de completar, y sólo declararse bloqueado tras 3 turnos
consecutivos con el MISMO impedimento y evidencia de que se requiere tu acción.

## Las redes de seguridad

| Guard | Comportamiento |
| --- | --- |
| **25 continuaciones** | Máximo de auto-continuaciones por goal; luego pausa (tus mensajes no cuentan) |
| **No-progreso** | 3 respuestas idénticas sin usar tools → pausa (anti loop tonto) |
| **Budget de tokens** | `--tokens 100k` frena en seco al cruzar el presupuesto |
| **Errores del proveedor** | Abort → pausa · cuota/429 → pausa (resume cuando haya cupo) · error duro → blocked |
| **Tu input** | Cualquier mensaje tuyo esteriliza la continuación pendiente — el usuario manda |

Todas las pausas se retoman con `/goal resume` (o se descartan con `/goal clear`).

## Recetas

```text
/goal resuelve los 8 tests fallidos de la baseline, uno por uno, sin tocar los que pasan
/goal documenta las 5 tools que faltan en docs/tools/ siguiendo la convención del repo
/goal aplica el rename de la API en todos los call-sites y deja typecheck verde --tokens 200k
/goal pasa los 12 TODOs P2 del roadmap a issues de GitHub con cuerpo completo
```

## Límites honestos

- **`goal_wait` no está portado** (esperar un evento externo con deadline — fase 2).
- El cap de 25 y el no-progreso pueden frenar trabajo legítimamente largo:
  `/goal resume` reinicia los contadores y sigue.
- El budget mide tokens de contexto de la sesión (delta desde el arranque del goal),
  no facturación exacta del proveedor.
- El goal vive en la rama de la sesión: si cambias de sesión o navegas forks, cada
  rama recuerda su propio estado (y `complete` no se restaura).
- Los sub-agentes (workflows, Agent) NO tienen modo goal — sólo la sesión principal.
