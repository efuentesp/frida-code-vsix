# SDK de Pi embebido en-proceso, no subproceso RPC

**Estado:** aceptado (reabierto y reafirmado tras verificar que Pi tiene dependencias
nativas).

Importamos `@earendil-works/pi-coding-agent` en el extension host y corremos la
sesión de Pi en el **mismo proceso**; los eventos fluyen al webview por `postMessage`.
Las factories del proveedor (router) y de los gates de aprobación viven como
extensiones inline de Pi en ese proceso.

## Razón principal

Los **gates de aprobación son dramáticamente más limpios en-proceso**: el evento
`tool_call` de Pi bloquea la ejecución (`return { block: true, reason }`) en el mismo
proceso, y el handler llama directo al bridge del webview. Por RPC, cada
Accept/Reject sería un viaje de ida/vuelta por stdio (JSON).

## Opción considerada

- **RPC (`pi --mode rpc`).** Descartada **no** porque "obligue a empaquetar un
  binario" — **ambas** opciones empaquetan algo:
  - en-proceso bundelea nativos (`photon-node` `.wasm` + `clipboard-*` `.node` por
    plataforma) y debe casar el **ABI de Electron** del extension host;
  - RPC shipea un binario precompilado por plataforma.

  Se descartó porque enrutar los gates por stdio añade plomería sin aportar el
  aislamiento de proceso que el alcance (b) (ADR-0001) necesite.

## Consecuencias

- Tarea concreta del MVP: empaquetar los nativos de Pi en el `.vsix` por plataforma
  (`@vscode/vsce` + target platforms; chore trillado, no riesgo arquitectural).
- Puntos frágiles a regresar en cada bump de Pi: el gate `tool_call`, el
  `registerProvider` y el empaquetado de nativos (ver proceso de mantenimiento en
  `CONTEXT.md`, decisión D12).
