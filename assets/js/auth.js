/* ============================================================
   GestoTrafic · Autenticación de DEMO
   ------------------------------------------------------------
   ⚠️ Esto NO es autenticación real. Es un login de demostración
   resuelto en el navegador para poder enseñar el CRM con dos
   roles distintos. En un despliegue real se sustituye por
   Supabase Auth con contraseñas hasheadas en servidor.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'gestotrafic_session';

  var USERS = {
    gestor: {
      password: 'demo',
      nombre: 'Laura Ortega',
      rol: 'gestor',
      iniciales: 'LO'
    },
    admin: {
      password: 'demo',
      nombre: 'Sara Aparicio',
      rol: 'admin',
      iniciales: 'SA'
    }
  };

  function login(usuario, password) {
    var u = USERS[String(usuario || '').toLowerCase()];
    if (!u || u.password !== password) return null;

    var session = {
      usuario: String(usuario).toLowerCase(),
      nombre: u.nombre,
      rol: u.rol,
      iniciales: u.iniciales,
      ts: Date.now()
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function logout() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  /** Redirige al login si no hay sesión. Devuelve la sesión si la hay. */
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
    requireSession: requireSession,
    isAdmin: isAdmin
  };
})(window);
