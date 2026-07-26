/* ============================================================
   GestoTrafic · Capa de datos (Supabase)
   Todas las operaciones van contra tablas namespaced gestotrafic_*.

   El cliente se autentica con la sesión que emitió gestotrafic-auth.
   Ese token es lo que aplica el RLS: un gestor solo recibe SUS
   expedientes y un admin los recibe todos, sin que las consultas de
   aquí tengan que filtrar nada. El filtrado no es cosmético: aunque
   se manipulase este fichero, el servidor no devolvería más filas.
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.GT_CONFIG;
  var sb = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });

  /* Restaura la sesión en el cliente. Hay que esperar a que termine antes
     de la primera consulta: si no, saldría con el rol anon y el RLS la
     dejaría a cero filas. */
  var tokens = global.GTAuth ? global.GTAuth.getTokens() : null;
  var listo = tokens
    ? sb.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      }).then(function (r) {
        if (r.error) throw new Error('Sesión caducada');
        return r;
      })
    : Promise.resolve(null);

  // supabase-js renueva el token solo; lo guardamos para no perderlo al recargar.
  sb.auth.onAuthStateChange(function (evento, session) {
    if (session && global.GTAuth) global.GTAuth.actualizarTokens(session);
  });

  function unwrap(res) {
    if (res.error) throw new Error(res.error.message || 'Error de base de datos');
    return res.data;
  }

  /* ---------------- Clientes ---------------- */

  async function listarClientes() {
    return unwrap(await sb.from(C.TABLA_CLIENTES).select('*').order('created_at', { ascending: false }));
  }

  async function obtenerCliente(id) {
    var c = unwrap(await sb.from(C.TABLA_CLIENTES).select('*').eq('id', id).maybeSingle());
    if (!c) throw new Error('Esta ficha de cliente ya no existe.');
    return c;
  }

  async function crearCliente(datos) {
    return unwrap(await sb.from(C.TABLA_CLIENTES).insert(datos).select().single());
  }

  async function actualizarCliente(id, datos) {
    datos.updated_at = new Date().toISOString();
    return unwrap(await sb.from(C.TABLA_CLIENTES).update(datos).eq('id', id).select().single());
  }

  async function borrarCliente(id) {
    return unwrap(await sb.from(C.TABLA_CLIENTES).delete().eq('id', id));
  }

  /* ---------------- Expedientes ---------------- */

  /* Dos relaciones apuntan a gestotrafic_usuarios (gestor y validador de IA),
     así que hay que desambiguarlas nombrando la columna de la FK. */
  var SELECT_EXP = '*, cliente:' + C.TABLA_CLIENTES + '(id, nombre, apellidos, razon_social, tipo, nif)'
                 + ', gestor:' + C.TABLA_USUARIOS + '!gestor_id(id, nombre, usuario)'
                 + ', ia_validador:' + C.TABLA_USUARIOS + '!ia_validado_por(id, nombre)';

  async function listarExpedientes() {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).select(SELECT_EXP).order('created_at', { ascending: false }));
  }

  async function listarExpedientesDeCliente(clienteId) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).select('*')
      .eq('cliente_id', clienteId).order('created_at', { ascending: false }));
  }

  /** Si el expediente es de otro gestor, el RLS no lo devuelve. `maybeSingle`
      lo distingue de un error real y evita soltar la jerga de PostgREST. */
  async function obtenerExpediente(id) {
    var exp = unwrap(await sb.from(C.TABLA_EXPEDIENTES).select(SELECT_EXP).eq('id', id).maybeSingle());
    if (!exp) throw new Error('Este expediente no existe o no está asignado a tu usuario.');
    return exp;
  }

  /** El expediente es de quien lo crea. El RLS solo admite el propio id
      (o cualquiera, si es admin), así que esto no es decorativo. */
  async function crearExpediente(datos) {
    var s = global.GTAuth.getSession();
    if (s && !datos.gestor_id) datos.gestor_id = s.id;
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).insert(datos).select().single());
  }

  /** Reasignar a otro gestor. El RLS solo se lo permite al admin. */
  async function reasignarExpediente(id, gestorId) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES)
      .update({ gestor_id: gestorId, updated_at: new Date().toISOString() })
      .eq('id', id).select().single());
  }

  async function actualizarExpediente(id, datos) {
    datos.updated_at = new Date().toISOString();
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).update(datos).eq('id', id).select().single());
  }

  async function borrarExpediente(id) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).delete().eq('id', id));
  }

  /* ---------------- Documentos ---------------- */

  async function listarDocumentos(expedienteId) {
    return unwrap(await sb.from(C.TABLA_DOCUMENTOS).select('*')
      .eq('expediente_id', expedienteId).order('created_at', { ascending: true }));
  }

  /** Sube el fichero al bucket aislado y registra el documento. */
  async function subirDocumento(expedienteId, tipo, file) {
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var path = expedienteId + '/' + tipo + '-' + Date.now() + '.' + ext;

    var up = await sb.storage.from(C.BUCKET_DOCS).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (up.error) throw new Error('No se pudo subir el archivo: ' + up.error.message);

    // Un documento por tipo y expediente: sustituimos el anterior si existía.
    var previos = unwrap(await sb.from(C.TABLA_DOCUMENTOS).select('id, storage_path')
      .eq('expediente_id', expedienteId).eq('tipo', tipo));

    var nuevo = unwrap(await sb.from(C.TABLA_DOCUMENTOS).insert({
      expediente_id: expedienteId,
      tipo: tipo,
      estado: 'recibido',
      nombre_archivo: file.name,
      storage_path: path,
      mime: file.type || null,
      tamano: file.size
    }).select().single());

    if (previos && previos.length) {
      var ids = previos.map(function (d) { return d.id; });
      var paths = previos.map(function (d) { return d.storage_path; }).filter(Boolean);
      await sb.from(C.TABLA_DOCUMENTOS).delete().in('id', ids);
      if (paths.length) await sb.storage.from(C.BUCKET_DOCS).remove(paths);
    }

    return nuevo;
  }

  async function borrarDocumento(doc) {
    if (doc.storage_path) await sb.storage.from(C.BUCKET_DOCS).remove([doc.storage_path]);
    return unwrap(await sb.from(C.TABLA_DOCUMENTOS).delete().eq('id', doc.id));
  }

  /** El bucket es privado: cada enlace se firma y caduca. Un gestor solo puede
      firmar rutas de sus propios expedientes (política de storage.objects). */
  async function urlDocumento(path) {
    if (!path) return null;
    var r = await sb.storage.from(C.BUCKET_DOCS).createSignedUrl(path, 3600);
    if (r.error) return null;
    return r.data.signedUrl;
  }

  /** Firma en bloque los documentos de un expediente: { id: url }. */
  async function urlsDocumentos(docs) {
    var mapa = {};
    await Promise.all((docs || []).map(async function (d) {
      mapa[d.id] = await urlDocumento(d.storage_path);
    }));
    return mapa;
  }

  /* ---------------- Cálculo ITP ---------------- */

  /**
   * Llama a la Edge Function gestotrafic-itp (BOE 2026 · Orden HAC/1501/2025).
   * Devuelve { valor_venal, base_imponible, itp, tasa_dgt, total_impuestos, detalle }.
   */
  async function calcularITP(payload) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_ITP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + C.SUPABASE_ANON_KEY,
        'apikey': C.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!res.ok || data.error) {
      // `sin_valor_boe` no es un fallo del motor: es que no hay precio medio
      // para ese vehículo. Se traslada el mensaje legible, no el código.
      var e = new Error(data.mensaje || data.error || 'No se pudo calcular el ITP');
      e.codigo = data.error;
      e.candidatos = data.candidatos || null;
      throw e;
    }
    return data;
  }

  /* ---------------- Precios medios · Anexo I (turismos) ---------------- */

  /* Catálogo para los desplegables marca → modelo → versión. Son RPC y no
     consultas a la tabla porque hacen falta agrupaciones (`distinct`) que
     PostgREST no expone, y porque así el filtro por la Orden vigente vive en
     un único sitio del servidor. */

  async function preciosMarcas() {
    return unwrap(await sb.rpc('gestotrafic_precios_marcas'));
  }

  async function preciosModelos(marca) {
    return unwrap(await sb.rpc('gestotrafic_precios_modelos', { p_marca: marca }));
  }

  /* Devuelve TODAS las versiones del modelo, no solo las que encajan con la
     fecha: `en_periodo` marca cuáles corresponden al año de matriculación.
     Si la fecha viene mal leída de la ficha, la versión correcta tiene que
     seguir estando en la lista. */
  async function preciosVersiones(marca, modelo, fechaMatriculacion) {
    return unwrap(await sb.rpc('gestotrafic_precios_versiones', {
      p_marca: marca,
      p_modelo: modelo,
      p_fecha_matriculacion: fechaMatriculacion || null
    }));
  }

  /* ---------------- Usuarios (gestores) ---------------- */

  /** El RLS decide qué se ve: el admin todos, un gestor solo su ficha.
      `password_hash` no está en la lista y además no tiene privilegio
      de lectura para `authenticated`. */
  async function listarUsuarios() {
    return unwrap(await sb.from(C.TABLA_USUARIOS)
      .select('id, nombre, usuario, rol, activo, created_at')
      .order('rol', { ascending: true })
      .order('nombre', { ascending: true }));
  }

  /** Llama a la Edge Function con el token del admin: ella vuelve a
      comprobar el rol en el servidor antes de hashear y dar de alta. */
  async function llamarAuth(cuerpo) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_AUTH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || C.SUPABASE_ANON_KEY)
      },
      body: JSON.stringify(cuerpo)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.error) throw new Error(data.error || 'No se pudo completar la operación');
    return data;
  }

  async function crearGestor(datos) {
    return (await llamarAuth({
      accion: 'crear',
      nombre: datos.nombre,
      usuario: datos.usuario,
      password: datos.password,
      rol: datos.rol || 'gestor'
    })).usuario;
  }

  async function cambiarClave(usuarioId, password) {
    return llamarAuth({ accion: 'clave', usuario: usuarioId, password: password });
  }

  /** Activar o desactivar. Solo el admin pasa el RLS de update. */
  async function cambiarActivo(usuarioId, activo) {
    return unwrap(await sb.from(C.TABLA_USUARIOS)
      .update({ activo: activo, updated_at: new Date().toISOString() })
      .eq('id', usuarioId).select('id, nombre, usuario, rol, activo').single());
  }

  /* ---------------- Gest-IA ---------------- */

  /** Manda los documentos ya subidos a la Edge Function para que los lea
      Claude. La API key vive en el servidor; aquí solo va el token de sesión. */
  async function analizarDocumentos(expedienteId, documentos) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_GESTIA, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || '')
      },
      body: JSON.stringify({ expediente_id: expedienteId, documentos: documentos })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.error) throw new Error(data.error || 'Gest-IA no pudo leer los documentos');
    return data;
  }

  /** Sube un documento a un expediente ya creado, sin registrar fila todavía. */
  async function subirArchivo(expedienteId, tipo, file) {
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var path = expedienteId + '/' + tipo + '-' + Date.now() + '.' + ext;
    var up = await sb.storage.from(C.BUCKET_DOCS).upload(path, file, {
      cacheControl: '3600', upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (up.error) throw new Error('No se pudo subir ' + file.name + ': ' + up.error.message);
    return { path: path, nombre: file.name, mime: file.type || null, tamano: file.size };
  }

  /** Registra en el checklist un archivo ya subido. */
  async function registrarDocumento(expedienteId, tipo, archivo) {
    return unwrap(await sb.from(C.TABLA_DOCUMENTOS).insert({
      expediente_id: expedienteId,
      tipo: tipo,
      estado: 'recibido',
      nombre_archivo: archivo.nombre,
      storage_path: archivo.path,
      mime: archivo.mime,
      tamano: archivo.tamano
    }).select().single());
  }

  /* ---------------- KPIs ---------------- */

  async function kpis() {
    var clientes = unwrap(await sb.from(C.TABLA_CLIENTES).select('id', { count: 'exact', head: false }));
    var expedientes = unwrap(await sb.from(C.TABLA_EXPEDIENTES).select('id, estado, created_at, total_impuestos'));

    var inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    var porEstado = {};
    global.GT_ESTADOS.forEach(function (e) { porEstado[e.id] = 0; });

    var delMes = 0, facturacionMes = 0;
    expedientes.forEach(function (e) {
      if (porEstado[e.estado] !== undefined) porEstado[e.estado]++;
      if (new Date(e.created_at) >= inicioMes) {
        delMes++;
        facturacionMes += Number(e.total_impuestos) || 0;
      }
    });

    return {
      totalClientes: clientes.length,
      totalExpedientes: expedientes.length,
      expedientesMes: delMes,
      impuestosMes: facturacionMes,
      porEstado: porEstado
    };
  }

  global.GTApi = {
    sb: sb,
    listo: listo,
    listarClientes: listarClientes,
    obtenerCliente: obtenerCliente,
    crearCliente: crearCliente,
    actualizarCliente: actualizarCliente,
    borrarCliente: borrarCliente,
    listarExpedientes: listarExpedientes,
    listarExpedientesDeCliente: listarExpedientesDeCliente,
    obtenerExpediente: obtenerExpediente,
    crearExpediente: crearExpediente,
    actualizarExpediente: actualizarExpediente,
    reasignarExpediente: reasignarExpediente,
    borrarExpediente: borrarExpediente,
    listarUsuarios: listarUsuarios,
    crearGestor: crearGestor,
    cambiarClave: cambiarClave,
    cambiarActivo: cambiarActivo,
    listarDocumentos: listarDocumentos,
    subirDocumento: subirDocumento,
    borrarDocumento: borrarDocumento,
    urlDocumento: urlDocumento,
    urlsDocumentos: urlsDocumentos,
    calcularITP: calcularITP,
    preciosMarcas: preciosMarcas,
    preciosModelos: preciosModelos,
    preciosVersiones: preciosVersiones,
    analizarDocumentos: analizarDocumentos,
    subirArchivo: subirArchivo,
    registrarDocumento: registrarDocumento,
    kpis: kpis
  };
})(window);
