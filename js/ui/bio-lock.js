// Bloqueo con Face ID / Touch ID / huella para entrar a Tarjetas (opcional, en Ajustes).
// Usa WebAuthn con el autenticador del propio dispositivo: el sistema pide la biometría y responde sí/no.
// Es un candado de comodidad LOCAL (como el de las apps de bancos al abrir una sección): no reemplaza la
// sesión ni protege contra alguien con acceso técnico al teléfono. Nada sale del dispositivo.
const KEY = 'lukas-bio-lock';
const SESSION = 'lukas-bio-ok';
const RELOCK_MS = 60_000; // si la app estuvo en segundo plano más de 1 minuto, vuelve a pedirla

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };

export const bioLockEnabled = () => !!read()?.id;

export async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

/** Activa el bloqueo: el sistema pide Face ID / huella una vez para crear la llave local */
export async function enableBioLock() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Lukas' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Lukas', displayName: 'Lukas · Tarjetas' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000, attestation: 'none',
    },
  });
  if (!cred) throw new Error('No se pudo activar');
  try { localStorage.setItem(KEY, JSON.stringify({ id: b64(cred.rawId) })); } catch { /* sin almacenamiento */ }
  markUnlocked();
}

export function disableBioLock() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION); } catch { /* nada */ }
}

function markUnlocked() { try { sessionStorage.setItem(SESSION, String(Date.now())); } catch { /* nada */ } }

/** ¿Hay que pedirla ahora? */
export function needsUnlock() {
  if (!bioLockEnabled()) return false;
  try {
    const t = Number(sessionStorage.getItem(SESSION));
    return !t || (hiddenAt && Date.now() - hiddenAt > RELOCK_MS);
  } catch { return true; }
}

/** Pide la biometría → true si el usuario la pasó */
export async function unlock() {
  const st = read();
  if (!st?.id) return true;
  try {
    const ok = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(st.id), transports: ['internal'] }],
        userVerification: 'required', timeout: 60_000,
      },
    });
    if (!ok) return false;
    hiddenAt = 0;
    markUnlocked();
    return true;
  } catch { return false; }
}

let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_MS) { try { sessionStorage.removeItem(SESSION); } catch { /* nada */ } }
  });
}
