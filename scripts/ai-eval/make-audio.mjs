// Genera los audios del banco con la voz es-MX de Windows (SAPI) y los codifica como un celular:
// casos impares → WebM/Opus 24 kbps (Android), pares → M4A/AAC 32 kbps (iOS). Mono 16 kHz.
// Uso: node scripts/ai-eval/make-audio.mjs --ffmpeg <ruta a ffmpeg>   (requiere Windows con la voz "Sabina")
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'audio');
const ffmpeg = process.argv[process.argv.indexOf('--ffmpeg') + 1] || 'ffmpeg';
fs.mkdirSync(OUT, { recursive: true });
const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));
const manifest = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lukas-audio-'));

for (const [i, c] of cases.filter((x) => x.audio).entries()) {
  const wav = path.join(tmp, `${c.audio}.wav`);
  const txt = path.join(tmp, `${c.audio}.txt`);
  fs.writeFileSync(txt, c.say, 'utf8');
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    $v = $s.GetInstalledVoices() | ? { $_.VoiceInfo.Culture.Name -like 'es-*' } | select -First 1; $s.SelectVoice($v.VoiceInfo.Name);
    $s.Rate = 0; $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);
    $s.SetOutputToWaveFile('${wav}', $fmt); $s.Speak([IO.File]::ReadAllText('${txt}', [Text.Encoding]::UTF8)); $s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
  // 0,6 s de silencio al inicio y 1 s al final, como una grabación real
  const pad = '-af adelay=600|600,apad=pad_dur=1'.split(' ');
  const android = i % 2 === 0;
  const out = path.join(OUT, `${c.audio}.${android ? 'webm' : 'm4a'}`);
  const codec = android ? ['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'] : ['-c:a', 'aac', '-b:a', '32k'];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, ...pad, '-ac', '1', '-ar', '16000', ...codec, out]);
  const info = spawnSync(ffmpeg, ['-i', out], { encoding: 'utf8' }).stderr;
  const [, h, m, s] = /Duration: (\d+):(\d+):([\d.]+)/.exec(info) ?? [0, 0, 0, 0];
  manifest[c.audio] = { file: path.basename(out), seconds: Math.round((h * 3600 + m * 60 + Number(s)) * 10) / 10 };
  console.log(`${path.basename(out)}  ${fs.statSync(out).size} bytes  ${manifest[c.audio].seconds} s`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
