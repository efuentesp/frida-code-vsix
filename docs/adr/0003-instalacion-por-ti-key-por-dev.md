# Instalación por TI, API key por desarrollador

**Estado:** aceptado.

**TI instala el `.vsix`** (el enforcement es de capa OS/MDM: devs no-admin o bloqueo
de sideloading de extensiones por política, **no** dentro de la extensión). **El
desarrollador entra su propia API key** en el onboarding y la rota self-service
(paleta de comandos, o automáticamente al detectar un 401).

## Razón

Cada key = **atribución de auditoría por desarrollador**. Si TI conociera o entrara
las keys individuales, se rompería esa atribución. Separar "quién instala" (TI) de
"quién se autentica" (dev) preserva la trazabilidad en el router.

## Opciones consideradas

- **TI instala y entra las keys.** Rechazada: pierde la atribución individual y
  traslada un secreto de dev a TI.
- **Marketplace público de VS Code.** Depende de si el marketplace de Microsoft está
  permitido en las máquinas de los devs; queda como migración futura (marketplace
  privado corporativo o OpenVSX interno).

## Consecuencias

- La rotación de key es self-service del dev; TI no participa.
- El requisito "solo TI instala" **depende** de que las máquinas sean gestionadas
  (no-admin) — hecho interno de la empresa aún por confirmar (`CONTEXT.md`, hecho a
  verificar #6).
