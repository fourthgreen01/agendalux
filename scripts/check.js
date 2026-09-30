'use strict';
/* Verifica a sintaxe de TODOS os .js do projeto (node --check) e se todo
   require() relativo aponta para um arquivo que existe.
   Uso: npm run check */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = ['node_modules', '.vercel', '.git'];

function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (SKIP.indexOf(e.name) >= 0) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  });
  return out;
}

/* resolve um require() relativo — pega o clássico './_lib/x' dentro de
   api/bookings/, que só explode em produção (Vercel FUNCTION_INVOCATION_FAILED) */
function exists(base) {
  const tries = [base, base + '.js', base + '.json',
    path.join(base, 'index.js'), path.join(base, 'index.json')];
  return tries.some((p) => {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
  });
}

function missingRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (!exists(target)) out.push(m[2]);
  }
  return out;
}

let bad = 0;
let broken = 0;
const files = walk(ROOT);
files.forEach((file) => {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('  ok    ' + rel);
  } catch (e) {
    bad++;
    console.error('  ERRO  ' + rel);
    console.error(String(e.stderr || e.message).trim());
  }
  const missing = missingRequires(file);
  if (missing.length) {
    broken++;
    console.error('  ERRO  ' + rel + '  require() sem arquivo:');
    missing.forEach((p) => console.error('          ' + p));
  }
});

console.log(`\n${files.length - bad}/${files.length} arquivos válidos` +
  (broken ? ` (${broken} com require() quebrado)` : ''));
if (bad || broken) {
  console.error(`${bad} erro(s) de sintaxe, ${broken} require(s) quebrado(s)`);
  process.exit(1);
}
