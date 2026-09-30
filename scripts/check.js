'use strict';
/* Verifica a sintaxe de TODOS os .js do projeto (node --check).
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

let bad = 0;
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
});

console.log(`\n${files.length - bad}/${files.length} arquivos válidos`);
if (bad) {
  console.error(`${bad} arquivo(s) com erro de sintaxe`);
  process.exit(1);
}
