/* ============================================================
   GestoTrafic · Gest-IA · mapeo de la extracción al expediente
   ------------------------------------------------------------
   La Edge Function devuelve, por documento, qué leyó y con qué
   confianza. Aquí se traduce eso a los campos del trámite elegido
   del catálogo GT_TRAMITES.

   Nada de lo que sale de aquí es definitivo: son PROPUESTAS. El
   expediente nace en "pendiente de validación" y no entra en el
   flujo normal hasta que un gestor las revisa y confirma.
   ============================================================ */
(function (global) {
  'use strict';

  const T = global.GTTramites;

  /* Qué campo del expediente alimenta cada dato leído, según de qué
     documento venga. La clave es el tipo del checklist. */
  const MAPA = {
    ficha_tecnica: {
      marca:               'marca',
      modelo:              'modelo',
      matricula:           'matricula',
      fecha_matriculacion: 'fecha_matriculacion',
      combustible:         'combustible',
      cvf:                 'cvf',
      cilindrada:          'cilindrada',
      bastidor:            'bastidor'
    },
    permiso: {
      matricula: 'matricula',
      titular:   'titular_nombre'
    },
    contrato: {
      precio:    'precio_contrato',
      fecha:     'fecha_venta',
      vendedor:  'vendedor_nombre',
      comprador: 'comprador_nombre'
    },
    /* Los documentos de identidad dependen de a quién identifican:
       el prefijo del tipo (dni_comprador, cif_vendedor…) da la parte. */
    dni: {
      nombre:    '{parte}_nombre',
      apellidos: '{parte}_nombre',      // se concatena con el nombre
      numero:    '{parte}_nif',
      direccion: '{parte}_direccion'
    },
    cif: {
      razon_social: '{parte}_nombre',
      cif:          '{parte}_nif',
      domicilio:    '{parte}_direccion'
    }
  };

  const RANGO = { alta: 3, media: 2, baja: 1 };

  /** De `dni_comprador` saca `comprador`. */
  function parteDe(tipo) {
    const m = /^(?:dni|cif)_(.+)$/.exec(tipo);
    return m ? m[1] : null;
  }

  /** Normaliza el combustible a una de las opciones del catálogo. */
  function combustible(valor) {
    if (!valor) return valor;
    const v = String(valor).toLowerCase();
    if (v.includes('eléctric') || v.includes('electric')) return 'Eléctrico';
    if (v.includes('enchufable') || v.includes('phev')) return 'Híbrido enchufable';
    if (v.includes('híbrid') || v.includes('hibrid')) return 'Híbrido';
    if (v.includes('diés') || v.includes('dies') || v.includes('gasó') || v.includes('gasoleo')) return 'Diésel';
    if (v.includes('gasolina')) return 'Gasolina';
    if (v.includes('glp')) return 'GLP';
    if (v.includes('gnc')) return 'GNC';
    return valor;
  }

  const numero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  /**
   * Convierte las lecturas en propuestas por campo del expediente.
   * Si dos documentos aportan el mismo campo, gana el de más confianza;
   * a igualdad, el primero. Nunca gana un null sobre un valor leído.
   */
  function propuestas(tr, lecturas) {
    const campos = T.campos(tr).map(c => c.n);
    const out = {};

    const proponer = (campo, valor, conf, origen, nota) => {
      if (!campo) return;
      // Solo campos que este trámite tiene realmente.
      if (campos.indexOf(campo) === -1 && campo !== 'fecha_venta') return;

      const previo = out[campo];
      const hayValor = valor !== null && valor !== undefined && valor !== '';
      if (previo) {
        const previoTieneValor = previo.valor !== null && previo.valor !== '';
        if (previoTieneValor && !hayValor) return;
        if (previoTieneValor && RANGO[conf] <= RANGO[previo.confianza]) return;
      }
      out[campo] = { valor: hayValor ? valor : null, confianza: conf, origen, nota: nota || null };
    };

    (lecturas || []).forEach(doc => {
      if (!doc.extraido || !doc.campos) return;
      const parte = parteDe(doc.tipo);
      const mapa = MAPA[doc.perfil];
      if (!mapa) return;

      // Nombre + apellidos van al mismo campo: se juntan antes de proponer.
      if (doc.perfil === 'dni' && parte) {
        const n = doc.campos.nombre || {}, a = doc.campos.apellidos || {};
        const completo = [n.valor, a.valor].filter(Boolean).join(' ').trim();
        const conf = RANGO[n.confianza || 'baja'] < RANGO[a.confianza || 'baja'] ? n.confianza : a.confianza;
        proponer(parte + '_nombre', completo || null, completo ? conf : 'baja', doc.tipo,
          completo ? (n.nota || a.nota) : 'No se pudo leer el nombre completo');
      }

      Object.keys(mapa).forEach(leido => {
        if (doc.perfil === 'dni' && (leido === 'nombre' || leido === 'apellidos')) return;
        const dato = doc.campos[leido];
        if (!dato) return;

        let campo = mapa[leido];
        if (campo.indexOf('{parte}') !== -1) {
          if (!parte) return;
          campo = campo.replace('{parte}', parte);
        }

        let valor = dato.valor;
        if (campo === 'combustible') valor = combustible(valor);
        if (campo === 'precio_contrato' || campo === 'cvf') valor = numero(valor);
        if (campo === 'cilindrada') { const n = numero(valor); valor = n === null ? null : Math.round(n); }

        proponer(campo, valor, dato.confianza, doc.tipo, dato.nota);
      });
    });

    /* Una factura de venta implica que quien vende es una empresa. */
    const conFactura = (lecturas || []).some(d => d.tipo === 'factura_venta' || d.tipo === 'cif_vendedor');
    if (conFactura && campos.indexOf('vendedor_tipo') !== -1) {
      out.vendedor_tipo = { valor: 'empresa', confianza: 'alta', origen: 'checklist',
        nota: 'La venta se documenta con factura de empresa.' };
    }

    return out;
  }

  /** Separa las propuestas en columnas propias y `datos` jsonb, como hace el alta manual. */
  function aExpediente(tr, props, datosPrevios) {
    const fila = {}, datos = Object.assign({}, datosPrevios || {});
    const porNombre = {};
    T.campos(tr).forEach(c => { porNombre[c.n] = c; });

    Object.keys(props).forEach(campo => {
      const valor = props[campo].valor;
      if (valor === null) return;                 // un hueco se deja en blanco
      const def = porNombre[campo];
      if (def && def.col) fila[campo] = valor;
      else datos[campo] = valor;
    });

    fila.datos = datos;
    return fila;
  }

  /** Campos obligatorios del trámite que Gest-IA no ha podido rellenar. */
  function huecos(tr, props) {
    return T.campos(tr)
      .filter(c => c.req && (!props[c.n] || props[c.n].valor === null))
      .map(c => ({ campo: c.n, etiqueta: c.l }));
  }

  global.GTGestIA = {
    propuestas: propuestas,
    aExpediente: aExpediente,
    huecos: huecos
  };
})(window);
