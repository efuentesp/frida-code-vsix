# Research: microsoft/tgrep — grep con índice de trigramas para monorepos

> Fecha: 2026-09-08 · Contexto: análisis de aplicabilidad a Frida.
> Fuente: [microsoft/tgrep](https://github.com/microsoft/tgrep) · [BENCHMARKS.md](https://github.com/microsoft/tgrep/blob/main/BENCHMARKS.md) · integración declarada con [Copilot CLI](https://github.com/github/copilot-cli)

## TL;DR

tgrep es **grep con índice de trigramas + servidor** (Rust, MIT, Microsoft) que
acelera búsquedas regex en repos grandes **3.4–52x sobre ripgrep** (gecko-dev
388K archivos: 33.4s → 0.64s). Ya alimenta el grep de Copilot CLI en
producción. El punto de integración natural en frida: **el tool `grep` de pi
spawnea ripgrep por query** (verificado en el SDK: `spawn(rgPath, …)`) — cada
grep del agente re-escanea el repo. En los monorepos Java cliente de Softtek
(el mismo perfil del benchmark de Spotify/shunt), la latencia suma por turno.

## Lo que importa de su arquitectura

- `tgrep serve .`: servidor TCP (JSON-RPC 2.0 ndjson) con watcher de archivos
  - reconciliación horaria → índice siempre fresco. Sirve queries MIENTRAS
  construye el índice en background. Memoria acotada (merge externo: ~160 MiB
  pico en el kernel Linux).
- `tgrep "patrón" .`: auto-conecta al server si corre; si no, índice local.
- **CLI compatible con ripgrep** y `--json` ripgrep-compatible → drop-in.
- Binarios pre-compilados (Linux/macOS/Windows) + brew + cargo. MIT.

## Mapeo a frida

| Pieza actual | Rol | tgrep |
| --- | --- | --- |
| tool `grep` de pi | ripgrep por query (O(bytes) por búsqueda) | ⭐ Override directo, mismo output, 3-52x |
| `ffgrep` (pi-lens) | BM25 de identificadores (ranking, no regex) | Complementario |
| frida-codebase-index (#25) | Semántica (embeddings + call graph) | Problema distinto |
| frida-shunt (#202) | Escalera lectura→búsqueda | **Sinergia**: grep instantáneo hace el peldaño 1 más barato |

**Nivel**: puramente Frida/client-side (índice y búsqueda locales; el gateway
no ve paths ni puede indexar por máquina — sin ambigüedad frida vs devengine).

## Diseño propuesto (frida-tgrep)

1. **Fase 1 — Núcleo**: binario pineado (patrón scc de frida-size-app:
   release por plataforma, sha256, descarga al agentDir); ciclo de vida del
   server (spawn `tgrep serve .` en la primera búsqueda, índice bajo
   `workspace/.frida/tgrep/`, `--max-cpu 50`, kill al dispose); **override del
   tool `grep`** con el mismo schema → `tgrep --json` con **fallback
   transparente a ripgrep** si no hay binario/server. Settings
   `frida.tgrep.enabled` + `frida.tgrep.minFiles` (default ~10 000: en repos
   chicos ripgrep es instantáneo y el índice es overhead puro).
2. **Fase 2 — Sinergias**: reason del shunt menciona tgrep cuando activo;
   redirect de `rg`/`grep` en bash; latencia por grep en session-stats (hoy
   invisible).
3. **Fase 3 — Benchmark**: metodología de BENCHMARKS.md sobre un monorepo
   cliente real + latencia de greps en sesiones before/after.

## Límites honestos

- Repos chicos/medianos: no se nota (por eso `minFiles` + fallback).
- Queries con decenas de miles de matches: el delivery domina, no el índice.
- Consistencia de banderas index/serve (`--exclude`, `--max-filesize`) —
  frida debe gestionarlas desde un solo lugar.
- Enlistments sin `.git` (Perforce — común en cliente): `--no-require-git`
  explícito.
- Una dependencia binaria más (~MB) — patrón ya aceptado con scc.

## Prioridad

**P2/P3 frontera, después de F10/#191**: valor alto CONDICIONADO al contexto
de uso (monorepos cliente = sí; repos medianos = invisible). Complementa la
dupla de facturación: búsqueda rápida → menos lecturas completas → menos
tokens (mismo argumento que shunt).
