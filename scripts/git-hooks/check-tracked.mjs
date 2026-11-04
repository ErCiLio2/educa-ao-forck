import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { findProblems } from './lib.mjs';

// Verifica TODOS os ficheiros versionados (usado no CI): apanha o que passou por cima dos hooks locais.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = tracked.map((path) => {
  const size = statSync(path).size;
  let text = null;
  if (size < 512 * 1024) {
    const content = readFileSync(path, 'utf8');
    text = content.includes('\u0000') ? null : content;
  }
  return { path, size, text };
});

const problems = findProblems(files);
if (problems.length) {
  console.error('Ficheiros versionados que violam as regras do repositório:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`${tracked.length} ficheiros versionados verificados: sem ficheiros proibidos nem segredos`);
