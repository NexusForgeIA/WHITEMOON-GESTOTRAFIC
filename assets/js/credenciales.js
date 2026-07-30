/* ============================================================
   GestoTrafic · Credenciales de la gestoría (ICOGAM)
   ------------------------------------------------------------
   Cliente de la Edge Function `gestotrafic-credenciales`.

   Aquí NO hay criptografía ni secretos. El navegador solo:
     · pregunta QUÉ hay configurado (metadatos, nunca el valor),
     · manda lo nuevo a la función, que es quien cifra,
     · y pregunta si la operación con el Colegio está habilitada.

   Un secreto ya guardado no se puede recuperar por ningún camino: no
   existe una acción que lo devuelva. Si la gestoría pierde una clave,
   se sube otra.

   `listo()` cachea el booleano durante la sesión de la vista porque lo
   consultan tanto el panel de exportación como la pestaña; se invalida
   solo al guardar o borrar.
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.GT_CONFIG;

  function llamar(cuerpo) {
    return fetch(C.SUPABASE_URL + '/functions/v1/' + C.FN_CREDENCIALES, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (global.GTAuth.getToken() || C.SUPABASE_ANON_KEY)
      },
      body: JSON.stringify(cuerpo)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.error) throw new Error(data.error || 'No se pudo completar la operación');
        return data;
      });
    });
  }

  var cacheListo = null;

  /** ¿Puede la gestoría operar en producción con el Colegio? */
  function listo() {
    if (cacheListo !== null) return Promise.resolve(cacheListo);
    return llamar({ accion: 'listo' }).then(function (d) {
      cacheListo = !!d.listo;
      return cacheListo;
    }).catch(function () {
      // Ante un fallo de red se asume NO configurado: es el lado seguro.
      // Habilitar la exportación porque no se pudo preguntar sería
      // exactamente el error que este módulo existe para evitar.
      return false;
    });
  }

  function invalidar() { cacheListo = null; }

  /** Metadatos de lo configurado. Solo admin; nunca trae secretos. */
  function estado() {
    return llamar({ accion: 'estado' }).then(function (d) { return d.estado; });
  }

  /** Sube lo que venga relleno. Los campos vacíos no se tocan. */
  function guardar(datos) {
    invalidar();
    return llamar(Object.assign({ accion: 'guardar' }, datos)).then(function (d) { return d.estado; });
  }

  /** pieza: 'certificado' | 'api_key' | 'token' */
  function borrar(pieza) {
    invalidar();
    return llamar({ accion: 'borrar', pieza: pieza }).then(function (d) { return d.estado; });
  }

  /** Lee un File a base64 sin la cabecera data:. */
  function ficheroABase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(new Error('No se pudo leer el fichero')); };
      fr.readAsDataURL(file);
    });
  }

  global.GTCredenciales = {
    listo: listo,
    invalidar: invalidar,
    estado: estado,
    guardar: guardar,
    borrar: borrar,
    ficheroABase64: ficheroABase64,
    /* Mensaje único para cuando falta configuración. Se usa igual en el
       panel de exportación y en el aviso de la pestaña, para que el
       gestor lea siempre lo mismo. */
    AVISO: 'Configura tus credenciales de ICOGAM para operar con el Colegio.'
  };
})(window);
