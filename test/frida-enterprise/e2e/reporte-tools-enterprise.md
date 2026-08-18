# Reporte E2E tools × 4 modelo(s) (reasoning: high)

Modelos: DEMETER-BLOOM, TITAN-CROWN, MIDAS-GOLD, model-router
Fecha: 2026-08-18T06:11:28.991Z · endpoint: /v1/responses · adapter openai-responses

## Resumen

- **DEMETER-BLOOM**: Nivel A **7/7** · Nivel B **14/14**
- **TITAN-CROWN**: Nivel A **7/7** · Nivel B **14/14**
- **MIDAS-GOLD**: Nivel A **7/7** · Nivel B **14/14**
- **model-router**: Nivel A **7/7** · Nivel B **14/14**

## DEMETER-BLOOM

| Nivel | Tool | Resultado | Fase | Detalle | ms |
|---|---|---|---|---|---|
| A | read | ✅ | — | thinking=197chr · 2 hops · ok | 5180 |
| A | write | ✅ | — | thinking=262chr · 2 hops · ok | 5485 |
| A | edit | ✅ | — | thinking=235chr · 3 hops · ok | 7356 |
| A | bash | ✅ | — | thinking=198chr · 2 hops · ok | 4794 |
| A | grep | ✅ | — | thinking=227chr · 2 hops · ok | 5267 |
| A | find | ✅ | — | thinking=214chr · 2 hops · ok | 5677 |
| A | ls | ✅ | — | thinking=210chr · 2 hops · ok | 4900 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Configuración de Tests","question":"¿Qué framework de testing prefieres usa | 8388 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 4379 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React"} | 4017 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 2681 |
| B | agent_browser | ✅ | — | args ok: {"url":"https://example.com"} | 2866 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;"} | 2647 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 3134 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 2885 |
| B | Agent | ✅ | — | args ok: {"subagent_type":"task","description":"Investigar y determinar la versión de TypeScript utilizada en | 10621 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release"} | 2746 |
| B | sandbox_create | ✅ | — | args ok: {"image":"python:3.12-slim","name":"python-sandbox","workdir":"/workspace"} | 4297 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 3036 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 3169 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 3043 |

## TITAN-CROWN

| Nivel | Tool | Resultado | Fase | Detalle | ms |
|---|---|---|---|---|---|
| A | read | ✅ | — | thinking=414chr · 2 hops · ok | 9872 |
| A | write | ✅ | — | thinking=453chr · 2 hops · ok | 7606 |
| A | edit | ✅ | — | thinking=2452chr · 3 hops · ok | 32739 |
| A | bash | ✅ | — | thinking=435chr · 2 hops · ok | 5457 |
| A | grep | ✅ | — | thinking=431chr · 2 hops · ok | 12343 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 5828 |
| A | ls | ✅ | — | thinking=932chr · 2 hops · ok | 14902 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de pruebas","question":"¿Qué framework prefieres usar para los te | 23812 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 14222 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React"} | 5348 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 13955 |
| B | agent_browser | ✅ | — | args ok: {"url":"https://example.com"} | 5689 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"(() => 42)()","description":"Inline script that returns 42"} | 12393 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 4730 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 4138 |
| B | Agent | ✅ | — | args ok: {"prompt":"Objetivo: Averiguar con precisión qué versión de TypeScript usa este repositorio.\n\nCont | 48517 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":20} | 23859 |
| B | sandbox_create | ✅ | — | args ok: {"name":"py312-slim-sandbox","image":"python:3.12-slim","workdir":"/workspace"} | 23128 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 2965 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 8080 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 10135 |

## MIDAS-GOLD

| Nivel | Tool | Resultado | Fase | Detalle | ms |
|---|---|---|---|---|---|
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 5970 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 4754 |
| A | edit | ✅ | — | thinking=407chr · 3 hops · ok | 11984 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 3303 |
| A | grep | ✅ | — | thinking=420chr · 2 hops · ok | 5988 |
| A | find | ✅ | — | thinking=399chr · 2 hops · ok | 4576 |
| A | ls | ✅ | — | thinking=415chr · 2 hops · ok | 5250 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"question":"¿Qué framework de tests prefieres usar en este proyecto?","header":"Elecc | 6897 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","description":"Tarea creada a petición de | 2398 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":1200} | 3037 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 3745 |
| B | agent_browser | ✅ | — | args ok: {"url":"https://example.com"} | 2120 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;","description":"Simple workflow that returns the number 42"} | 3401 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 3209 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 1823 |
| B | Agent | ✅ | — | args ok: {"prompt":"Estás en el contexto de un repositorio de código (por ejemplo, en un entorno de desarroll | 34323 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 3346 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python-3-12-slim-sandbox","image":"python:3.12-slim","workdir":"/workspace"} | 4541 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 3114 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 1964 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 11046 |

## model-router

| Nivel | Tool | Resultado | Fase | Detalle | ms |
|---|---|---|---|---|---|
| A | read | ✅ | — | thinking=149chr · 2 hops · ok | 4869 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 4373 |
| A | edit | ✅ | — | thinking=0chr · 2 hops · ok | 4246 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 5869 |
| A | grep | ✅ | — | thinking=211chr · 2 hops · ok | 4024 |
| A | find | ✅ | — | thinking=447chr · 2 hops · ok | 3746 |
| A | ls | ✅ | — | thinking=202chr · 2 hops · ok | 5197 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Configuración de testing","question":"¿Qué framework de testing prefieres p | 3948 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 2286 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React"} | 1751 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 4400 |
| B | agent_browser | ✅ | — | args ok: {"url":"https://example.com"} | 2651 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;"} | 2277 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 3028 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 3546 |
| B | Agent | ✅ | — | args ok: {"description":"Analista de repos TypeScript","subagent_type":"Docker","prompt":"Tu tarea es averigu | 5839 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release"} | 2737 |
| B | sandbox_create | ✅ | — | args ok: {"image":"python:3.12-slim"} | 3264 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 2561 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 2248 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 1672 |

## Prompts usados (idénticos para cada modelo)

- **read**: Lee el archivo poema.txt (usa la herramienta read) y dime EXACTAMENTE cuál es el PIN secreto que aparece en él.
- **write**: Crea el archivo resumen.txt (usa la herramienta write) con el contenido exacto: HOLA-FRIDA-E2E
- **edit**: En config.txt cambia la línea color=rojo para que diga color=azul (usa la herramienta edit con SEARCH/REPLACE en edits).
- **bash**: Ejecuta con la herramienta bash el comando: echo $((6*7)) y dime el resultado numérico.
- **grep**: Con la herramienta grep busca el patrón 'aguacate' en este directorio y dime en QUÉ archivo aparece.
- **find**: Con la herramienta find localiza el archivo que se llama tesoro.txt (está en un subdirectorio) y dime su ruta.
- **ls**: Con la herramienta ls lista el contenido del directorio actual y dime los nombres de los archivos .md que ves.
- **ask_user_question**: Quiero añadir tests a este proyecto. Antes de empezar, PREGÚNTAME con la herramienta ask_user_question qué framework prefiero (vitest o jest) y si quiero cobertura de errores.
- **todo**: Registra en la lista de tareas (herramienta todo) una tarea nueva: 'Investigar el bug del login' con estado pending.
- **context**: Consulta el contexto Frida (herramienta context) sobre 'componentes de tabla React' para este proyecto.
- **read_skills**: Busca con la herramienta read_skills skills remotas sobre 'commit messages'.
- **agent_browser**: Con la herramienta agent_browser abre https://example.com y dime el título de la página.
- **workflow**: Lanza un workflow (herramienta workflow) llamado 'probe' con script inline que retorne 42.
- **get_subagent_result**: Consulta con get_subagent_result el resultado del agente agent-123 (sin esperar).
- **steer_subagent**: Envía con steer_subagent el mensaje 'prioriza los tests' al agente agent-123.
- **Agent**: Delega a un sub-agente especializado la tarea de averiguar qué versión de TypeScript usa este repo.
- **kb_search**: Busca en la base de conocimiento del equipo notas sobre 'pipeline de release'.
- **sandbox_create**: Necesito un entorno desechable y aislado con la imagen python:3.12-slim para probar un script sin tocar mi máquina.
- **sandbox_exec**: En el sandbox sbx-1 corre el comando 'python --version' y dime la salida.
- **workflow_catalog**: Muéstrame el catálogo de flujos de trabajo predefinidos que puedo correr en este proyecto.
- **goal_complete**: El objetivo goal-42 ya quedó logrado: registra el resumen 'migración completada sin regresiones'.