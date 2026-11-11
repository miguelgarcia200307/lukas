// Lector mínimo de .env.local (sin dependencias)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readEnv(file = path.join(ROOT, '.env.local')) {
  if (!fs.existsSync(file)) throw new Error(`No existe ${file}`);
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim();
  }
  return env;
}

export function requireVars(env, names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`\n✘ Faltan en .env.local: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}
