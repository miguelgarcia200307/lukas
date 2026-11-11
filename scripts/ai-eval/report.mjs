// Genera report.md a partir de results/*.json (tabla comparativa entre corridas)
import fs from 'node:fs';
import path from 'node:path';

const pct = (xs) => (xs.length ? `${((xs.filter(Boolean).length / xs.length) * 100).toFixed(1)}%` : '—');
const q = (xs, p) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const ms = (x) => (x == null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);
const avg = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

export function summarize(run) {
  const R = run.results;
  const ok = R.filter((r) => !r.error);
  const col = (k) => R.filter((r) => r.error || k in r.checks).map((r) => !r.error && r.checks[k]);
  const text = ok.filter((r) => !r.audio), audio = ok.filter((r) => r.audio);
  const stage = (k) => q(ok.map((r) => r.server?.[k]), 50);
  // promedio por solicitud (cada turno de una conversación es una solicitud)
  const usage = ok.flatMap((r) => (r.usage_turns?.length ? r.usage_turns : [r.usage])).filter(Boolean);
  const models = {};
  ok.forEach((r) => { if (r.model) models[r.model] = (models[r.model] ?? 0) + 1; });
  return {
    label: run.meta.label, at: run.meta.at, n: R.length, errors: R.filter((r) => r.error).length,
    pass: pct(R.map((r) => r.pass)),
    amounts: pct(col('amounts')), intent: pct(col('intent')), category: pct(col('category')), category_strict: pct(col('category_strict')),
    ask: pct(col('ask')), structure: pct(col('structure')), payment: pct(col('payment')), date: pct(col('date')), fields: pct(col('fields')),
    text_p50: q(text.map((r) => r.timing.total_ms), 50), text_p95: q(text.map((r) => r.timing.total_ms), 95),
    text_first_p50: q(text.map((r) => r.timing.first_proposal_ms), 50), text_first_p95: q(text.map((r) => r.timing.first_proposal_ms), 95),
    audio_p50: q(audio.map((r) => r.timing.total_ms), 50), audio_p95: q(audio.map((r) => r.timing.total_ms), 95),
    audio_first_p50: q(audio.map((r) => r.timing.first_proposal_ms), 50), audio_first_p95: q(audio.map((r) => r.timing.first_proposal_ms), 95),
    audio_transcript_p50: q(audio.map((r) => r.timing.transcript_ms), 50),
    st_upload: stage('upload_ms'), st_stt: stage('stt_ms'), st_ctx: stage('ctx_ms'), st_llm: stage('llm_ms'), st_llm_first: stage('llm_first_ms'), st_total: stage('total_ms'),
    tok_in: avg(usage.map((u) => u.in)), tok_out: avg(usage.map((u) => u.out)), tok_reason: avg(usage.map((u) => u.reasoning)),
    tok_cached: avg(usage.map((u) => u.cached)), tok_billed: avg(usage.map((u) => (u.in ?? 0) - (u.cached ?? 0) + (u.out ?? 0))),
    models: Object.entries(models).map(([m, n]) => `${m.replace('openai/', '')}×${n}`).join(', '),
    meta: run.meta,
  };
}

export function writeReport(dir, out) {
  if (!fs.existsSync(dir)) return;
  const runs = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.meta.at.localeCompare(b.meta.at));
  const S = runs.map(summarize);
  const row = (title, f) => `| ${title} | ${S.map(f).join(' | ')} |`;
  const lines = [
    '# Banco de pruebas del asistente · reporte',
    '',
    `Generado: ${new Date().toISOString()} · ${runs.length} corrida(s). Montos, intención, categoría, pregunta: % de casos correctos.`,
    'Categoría = la esperada es la sugerida o una de las alternativas; "estricta" = la sugerida. Latencias medidas en el cliente (Colombia → Supabase).',
    'Tokens: promedio por solicitud (entrada / salida incl. razonamiento / razonamiento / cacheados / facturables contra cuota = entrada − cacheados + salida).',
    '',
    `| Métrica | ${S.map((s) => `**${s.label}**`).join(' | ')} |`,
    `|---|${S.map(() => '---').join('|')}|`,
    row('Modo', (s) => (s.meta.local ? `local ${s.meta.model ?? ''} ${s.meta.effort ?? ''}` : s.meta.fn)),
    row('Casos (errores)', (s) => `${s.n} (${s.errors})`),
    row('Casos 100% correctos', (s) => s.pass),
    row('Montos exactos', (s) => s.amounts),
    row('Intención', (s) => s.intent),
    row('Categoría (sug. o alt.)', (s) => s.category),
    row('Categoría estricta', (s) => s.category_strict),
    row('Pregunta cuando corresponde', (s) => s.ask),
    row('Separación / agrupación', (s) => s.structure),
    row('Método de pago', (s) => s.payment),
    row('Fecha', (s) => s.date),
    row('Campos (pagos, consultas…)', (s) => s.fields),
    row('Texto total p50 / p95', (s) => `${ms(s.text_p50)} / ${ms(s.text_p95)}`),
    row('Texto 1ª propuesta p50 / p95', (s) => `${ms(s.text_first_p50)} / ${ms(s.text_first_p95)}`),
    row('Audio total p50 / p95', (s) => `${ms(s.audio_p50)} / ${ms(s.audio_p95)}`),
    row('Audio 1ª propuesta p50 / p95', (s) => `${ms(s.audio_first_p50)} / ${ms(s.audio_first_p95)}`),
    row('Audio → "Escuché" p50', (s) => ms(s.audio_transcript_p50)),
    row('Etapas p50: subida · STT · contexto · LLM (1ª línea)', (s) => `${ms(s.st_upload)} · ${ms(s.st_stt)} · ${ms(s.st_ctx)} · ${ms(s.st_llm)} (${ms(s.st_llm_first)})`),
    row('Servidor total p50', (s) => ms(s.st_total)),
    row('Tokens entrada / salida', (s) => (s.tok_in == null ? '—' : `${s.tok_in} / ${s.tok_out}`)),
    row('Tokens razonamiento / cacheados', (s) => (s.tok_in == null ? '—' : `${s.tok_reason} / ${s.tok_cached}`)),
    row('Tokens contra cuota', (s) => (s.tok_billed == null ? '—' : String(s.tok_billed))),
    row('Modelos usados', (s) => s.models || '—'),
    '',
  ];
  const wfile = path.join(dir, '..', 'whisper-results.json');
  if (fs.existsSync(wfile)) {
    const w = JSON.parse(fs.readFileSync(wfile, 'utf8'));
    lines.push('## Whisper: turbo vs large-v3', '', `Audios del banco (${w.summary[0]?.n ?? 0} transcripciones por modelo). Montos = los montos normalizados de la transcripción coinciden con los de la frase; nombres = Visa, Nequi, D1… aparecen bien escritos.`, '',
      '| Modelo | Montos | Nombres | p50 | p95 | Errores |', '|---|---|---|---|---|---|',
      ...w.summary.map((s) => `| ${s.model} | ${s.amounts} | ${s.names} | ${ms(s.p50)} | ${ms(s.p95)} | ${s.errors} |`), '');
  }
  for (const run of runs.slice(-4)) {
    const bad = run.results.filter((r) => !r.pass);
    lines.push(`## Fallos · ${run.meta.label}`, '');
    if (!bad.length) { lines.push('Ninguno.', ''); continue; }
    for (const r of bad) {
      const f = r.error ? `error: ${r.error}` : Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(', ');
      const got = r.error ? '' : ` → ${(r.proposals ?? []).map((p) => `${p.kind === 'transaction' ? p.type : p.kind} ${p.amount ?? ''} ${p.category ?? p.card ?? p.name ?? ''}${p.payment ? ` ${p.payment}` : ''}${p.date ? ` ${p.date}` : ''}`).join('; ') || 'sin propuestas'}${r.question ? ` · pregunta: ${r.question}` : ''}${r.query ? ` · consulta ${JSON.stringify(r.query)}` : ''}`;
      lines.push(`- \`${r.id}\` (${f})${got}${r.audio && r.transcript ? ` · «${r.transcript}»` : ''}`);
    }
    lines.push('');
  }
  fs.writeFileSync(out, lines.join('\n'));
}
