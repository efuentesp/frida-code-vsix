// Imprime una línea tab-separada: <iso>\t<slug>
//
// <iso>  — timestamp ISO 8601 con segundos (YYYY-MM-DDTHH-MM-SS).
// <slug> — versión kebab-case del timestamp para nombres de archivo
//          (YYYY-MM-DD_HH-MM-SS).
//
// Porte de rpiv-pi/skills/_shared/now.mjs. Sin cambios funcionales —
// sólo comentarios en español.

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");

const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
const slug = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

process.stdout.write(`${iso}\t${slug}`);
