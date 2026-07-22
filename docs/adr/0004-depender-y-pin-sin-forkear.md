# Depender de Pi vía npm + pin, no forkear

**Estado:** aceptado.

Consumimos Pi (`@earendil-works/pi-coding-agent`) como **dependencia npm con pin
exacto**, sin forkear. La exclusividad del proveedor se obtiene a nivel UX/config
(proveedor hardcoded en código), no con un fork.

## Razón

Bajo el alcance (b) (ADR-0001), el fork **no aporta valor**: un desarrollador puede
correr `pi` vainilla igual. Depender + pin **hereda parches de seguridad upstream**,
lo que es mejor postura de seguridad que un fork estancado que hay que mantener a
mano.

## Trigger de fork futuro

Solo si se cumple alguna de estas:

- El scope migra de disuasivo a **perímetro** (p. ej. seguridad exige arrancar los
  caminos de otros proveedores a nivel código).
- Se necesita un cambio que Pi **no acepte upstream**.

## Consecuencias

- Como el update-check está apagado (D11), el bump es **manual en CI** y lo sostiene
  PSG (D12). Sin dueño activo, la promesa de "heredar parches" se vacía y el pin se
  estanca.
- La dependencia requerirá *security/license review* interna (Pi es MIT).
