/* ============================================================
   GestoTrafic · Capa de datos (Supabase)
   Todas las operaciones van contra tablas namespaced gestotrafic_*.
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.GT_CONFIG;
  var sb = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
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
    return unwrap(await sb.from(C.TABLA_CLIENTES).select('*').eq('id', id).single());
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

  var SELECT_EXP = '*, cliente:' + C.TABLA_CLIENTES + '(id, nombre, apellidos, razon_social, tipo, nif)';

  async function listarExpedientes() {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).select(SELECT_EXP).order('created_at', { ascending: false }));
  }

  async function listarExpedientesDeCliente(clienteId) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).select('*')
      .eq('cliente_id', clienteId).order('created_at', { ascending: false }));
  }

  async function obtenerExpediente(id) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).select(SELECT_EXP).eq('id', id).single());
  }

  async function crearExpediente(datos) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).insert(datos).select().single());
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

  function urlDocumento(path) {
    if (!path) return null;
    return sb.storage.from(C.BUCKET_DOCS).getPublicUrl(path).data.publicUrl;
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
    if (!res.ok || data.error) throw new Error(data.error || 'No se pudo calcular el ITP');
    return data;
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
    borrarExpediente: borrarExpediente,
    listarDocumentos: listarDocumentos,
    subirDocumento: subirDocumento,
    borrarDocumento: borrarDocumento,
    urlDocumento: urlDocumento,
    calcularITP: calcularITP,
    kpis: kpis
  };
})(window);
