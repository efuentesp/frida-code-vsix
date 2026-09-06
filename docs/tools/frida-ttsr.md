# frida-ttsr — TTSR: reglas de stream

> **TTSR** (#201, Fase 12 del [roadmap UI/UX](../../.rpiv/artifacts/plans/2026-08-19_ui-ux-copilot-roadmap.md)):
> reglas de proyecto que **duermen hasta que el modelo las viola**. TTSR
> monitorea el stream del asistente en vivo; ante una violación, interrumpe la
> emisión a mitad, inyecta el recordatorio como mensaje y reintenta desde el
> mismo punto. **Cero impuesto de contexto por turno**: la regla no ocupa
> tokens hasta que hace falta.

- Referencia rápida: settings `frida.ttsr.*` · diagnóstico: canal **Frida
  Abort** (prefijo `[ttsr]`) y `~/.frida/logs/abort.log`.

## Cómo funciona

```text
message_update (delta del stream)
  → extractScopes(partial)          texto acumulado / thinking / toolargs
  → matchRule (regex anyOf + allOf)  por regla builtin
  → manager.shouldIntervene          guards anti-bucle (ver abajo)
  → session.abort()                  el parcial muere (cadena curada en #2)
  → session.steer(recordatorio)      encola el recordatorio
  → session.agent.continue()         drena el steering → reintento
```

El `partial` del evento trae el contenido **acumulado**, así que no hay
problema de fronteras de chunk (una violación partida en dos deltas se pesca
igual). El escaneo se acota a la ventana reciente del mensaje (16 KB) para
mantener el handler barato por token.

El parcial abortado queda en contexto (`contextMode: "keep"` en V1): el
recordatorio llega justo después y corrige el rumbo. Descartarlo del
transcript (modo `discard`) queda para V2.

## Reglas builtin

| Id | Scope | Qué pesca | Recordatorio |
| --- | --- | --- | --- |
| `es-mx` | text | Modismos/conjugaciones de España (2ª persona plural, *ordenador*, *vídeo*…) | Español de México, tú/usted |
| `refs-not-closes` | text + toolargs | `Closes/Fixes/Resolves #N` en texto o en el `message` de commit | `Refs #N` (política del repo: el cierre lo hace `gh issue close`) |
| `vscode-tokens-ui` | toolargs (allOf) | Color hex/rgba **Y** path de webview/css/tsx en la misma llamada | Tokens `var(--vscode-*)` con fallback |

Sin `\b` en `refs-not-closes` a propósito: el JSON de los toolargs suele traer
`\n` literal antes de la palabra y la "n" del escape rompe el word-boundary.

Los reminders están escritos para **no auto-matchearse** (hay test de
regresión): si citaran el patrón prohibido, el modelo podría repetirlo al
contestar y re-disparar la regla.

## Guards anti-bucle (`manager.ts`)

El riesgo estructural de TTSR es abortar → reinyectar → que el modelo vuelva a
violizar → loop. Cuatro guards:

1. **`intervening`**: tras disparar, todo se ignora hasta el `agent_start`
   siguiente — los deltas del stream moribundo no re-disparan.
2. **Tope por regla por cadena**: default 2 (`repeatMode: "cooldown"`), 1 si
   `repeatMode: "once"`.
3. **Cooldown** por regla (30 s es-mx, 15 s refs) entre intervenciones.
4. **Tope duro por cadena** (todas las reglas sumadas: 4) — corta cascadas.

Una **cadena** arranca con cada prompt nuevo del usuario y resetea contadores.

## Settings

- `frida.ttsr.enabled` (default `true`) — master switch; con `false` el
  handler es no-op barato.
- `frida.ttsr.disabledRules` (default `[]`) — ids builtin a desactivar, p. ej.
  `["vscode-tokens-ui"]`.

Ambos aplican en vivo (se releen en cada evento).

## Diagnóstico

Todo cae al canal **Frida Abort** (Output panel) y a `~/.frida/logs/abort.log`
con prefijo `[ttsr]` — una sola línea de tiempo al depurar interacciones
entre aborts de usuario y aborts de TTSR:

```text
[ttsr] VIOLACIÓN rule=refs-not-closes scope=toolargs match="Closes #123" → abort + steer + continue (…)
[ttsr] abort() OK
[ttsr] steer(reminder) OK
[ttsr] continue() OK — reintento con recordatorio
```

Además, cada intervención notifica al transcript: `🛡️ TTSR: … — stream
interumpido, recordatorio inyectado.`

## Relación con el clúster de abort (#2)

TTSR usa `session.abort()` — la misma cadena que #2 endureció (gate temprano +
TTL deslizante). La lección aplicada: **si `abort()` falla, TTSR NO inyecta ni
reintenta** (sin abort limpio no hay reintento confiable); lo registra y deja
correr el turno. F12 fue bloqueada exactamente por esto hasta el fix de #2.

## Fuera de alcance V1

- `astCondition` (ast-grep vía pi-lens) — regex cubre las builtins actuales.
- `contextMode: "discard"` del parcial abortado.
- Tarjeta ámbar dedicada en Turn.tsx y gestión de reglas en Settings (V1 usa
  info-bar).
- Reglas custom del usuario en archivo (V1: builtins + toggles).

## Arquitectura

| Módulo | Rol |
| --- | --- |
| `src/ttsr/rules.ts` | Puro: modelo + builtins + matching (ventana 16 KB, regex compiladas cacheadas, fuentes inválidas se saltan). |
| `src/ttsr/manager.ts` | Puro (clock inyectable): guards anti-bucle y contadores por cadena. |
| `src/ttsr/coordinator.ts` | Orquesta abort→steer→continue con fallback `followUp`; sesión defensiva (todo opcional). |
| `extension.ts` | `wireSession` pasa todos los eventos; `submit` marca cadena nueva; settings en vivo. |
