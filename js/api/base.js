import { sb } from '../supabase.js';

/** Error con mensaje amable para el usuario */
export class AppError extends Error {
  constructor(message, cause, code) {
    super(message);
    this.cause = cause;
    this.code = code;
  }
}

function friendly(err) {
  const msg = String(err?.message ?? err ?? '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  }
  if (/JWT|expired|not authenticated|No autenticado|401/i.test(msg)) return 'Tu sesión expiró. Vuelve a entrar.';
  if (/duplicate key/i.test(msg)) return 'Eso ya existe.';
  if (/violates foreign key/i.test(msg)) return 'Hay datos relacionados que lo impiden.';
  if (/violates check constraint/i.test(msg)) return 'Revisa los datos: hay un valor no válido.';
  if (/^[A-ZÁÉÍÓÚ¿¡][^_]{3,120}$/.test(msg) && !/[{}]/.test(msg)) return msg; // mensajes propios de las RPC
  return 'Algo salió mal. Intenta de nuevo.';
}

export function unwrap({ data, error }) {
  if (error) {
    console.error('[supabase]', error);
    throw new AppError(friendly(error), error, error.code);
  }
  return data;
}

export const from = (table) => sb.from(table);
export const rpc = async (fn, args) => unwrap(await sb.rpc(fn, args));
