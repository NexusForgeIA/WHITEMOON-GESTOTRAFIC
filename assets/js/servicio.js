/* ============================================================
   GestoTrafic · Cambio de servicio y bloqueo por clasificación
   ------------------------------------------------------------
   Un vehículo que ha estado dado de alta como VTC o como alquiler sin
   conductor NO se transfiere a particular sin más: su FICHA TÉCNICA lleva
   un código de clasificación distinto y hay que pasar por la ITV a
   cambiarlo ANTES de la transferencia. Presentar la transferencia con la
   ficha todavía en el código viejo es que te la devuelvan.

   Dos cosas distintas, y aquí no se mezclan:

     1 · REGISTRAR el cambio de servicio. Se hace SIEMPRE que el gestor lo
         marque, haya bloqueo o no. Va al XML (CAMBIO_SERVICIO = SI).
     2 · BLOQUEAR la tramitación. Solo cuando el CÓDIGO de clasificación
         tiene que cambiar y la ficha técnica todavía no lo refleja.

   La regla es POR CÓDIGO, no por etiqueta:

     · Taxi (1000) → Particular (1000) — el código es el MISMO, así que no
       hay nada que cambiar en la ITV: se transfiere directamente. El
       cambio de servicio se registra igual.
     · VTC (1041) → Particular (1000) — códigos distintos: a la ITV.
     · ASN (1003) → Particular (1000) — códigos distintos: a la ITV.

   ⛔ ANTI-INVENCIÓN · aquí solo hay TRES códigos, y son los que ha
   confirmado la gestoría: 1000, 1041 y 1003. Cualquier otro servicio se
   declara con `codigo: null` y eso NO significa «no bloquea»: significa
   que no se puede decidir, y entonces se bloquea y se pide el código. Un
   servicio cuyo código nos inventáramos mandaría a la ITV a quien no
   tiene que ir — o, peor, dejaría pasar una transferencia que la DGT
   devuelve.
   ============================================================ */
(function (global) {
  'use strict';

  /* --- Catálogo de servicios ---------------------------------------
     `codigo` es el de CLASIFICACIÓN de la ficha técnica. Solo se rellena
     el de los confirmados; el resto queda en null a propósito y se ve.

     PARA AÑADIR UNO: pide a la gestoría su código de clasificación y
     ponlo aquí. No se deduce del nombre del servicio. */
  const SERVICIOS = [
    { id: 'particular', label: 'Particular',                    codigo: '1000' },
    { id: 'taxi',       label: 'Taxi',                          codigo: '1000' },
    { id: 'vtc',        label: 'VTC (arrendamiento con conductor)', codigo: '1041' },
    { id: 'asn',        label: 'Alquiler sin conductor (ASN)',  codigo: '1003' },
    /* Existen más servicios (autoescuela, ambulancia, servicio público…)
       pero NO tenemos sus códigos. Esta entrada los recoge sin fingir que
       sabemos cuál es el suyo: al elegirla no se puede comparar códigos y
       el expediente queda bloqueado pidiéndolo. */
    { id: 'otro',       label: 'Otro servicio',                       codigo: null }
  ];

  const servicio = (id) => SERVICIOS.find(s => s.id === id) || null;

  /** Los códigos se comparan como texto normalizado: «1000 » y «1000» son
      el mismo código, y « » no es ningún código. */
  function normCodigo(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  const leer = (exp, campo) => {
    const T = global.GTTramites;
    if (T && T.leer) return T.leer(exp, campo);
    if (!exp) return null;
    if (exp[campo] !== undefined && exp[campo] !== null) return exp[campo];
    return (exp.datos && exp.datos[campo] !== undefined) ? exp.datos[campo] : null;
  };

  const esSi = (v) => v === true || v === 'si' || v === 'sí' || v === 'SI';

  /**
   * Qué hay que hacer con este expediente en cuanto a servicio.
   *
   * @returns {{
   *   cambia:boolean, anterior:object|null, destino:object|null,
   *   codigoAnterior:string|null, codigoDestino:string|null,
   *   mismoCodigo:boolean, requiereItv:boolean,
   *   fichaCodigo:string|null, fichaEnDestino:boolean, fichaEnOrigen:boolean,
   *   confirmado:boolean, bloqueado:boolean, motivo:string, aviso:string|null
   * }}
   */
  function evaluar(exp) {
    const cambia = esSi(leer(exp, 'cambio_servicio'));

    const anterior = servicio(leer(exp, 'servicio_anterior'));
    const destino = servicio(leer(exp, 'servicio_destino'));
    const codigoAnterior = anterior ? normCodigo(anterior.codigo) : null;
    const codigoDestino = destino ? normCodigo(destino.codigo) : null;

    /* El código que la ficha técnica muestra HOY. Lo lee Gest-IA de la
       ficha o lo escribe el gestor mirándola: de ningún otro sitio. */
    const fichaCodigo = normCodigo(leer(exp, 'clasificacion_codigo'));
    const confirmado = esSi(leer(exp, 'servicio_itv_confirmado'));

    const base = {
      cambia, anterior, destino, codigoAnterior, codigoDestino,
      fichaCodigo, confirmado,
      mismoCodigo: false, requiereItv: false,
      fichaEnDestino: false, fichaEnOrigen: false,
      bloqueado: false, motivo: 'sin_cambio', aviso: null
    };

    // Sin cambio de servicio no hay nada que comprobar ni que bloquear.
    if (!cambia) return base;

    // Marcado el cambio, hacen falta los dos extremos para poder compararlos.
    if (!anterior || !destino) {
      return Object.assign(base, {
        bloqueado: true, motivo: 'faltan_servicios',
        aviso: 'Has marcado que el vehículo cambia de servicio: indica el '
          + 'servicio actual y el de destino para saber si hay que pasar por la ITV.'
      });
    }

    const etiquetas = anterior.label + ' → ' + destino.label;

    /* Un código sin confirmar NO es un «no hay problema»: es que no se
       puede decidir. Se bloquea y se pide, que es lo contrario de
       inventarlo. El gestor puede desbloquear a mano si lo comprueba él. */
    if (codigoAnterior === null || codigoDestino === null) {
      const cual = codigoAnterior === null ? anterior.label : destino.label;
      if (confirmado) {
        return Object.assign(base, {
          motivo: 'confirmado_por_gestor',
          aviso: 'Cambio de servicio ' + etiquetas + ' registrado. El código de '
            + '«' + cual + '» no está en el catálogo, y has confirmado tú que la '
            + 'ficha técnica está correcta.'
        });
      }
      return Object.assign(base, {
        bloqueado: true, motivo: 'codigo_sin_confirmar',
        aviso: 'No consta el código de clasificación de «' + cual + '»: solo están '
          + 'confirmados Particular y Taxi (1000), VTC (1041) y ASN (1003). '
          + 'Sin ese código no se puede saber si hay que pasar por la ITV. '
          + 'Pídeselo a la gestoría, o confírmalo tú si ya lo has comprobado.'
      });
    }

    // --- Los dos códigos son conocidos: ya se pueden comparar ---
    const mismoCodigo = codigoAnterior === codigoDestino;

    /* Mismo código = la ficha técnica no cambia = no hay nada que pedir en
       la ITV. Es el caso Taxi → Particular: se transfiere directamente y
       el cambio de servicio se registra igual. */
    if (mismoCodigo) {
      return Object.assign(base, {
        mismoCodigo: true, motivo: 'mismo_codigo',
        aviso: 'Cambio de servicio ' + etiquetas + ' registrado. Los dos usan el '
          + 'código de clasificación ' + codigoDestino + ', así que la ficha técnica '
          + 'no cambia: no hay que pasar por la ITV y se puede transferir.'
      });
    }

    // --- Códigos distintos: la ficha técnica TIENE que cambiar ---
    const fichaEnDestino = fichaCodigo !== null && fichaCodigo === codigoDestino;
    const fichaEnOrigen = fichaCodigo !== null && fichaCodigo === codigoAnterior;
    const avisoItv = 'El cliente debe solicitar en la ITV el cambio de clasificación '
      + codigoAnterior + '→' + codigoDestino + ' (' + etiquetas + '). '
      + 'La ficha técnica debe reflejar el código ' + codigoDestino + ' antes de transferir.';

    const conItv = Object.assign(base, {
      requiereItv: true, fichaEnDestino, fichaEnOrigen
    });

    // La ficha ya muestra el destino: hecho. Es la comprobación que manda.
    if (fichaEnDestino) {
      return Object.assign(conItv, {
        motivo: 'ficha_en_destino',
        aviso: 'La ficha técnica ya muestra el código ' + codigoDestino
          + ': el cambio de clasificación está hecho y se puede transferir.'
      });
    }

    // El gestor lo ha comprobado él con la ficha delante.
    if (confirmado) {
      return Object.assign(conItv, {
        motivo: 'confirmado_por_gestor',
        aviso: 'Cambio de clasificación ' + codigoAnterior + '→' + codigoDestino
          + ' confirmado a mano por el gestor.'
      });
    }

    if (fichaEnOrigen) {
      return Object.assign(conItv, {
        bloqueado: true, motivo: 'ficha_en_origen',
        aviso: avisoItv + ' Ahora mismo la ficha sigue en ' + codigoAnterior + '.'
      });
    }

    /* Ni el destino ni el origen: o no se ha leído el código, o es otro
       distinto. En los dos casos NO consta que el cambio esté hecho, y eso
       no se da por bueno. */
    return Object.assign(conItv, {
      bloqueado: true,
      motivo: fichaCodigo === null ? 'ficha_sin_codigo' : 'ficha_en_otro_codigo',
      aviso: avisoItv + (fichaCodigo === null
        ? ' No consta el código de la ficha técnica: léelo con Gest-IA o escríbelo mirándola.'
        : ' La ficha muestra ' + fichaCodigo + ', que no es ni el de origen ni el de destino: compruébalo.')
    });
  }

  /* Estados en los que el expediente ya se está tramitando o presentando.
     El bloqueo es para no llegar a ellos con la ficha técnica sin cambiar;
     volver atrás a «nuevo» o a «documentación» siempre se puede. */
  const ESTADOS_BLOQUEABLES = ['tramitacion', 'presentado', 'completado'];

  /** ¿Se puede llevar el expediente a ese estado? */
  function puedeIrA(exp, estado) {
    if (ESTADOS_BLOQUEABLES.indexOf(estado) === -1) return { puede: true, aviso: null };
    const r = evaluar(exp);
    return r.bloqueado
      ? { puede: false, aviso: r.aviso, motivo: r.motivo }
      : { puede: true, aviso: null };
  }

  global.GTServicio = {
    SERVICIOS: SERVICIOS,
    ESTADOS_BLOQUEABLES: ESTADOS_BLOQUEABLES,
    servicio: servicio,
    evaluar: evaluar,
    puedeIrA: puedeIrA
  };
})(typeof window !== 'undefined' ? window : globalThis);
