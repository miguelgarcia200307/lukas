// Cliente de Supabase falso para pruebas de navegador (se inyecta con un import map). Las RPC responden con
// window.__rpc(nombre, args); sin red y sin sesión real.
export function createClient() {
  const ok = (data) => Promise.resolve({ data, error: null });
  const query = () => new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => query()) });
  return {
    rpc: (fn, args) => ok(window.__rpc ? window.__rpc(fn, args) : null),
    from: () => query(),
    auth: {
      getSession: () => ok({ session: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    functions: { invoke: () => ok(null) },
  };
}
