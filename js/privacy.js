// Modo privado: qué saldos se ocultan en pantalla. Preferencia SOLO de este dispositivo (localStorage): nunca se
// envía al servidor ni se sincroniza. Se lee de forma síncrona al importar el módulo, antes del primer render,
// así que los montos reales nunca aparecen un instante antes de ocultarse.
//
// Uso (cualquier pantalla):  isHidden('accounts') · toggle('accounts') · toggleAll() · allHidden()
//                             onPrivacyChange(fn) → función para desuscribirse
// Preparado para: "Ocultar saldos al abrir la app" (hideAll() al iniciar) y para Inicio, Movimientos y Reportes
// (basta con agregar claves a PRIVACY_KEYS y usar sensitiveAmount() de ui/sensitive.js).

export const PRIVACY_KEYS = ['accounts', 'creditCards', 'loans', 'subscriptions'];
export const STORAGE_KEY = 'lukas-privacy';

/** Crea un estado de privacidad sobre un almacenamiento tipo localStorage (inyectable para pruebas) */
export function createPrivacy(storage = safeStorage(), keys = PRIVACY_KEYS) {
  const listeners = new Set();
  let hidden = read();

  function read() {
    try {
      const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      return new Set(Array.isArray(raw?.hidden) ? raw.hidden.filter((k) => keys.includes(k)) : []); // por defecto: todo visible
    } catch { return new Set(); }
  }
  function commit(next) {
    hidden = next;
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ hidden: [...hidden] })); } catch { /* sin almacenamiento: solo esta sesión */ }
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  const api = {
    keys,
    isHidden: (k) => hidden.has(k),
    allHidden: () => keys.every((k) => hidden.has(k)),
    /** Alterna solo esa clave */
    toggle(k) {
      if (!keys.includes(k)) return;
      const next = new Set(hidden);
      next.has(k) ? next.delete(k) : next.add(k);
      commit(next);
    },
    setHidden(k, value) {
      if (!keys.includes(k) || hidden.has(k) === !!value) return;
      const next = new Set(hidden);
      value ? next.add(k) : next.delete(k);
      commit(next);
    },
    hideAll: () => commit(new Set(keys)),
    showAll: () => commit(new Set()),
    /** Si al menos uno está visible, oculta todos; si todos están ocultos, muestra todos */
    toggleAll: () => (api.allHidden() ? api.showAll() : api.hideAll()),
    onPrivacyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Relee el almacenamiento (p. ej. si otra pestaña lo cambió) */
    reload() { hidden = read(); listeners.forEach((fn) => fn()); },
  };
  return api;
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Instancia compartida de la app
export const privacy = createPrivacy();
export const { isHidden, allHidden, toggle, toggleAll, hideAll, showAll, setHidden, onPrivacyChange } = privacy;
export const usePrivacy = () => privacy;

// Otra pestaña de la misma app cambió la preferencia
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) privacy.reload(); });
}
