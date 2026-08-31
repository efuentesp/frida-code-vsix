# Reporte E2E tools × 4 modelo(s) (reasoning: high)

Modelos: DEMETER-BLOOM, TITAN-CROWN, MIDAS-GOLD, model-router
Fecha: 2026-08-29T16:58:18.072Z · endpoint: /v1/responses · adapter openai-responses

## Resumen

- **DEMETER-BLOOM**: Nivel A **7/7** · Nivel B **14/14**
- **TITAN-CROWN**: Nivel A **7/7** · Nivel B **14/14**
- **MIDAS-GOLD**: Nivel A **7/7** · Nivel B **14/14**
- **model-router**: Nivel A **7/7** · Nivel B **14/14**

## DEMETER-BLOOM

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=192chr · 2 hops · ok | 5122 |
| A | write | ✅ | — | thinking=248chr · 2 hops · ok | 5184 |
| A | edit | ✅ | — | thinking=288chr · 3 hops · ok | 7375 |
| A | bash | ✅ | — | thinking=176chr · 2 hops · ok | 8189 |
| A | grep | ✅ | — | thinking=219chr · 2 hops · ok | 4825 |
| A | find | ✅ | — | thinking=281chr · 2 hops · ok | 5489 |
| A | ls | ✅ | — | thinking=258chr · 2 hops · ok | 4950 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Configuración de Tests","question":"¿Qué framework de testing prefieres usa | 7215 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 4597 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React"} | 3175 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 3350 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com"}> | 2457 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;"} | 4401 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 2756 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 3083 |
| B | Agent | ✅ | — | args ok: {"prompt":"Investiga y determina qué versión de TypeScript usa este repositorio. Busca en:\n1. El ar | 8117 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release"} | 2959 |
| B | sandbox_create | ✅ | — | args ok: {"image":"python:3.12-slim","name":"python-sandbox","workdir":"/workspace"} | 4797 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 2872 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 3513 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 2956 |

## TITAN-CROWN

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=420chr · 2 hops · ok | 7681 |
| A | write | ✅ | — | thinking=468chr · 2 hops · ok | 7634 |
| A | edit | ✅ | — | thinking=1521chr · 2 hops · ok | 12916 |
| A | bash | ✅ | — | thinking=371chr · 2 hops · ok | 4200 |
| A | grep | ✅ | — | thinking=1005chr · 2 hops · ok | 10822 |
| A | find | ✅ | — | thinking=394chr · 2 hops · ok | 3860 |
| A | ls | ✅ | — | thinking=874chr · 2 hops · ok | 10217 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de tests","question":"¿Qué framework prefieres para las pruebas?" | 11966 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 3173 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":1800} | 4161 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 3678 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com"}> | 6383 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"(() => 42)()","description":"Inline script that returns 42."} | 7961 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 2660 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 3731 |
| B | Agent | ✅ | — | args ok: {"prompt":"Rol: Eres un analista de repositorios JavaScript/TypeScript. Tu objetivo es determinar co | 39427 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 4517 |
| B | sandbox_create | ✅ | — | args ok: {"name":"py312-slim-test","image":"python:3.12-slim","workdir":"/workspace"} | 5269 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 3170 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":false} | 2912 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 3894 |

## MIDAS-GOLD

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 2930 |
| A | write | ✅ | — | thinking=419chr · 2 hops · ok | 6560 |
| A | edit | ✅ | — | thinking=0chr · 2 hops · ok | 4827 |
| A | bash | ✅ | — | thinking=373chr · 2 hops · ok | 5137 |
| A | grep | ✅ | — | thinking=426chr · 2 hops · ok | 4102 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 3662 |
| A | ls | ✅ | — | thinking=396chr · 2 hops · ok | 3827 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"question":"¿Qué framework de testing prefieres usar en este proyecto?","header":"Ele | 3654 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","description":"Investigar el bug del logi | 2553 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":1200} | 6290 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages","source":"skills.sh","full":false} | 2767 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com","args":["get_title"],"semanticAction":{"actions":[{"actionType":"READ>", | 1915 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"module.exports = async function () { return 42; }","description":"Simple w | 3165 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 1651 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 2780 |
| B | Agent | ✅ | — | args ok: {"prompt":"Analiza el repositorio de código actual y determina con la mayor precisión posible qué ve | 9331 |
| B | kb_search | ✅ | — | args ok: {"query":"\"pipeline de release\"","limit":20} | 3150 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python-312-slim-sandbox","image":"python:3.12-slim","workdir":"/workspace"} | 2890 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 2170 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 7642 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 2965 |

## model-router

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 6855 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 4487 |
| A | edit | ✅ | — | thinking=0chr · 2 hops · ok | 4365 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 3915 |
| A | grep | ✅ | — | thinking=446chr · 2 hops · ok | 3984 |
| A | find | ✅ | — | thinking=539chr · 2 hops · ok | 4234 |
| A | ls | ✅ | — | thinking=281chr · 2 hops · ok | 4244 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de Testing","question":"¿Qué framework de testing prefieres usar? | 4394 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 2305 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React"} | 2451 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 5301 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com"}> | 5331 |
| B | workflow | ✅ | — | args ok: {"name":"probe","description":"Workflow de prueba que retorna el número 42.","script":"return 42;"} | 3584 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 1980 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 2182 |
| B | Agent | ✅ | — | args ok: {"subagent_type":"Code","description":"Detecta la versión de TypeScript del repositorio","prompt":"E | 4053 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release"} | 2058 |
| B | sandbox_create | ✅ | — | args ok: {"image":"python:3.12-slim"} | 1893 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 2568 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 1926 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 2820 |

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
- **agent_browser**: Con la herramienta agent_browser abre <https://example.com> y dime el título de la página.
- **workflow**: Lanza un workflow (herramienta workflow) llamado 'probe' con script inline que retorne 42.
- **get_subagent_result**: Consulta con get_subagent_result el resultado del agente agent-123 (sin esperar).
- **steer_subagent**: Envía con steer_subagent el mensaje 'prioriza los tests' al agente agent-123.
- **Agent**: Delega a un sub-agente especializado la tarea de averiguar qué versión de TypeScript usa este repo.
- **kb_search**: Busca en la base de conocimiento del equipo notas sobre 'pipeline de release'.
- **sandbox_create**: Necesito un entorno desechable y aislado con la imagen python:3.12-slim para probar un script sin tocar mi máquina.
- **sandbox_exec**: En el sandbox sbx-1 corre el comando 'python --version' y dime la salida.
- **workflow_catalog**: Muéstrame el catálogo de flujos de trabajo predefinidos que puedo correr en este proyecto.
- **goal_complete**: El objetivo goal-42 ya quedó logrado: registra el resumen 'migración completada sin regresiones'.
