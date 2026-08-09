# Seguimiento upstream pi

> **Feature:** [issue #11](https://github.com/efuentesp/frida-code-vsix/issues/11) ·
> **Relacionado:** [issue #10](https://github.com/efuentesp/frida-code-vsix/issues/10) (gate de typecheck)

Frida es una capa sobre [`pi`](https://github.com/earendil-works/pi) y ports de
extensiones del ecosistema pi. Este sistema lleva un **ledger de proveniencia**
(qué versión de pi generó cada parte de Frida), detecta el **drift** contra lo
instalado/publicado, y ayuda a **evaluar** qué cambios de pi conviene portar.

## Uso rápido

```bash
npm run upstream:drift                 # reporte en texto (humano)
npm run -s upstream:drift -- --json    # JSON (silent para que npm no ensucie)
node scripts/upstream-drift.mjs --json # JSON directo (lo que usa CI)
```

Flags: `--no-registry` (sólo lockfile/node_modules, sin llamadas a npm),
`--json` (salida machine).

## El ledger `upstream-pi.json`

Source of truth (repo root). Cada entrada:

```jsonc
{
  "wrapper": "src/tools/frida-mcp-adapter",  // parte de Frida
  "upstream": "pi-mcp-adapter",              // paquete pi del que proviene
  "kind": "runtime",   // runtime (instalada en lockfile) | port (reimplementada) | reference (original)
  "mode": "delegate",  // delegate (envuelve pi) | fork (lógica propia) | platform
  "basedOn": "2.17.0", // versión con la que se generó/sincronizó → drift = actual − basedOn
  "repo": "...",
  "fridaAdditions": "..."
}
```

El campo **`mode`** decide el triage: `delegate` → cambio heredado gratis
(bump + re-test); `fork` → hay que portar a mano. `kind` decide de dónde sale
la versión "actual": `runtime`/`platform` del lockfile, `port` del npm registry.

`platform` (@earendil-works/pi-coding-agent) es la base de TODO Frida: su drift
afecta al host y a los 16 wrappers.

## Cómo actualizar el ledger al hacer un sync

Cuando portes un cambio de pi (o actualices una dep runtime):

1. `npm run upstream:drift` → revisa las entradas con `⚠ drift`.
2. Para cada cambio: decide **port** / **bump** / **defer** / **skip**.
3. Tras incorporar (o decidir saltar), actualiza `basedOn` a la nueva versión y
   `lastSync` a hoy en la entrada correspondiente de `upstream-pi.json`.
4. Vuelve a correr `upstream:drift` → debe quedar `✓ synced`.

## Estado inicial (clean-slate, 2026-08-09)

- **1 plataforma** + **1 runtime** (pi-coding-agent 0.81.1, pi-mcp-adapter 2.17.0)
- **5 ports conceptuales** (subagents, extensible-workflows, supi-web,
  agent-browser, permission-system — reimplementados, no instalados)
- **7 utilidades originales** (`reference`, sin upstream directo)

Los `fridaAdditions` de los ports y los mapeos `reference` se refinan en
auditoría manual (enfoque híbrido acordado en el issue #11).
