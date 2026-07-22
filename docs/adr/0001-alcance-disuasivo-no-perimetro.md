# Alcance = disuasivo, no perímetro de seguridad

**Estado:** aceptado.

La empresa prohibió OpenCode por riesgo de fuga de datos y quiere una extensión
tipo Claude Code sobre su router interno. Decidimos entregar el proyecto bajo el
**alcance (b): UX + centralización + auditoría + disuasivo**, **no** como un
control de seguridad.

La razón es de fondo: sin un control de egress de red (allowlist/proxy/VPN), ninguna
extensión de cliente puede prevenir la fuga deliberada — un desarrollador la evita
trivialmente con `curl`, el navegador, Postman u otra herramienta apuntada a un
modelo gratuito. Pretender lo contrario sería un fraude de seguridad. La prevención
dura queda como un **prerrequisito de red** separado, pendiente de implementar y de
plantear a seguridad.

## Opciones consideradas

- **(a) Pretender ser perímetro.** Rechazada: promete una garantía que no se puede
  cumplir a nivel de cliente; peor postura que ser honesto.
- **(b) Disuasivo + UX + auditoría + centralización.** Elegida: hace lo correcto
  fácil/por defecto, centraliza el uso sancionado en el router (facturación +
  auditoría) y deja la fricción del lado de la evasión.

## Consecuencias

- Toda documentación interna debe declarar que la herramienta **no previene la fuga
  deliberada**.
- Propiedades como "proveedor exclusivo" se interpretan como *default*, no como
  candado (ver ADR-0005).
- Si el scope migra a perímetro real, se reabren varias decisiones (fork en
  ADR-0004, descubrimiento cerrado en ADR-0005).
