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

  /* Borra SOLO la fila. La FK se lleva en cascada las de documentos, pero los
     archivos del bucket se quedan donde están — y, sin expediente, la política
     de storage ya no autoriza borrarlos: huérfanos sin llave.

     No se usa desde la interfaz por eso mismo: para borrar un expediente está
     `borrarExpedienteCompleto`. Se deja porque es la operación cruda de la
     tabla y sirve para un expediente que nunca llegó a tener archivos. */
  async function borrarExpediente(id) {
    return unwrap(await sb.from(C.TABLA_EXPEDIENTES).delete().eq('id', id));
  }

  /**
   * Borra el expediente ENTERO: archivos del bucket, filas de documentos y
   * expediente, en ese orden.
   *
   * Va por Edge Function porque el orden importa y el navegador no puede
   * garantizarlo: si se le corta la conexión a mitad, deja el expediente medio
   * borrado. Allí es una sola llamada que o hace todos los pasos o se para en
   * el primero que falle, sin dejar archivos sin dueño.
   */
  async function borrarExpedienteCompleto(id) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_BORRAR_EXPEDIENTE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || '')
      },
      body: JSON.stringify({ expediente_id: id })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.error) {
      throw new Error((data.error || 'No se pudo borrar el expediente')
        + (data.detalle ? ' — ' + data.detalle : ''));
    }
    return data;
  }

  /* ---------------- Documentos ---------------- */

  async function listarDocumentos(expedienteId) {
    return unwrap(await sb.from(C.TABLA_DOCUMENTOS).select('*')
      .eq('expediente_id', expedienteId).order('created_at', { ascending: true }));
  }

  /* Un documento puede llegar en varias caras (anverso y reverso de un DNI) y
     son varias filas del MISMO tipo. La tabla no tiene columna para la cara y
     no hace falta: viaja en el nombre del objeto,

         <expediente_id>/<tipo>.<cara>-<timestamp>.<ext>

     que es un dato del propio archivo. La política del bucket solo mira la
     primera carpeta (el expediente), así que el sufijo es libre. Un objeto sin
     `.cara` —los de antes de esto— se lee como el documento entero, que es lo
     que era: un único archivo con lo que hubiera. */

  var RE_CARA = /\/[^/]+?\.([a-z0-9_]+)-\d+\.[^.]+$/;

  /** Qué cara del documento es este archivo. Sin marca → el documento entero. */
  function caraDocumento(doc) {
    var m = doc && doc.storage_path ? RE_CARA.exec(doc.storage_path) : null;
    return m ? m[1] : 'completo';
  }

  function rutaDocumento(expedienteId, tipo, cara, file) {
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var sufijo = (cara && cara !== 'completo') ? '.' + cara : '';
    return expedienteId + '/' + tipo + sufijo + '-' + Date.now() + '.' + ext;
  }

  /**
   * Sube el fichero al bucket aislado y registra el documento.
   *
   * `cara` dice qué parte del documento es. Lo que se sustituye depende de
   * ella, y la regla es la que espera quien lo sube: subir el *anverso*
   * reemplaza al anverso anterior y **deja el reverso en su sitio**; subir el
   * documento *completo* reemplaza a todo, porque es todo.
   */
  async function subirDocumento(expedienteId, tipo, file, cara) {
    var path = rutaDocumento(expedienteId, tipo, cara, file);

    var up = await sb.storage.from(C.BUCKET_DOCS).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (up.error) throw new Error('No se pudo subir el archivo: ' + up.error.message);

    var delTipo = unwrap(await sb.from(C.TABLA_DOCUMENTOS).select('id, storage_path')
      .eq('expediente_id', expedienteId).eq('tipo', tipo));

    var esCompleto = !cara || cara === 'completo';
    var previos = (delTipo || []).filter(function (d) {
      return esCompleto || caraDocumento(d) === cara;
    });

    var nuevo = unwrap(await sb.from(C.TABLA_DOCUMENTOS).insert({
      expediente_id: expedienteId,
      tipo: tipo,
      estado: 'recibido',
      nombre_archivo: file.name,
      storage_path: path,
      mime: file.type || null,
      tamano: file.size
    }).select().single());

    if (previos.length) {
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

  /**
   * Busca expedientes por matrícula o por DNI/NIF/CIF, con un solo término.
   * Normaliza en el servidor: «4821 NBH», «4821-NBH» y «4821nbh» son lo mismo.
   *
   * El filtrado por gestor NO se hace aquí: la función es SECURITY INVOKER y
   * el RLS de `gestotrafic_expedientes` decide qué filas se ven, igual que en
   * el resto del CRM. Aunque se manipulase este fichero, el servidor no
   * devolvería expedientes de otro gestor.
   */
  async function buscarExpedientes(termino) {
    return unwrap(await sb.rpc('gestotrafic_buscar_expedientes', { p_termino: termino }));
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

  /**
   * Propone el valor base del Anexo I con lo que Gest-IA leyó de la ficha.
   * Devuelve `{ estado, candidatos, fila, total, ... }`. `estado` vale
   * `propuesta` (una sola fila), `varios` (hay que elegir), `sin_match`,
   * `sin_datos` o `error`. Nunca devuelve un importe que no esté en la tabla.
   */
  async function proponerValorBase(datos) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_VALOR_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        // Con el token del gestor: la función identifica al usuario antes de
        // consultar, no le vale la clave anon.
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || C.SUPABASE_ANON_KEY)
      },
      body: JSON.stringify(datos)
    });
    var data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'No se pudo consultar el Anexo I');
    return data;
  }

  /* ---------------- Precios medios · Anexo I (turismos) ---------------- */

  /* Catálogo para los desplegables marca → modelo → versión. Son RPC y no
     consultas a la tabla porque hacen falta agrupaciones (`distinct`) que
     PostgREST no expone, y porque así el filtro por la Orden vigente vive en
     un único sitio del servidor. */

  /* `tipo` es el tipo_vehiculo del BOE: 'turismo' o 'autocaravana'. Van
     separados porque el Anexo IV los deprecia con tablas distintas. */

  async function preciosMarcas(tipo) {
    return unwrap(await sb.rpc('gestotrafic_precios_marcas', {
      p_tipo_vehiculo: tipo || 'turismo'
    }));
  }

  async function preciosModelos(marca, tipo) {
    return unwrap(await sb.rpc('gestotrafic_precios_modelos', {
      p_marca: marca,
      p_tipo_vehiculo: tipo || 'turismo'
    }));
  }

  /* Devuelve TODAS las versiones del modelo, no solo las que encajan con la
     fecha: `en_periodo` marca cuáles corresponden al año de matriculación.
     Si la fecha viene mal leída de la ficha, la versión correcta tiene que
     seguir estando en la lista. */
  async function preciosVersiones(marca, modelo, fechaMatriculacion, tipo) {
    return unwrap(await sb.rpc('gestotrafic_precios_versiones', {
      p_marca: marca,
      p_modelo: modelo,
      p_fecha_matriculacion: fechaMatriculacion || null,
      p_tipo_vehiculo: tipo || 'turismo'
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
  async function subirArchivo(expedienteId, tipo, file, cara) {
    var path = rutaDocumento(expedienteId, tipo, cara, file);
    var up = await sb.storage.from(C.BUCKET_DOCS).upload(path, file, {
      cacheControl: '3600', upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (up.error) throw new Error('No se pudo subir ' + file.name + ': ' + up.error.message);
    return { path: path, nombre: file.name, mime: file.type || null, tamano: file.size };
  }

  /* ---------------- Expediente completo (Colegio) ---------------- */

  /**
   * Genera la documentación del expediente junta, en el formato pedido
   * ('html' o 'pdf'), y devuelve `{ blob, nombre, resumen }`.
   *
   * Va por Edge Function porque los documentos viven en un bucket PRIVADO: se
   * bajan allí con el service_role y el navegador no ve ninguna clave ni una
   * URL por archivo suelto.
   *
   * El documento viene en el CUERPO de la respuesta, no por enlace firmado.
   * Así, sin `guardar`, no se escribe nada en el bucket y no queda ningún
   * fichero suelto que nadie reclame. El resumen de lo que lleva dentro viaja
   * en la cabecera `X-Expediente-Resumen`, porque el cuerpo ya es el archivo.
   */
  async function generarExpediente(expedienteId, datos) {
    var res = await fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_EXPEDIENTE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || '')
      },
      body: JSON.stringify(Object.assign({ expediente_id: expedienteId }, datos))
    });

    // Los errores sí vienen en JSON: se distinguen por el tipo de contenido.
    var tipo = res.headers.get('Content-Type') || '';
    if (!res.ok || tipo.indexOf('application/json') !== -1) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.error || 'No se pudo generar el expediente completo');
    }

    var cabecera = res.headers.get('X-Expediente-Resumen');
    var resumen = {};
    if (cabecera) {
      try {
        var bin = atob(cabecera);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resumen = JSON.parse(new TextDecoder().decode(bytes));
      } catch (e) { resumen = {}; }
    }

    var nombre = (datos.formato === 'pdf' ? 'expediente-completo.pdf' : 'expediente-completo.html');
    var cd = res.headers.get('Content-Disposition') || '';
    var m = /filename="([^"]+)"/.exec(cd);
    if (m) nombre = m[1];

    return { blob: await res.blob(), nombre: nombre, resumen: resumen };
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

  /* ---------------- Panel de gerencia ---------------- */

  /**
   * Todo lo que el panel necesita para contar, en una tanda.
   *
   * No se agrega nada en el servidor a propósito: las cuatro consultas traen
   * filas y quien las cuenta es `GTPanel`, que se puede ejecutar en node y
   * verificar contra la base (`node tools/verificar-panel.js`). Con las cuentas
   * hechas en SQL, el panel sería la única versión de sí mismo y no habría
   * forma de comprobarlo sin volver a escribirlo.
   *
   * El aislamiento por gestor NO se filtra aquí: lo hace el RLS, el mismo que
   * en todo el CRM. Un gestor recibe sus expedientes, el historial de esos
   * expedientes y su propia ficha de usuario, así que el panel que se le pinta
   * sale de sus datos sin que este fichero decida nada.
   */
  async function datosPanel() {
    var r = await Promise.all([
      sb.from(C.TABLA_EXPEDIENTES).select(SELECT_EXP).order('created_at', { ascending: false }),
      sb.from(C.TABLA_HISTORIAL)
        .select('expediente_id, estado, estado_anterior, gestor_id, created_at')
        .order('created_at', { ascending: true }),
      sb.from(C.TABLA_DOCUMENTOS).select('id, expediente_id, tipo'),
      listarUsuarios()
    ]);
    return {
      expedientes: unwrap(r[0]),
      historial: unwrap(r[1]),
      documentos: unwrap(r[2]),
      usuarios: r[3]
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
    borrarExpedienteCompleto: borrarExpedienteCompleto,
    buscarExpedientes: buscarExpedientes,
    listarUsuarios: listarUsuarios,
    crearGestor: crearGestor,
    cambiarClave: cambiarClave,
    cambiarActivo: cambiarActivo,
    listarDocumentos: listarDocumentos,
    subirDocumento: subirDocumento,
    caraDocumento: caraDocumento,
    borrarDocumento: borrarDocumento,
    urlDocumento: urlDocumento,
    urlsDocumentos: urlsDocumentos,
    calcularITP: calcularITP,
    proponerValorBase: proponerValorBase,
    preciosMarcas: preciosMarcas,
    preciosModelos: preciosModelos,
    preciosVersiones: preciosVersiones,
    analizarDocumentos: analizarDocumentos,
    generarExpediente: generarExpediente,
    subirArchivo: subirArchivo,
    registrarDocumento: registrarDocumento,
    datosPanel: datosPanel
  };
})(window);
