/* ============================================================
   GestoTrafic · Sesión
   ------------------------------------------------------------
   El login ya NO se resuelve en el navegador. Las credenciales se
   verifican en la Edge Function `gestotrafic-auth`, que compara la
   contraseña contra el hash bcrypt de gestotrafic_usuarios y devuelve
   una sesión de Supabase firmada.

   Ese token es lo que hace cumplir el aislamiento entre gestores: el
   RLS de gestotrafic_expedientes se apoya en auth.uid(), así que un
   gestor no puede ver los expedientes de otro ni manipulando el
   navegador. Aquí solo se guarda la sesión y se ofrece el perfil.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'gestotrafic_sesion';
  var C = global.GT_CONFIG;

  function iniciales(nombre) {
    return String(nombre || '')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (p) { return p[0]; }).join('').toUpperCase() || '··';
  }

  function guardar(datos) {
    try { sessionStorage.setItem(KEY, JSON.stringify(datos)); } catch (e) {}
  }

  function leer() {
    try {
      var raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /** Verifica las credenciales en el servidor. Devuelve el perfil o lanza. */
  async function login(usuario, password) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_AUTH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + C.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ accion: 'login', usuario: usuario, password: password })
    });

    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.error) throw new Error(data.error || 'No se pudo iniciar sesión');

    guardar({ perfil: data.perfil, session: data.session });
    return data.perfil;
  }

  /** Perfil de la sesión abierta: { id, nombre, usuario, rol, iniciales }. */
  function getSession() {
    var s = leer();
    if (!s || !s.perfil || !s.session) return null;
    var p = s.perfil;
    return {
      id: p.id,
      usuario: p.usuario,
      nombre: p.nombre,
      rol: p.rol,
      iniciales: iniciales(p.nombre)
    };
  }

  /** Sesión de Supabase en crudo: la consume api.js para autenticar el cliente. */
  function getTokens() {
    var s = leer();
    return s && s.session ? s.session : null;
  }

  /** Refresca lo que guardamos cuando supabase-js renueva el token. */
  function actualizarTokens(session) {
    var s = leer();
    if (!s || !session) return;
    s.session = session;
    guardar(s);
  }

  function getToken() {
    var t = getTokens();
    return t ? t.access_token : null;
  }

  function logout() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function requireSession() {
    var s = getSession();
    if (!s) { location.replace('index.html'); return null; }
    return s;
  }

  function isAdmin() {
    var s = getSession();
    return !!s && s.rol === 'admin';
  }

  global.GTAuth = {
    login: login,
    logout: logout,
    getSession: getSession,
    getTokens: getTokens,
    getToken: getToken,
    actualizarTokens: actualizarTokens,
    requireSession: requireSession,
    isAdmin: isAdmin
  };
})(window);
