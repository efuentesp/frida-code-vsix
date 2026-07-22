# Descubrimiento de recursos del agente: abierto

**Estado:** aceptado.

El agente embebido de Pi carga **extensiones, skills y `AGENTS.md`** globales y de
proyecto como lo haría `pi` vainilla (descubrimiento por defecto de
`DefaultResourceLoader`). **No** usamos un `ResourceLoader` cerrado que cargue
únicamente nuestras piezas.

## Razón

Es coherente con el alcance (b) (ADR-0001): un desarrollador decidido evade igual,
así que cerrar el descubrimiento sólo añadiría fricción sin aportar un candado real.
La exclusividad se conserva como **default**: nuestro proveedor y modelo se fuerzan
explícitamente al crear la sesión (no se confía en "primer modelo disponible").

## Opciones consideradas

- **(i) Cerrada total:** cargar solo nuestras dos piezas (proveedor + gates) y
  desactivar todo el descubrimiento global/proyecto.
- **(ii) Cerrada para código, abierta para texto:** desactivar extensiones (ejecutan
  código y pueden registrar otros proveedores) y skills, pero permitir `AGENTS.md`.
- **(iii) Abierta.** Elegida.

## Consecuencias (registradas y asumidas)

- La propiedad **"proveedor exclusivo / modelo único" es un default, no un candado**:
  un dev puede, en un paso y desde dentro de la propia herramienta, registrar otro
  proveedor/modelo (vía una extensión de Pi).
- Ese tráfico **no pasa por el router** y por tanto **no se audita**.
- La fricción "dentro de la herramienta" se reduce: la frase "lo incorrecto requiere
  esfuerzo consciente" (§2) queda matizada.

Si el scope migra a perímetro (ADR-0001), reabrir esta decisión hacia (i)/(ii).
