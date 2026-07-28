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
      nombre:    '{parte}_nombre_pila',
      apellido1: '{parte}_apellido1',
      apellido2: '{parte}_apellido2',
      numero:    '{parte}_nif',
      sexo:      '{parte}_sexo',
      fecha_nacimiento: '{parte}_nacimiento',
      fecha_caducidad:  '{parte}_caducidad_nif',
      direccion: '{parte}_direccion',
      // Desglose del domicilio · lo pide OEGAM en campos separados
      via_nombre:   '{parte}_via',
      via_numero:   '{parte}_via_numero',
      via_escalera: '{parte}_escalera',
      via_piso:     '{parte}_piso',
      via_puerta:   '{parte}_puerta',
      via_letra:    '{parte}_letra',
      municipio: '{parte}_municipio',
      provincia: '{parte}_provincia',
      cp:        '{parte}_cp'
    },
    cif: {
      razon_social: '{parte}_nombre',
      cif:          '{parte}_nif',
      domicilio:    '{parte}_direccion'
    }
  };

  /* Campos del DNI que viven en `datos` y no están en el formulario del
     trámite. Se completan y se corrigen en la pestaña de exportación, que es
     donde importan; meterlos en la ficha serían treinta campos más que casi
     nadie tocaría. */
  const CAMPOS_PERSONA = [
    'nombre_pila', 'apellido1', 'apellido2', 'sexo', 'nacimiento', 'caducidad_nif',
    'via', 'via_numero', 'escalera', 'piso', 'puerta', 'letra',
    'municipio', 'provincia', 'cp'
  ];

  /* Sexo · códigos del formato del Colegio, confirmados por la gestoría:
       V = hombre · H = mujer · X = persona jurídica

     La H de «mujer» es la trampa: se parece a «hombre» y la M que uno
     escribiría por instinto es justo la del otro. Por eso al modelo se le
     pide la PALABRA («hombre» / «mujer») y la traducción vive aquí sola,
     donde se lee de un vistazo y se prueba. Cualquier otra cosa → null. */
  const SEXO = { hombre: 'V', varon: 'V', mujer: 'H' };

  function sexoDe(valor) {
    if (!valor) return null;
    const v = String(valor).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim();
    return SEXO[v] || null;
  }

  const RANGO = { alta: 3, media: 2, baja: 1 };

  /* Campos que el expediente guarda en `datos` pero que no están en el
     formulario del trámite. Sin esta lista, `proponer` los descartaría por no
     encontrarlos en el catálogo. */
  const EXTRA = ['fecha_venta', 'tipo_vehiculo'].concat(
    (T.PARTES || ['vendedor', 'comprador']).reduce(
      (acc, p) => acc.concat(CAMPOS_PERSONA.map(c => p + '_' + c)), []));

  /* Clasificación de la ficha técnica → tipo de vehículo del Anexo I.
     Solo lo que se reconoce sin dudar. Un "VEHÍCULO MIXTO ADAPTABLE" o una
     furgoneta no están en el Anexo I con estos tipos, así que devuelve null y
     lo elige el gestor: acercarse al tipo equivocado cambia la tabla de
     depreciación y, con ella, el impuesto. */
  const CLASIFICACION = [
    [/AUTOCARAVANA|VIVIENDA|CAMPER/, 'autocaravana'],
    [/QUAD|CUATRICICLO/,             'quad'],
    [/BUGGY/,                        'buggy'],
    [/MOTOCICLETA|CICLOMOTOR|\bMOTO\b/, 'moto'],
    [/TURISMO/,                      'coche']
  ];

  /** Tipo de vehículo del CRM a partir de la clasificación de la ficha. */
  function tipoVehiculo(clasificacion, combustibleLeido) {
    if (!clasificacion) return null;
    const c = String(clasificacion).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const par = CLASIFICACION.find(([re]) => re.test(c));
    if (!par) return null;
    // Una moto eléctrica tarifa por kW y no por cilindrada: es otra tabla.
    if (par[1] === 'moto' && /el[eé]ctric/i.test(String(combustibleLeido || ''))) return 'moto_electrica';
    return par[1];
  }

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
      // Solo campos que este trámite tiene realmente, más los que vive el
      // expediente sin estar en el formulario (ver EXTRA).
      if (campos.indexOf(campo) === -1 && EXTRA.indexOf(campo) === -1) return;

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

      /* El CRM enseña el nombre completo en un solo campo y OEGAM lo quiere
         partido en tres. Se guardan las DOS formas: las tres piezas tal y
         como las imprime el DNI, y su unión para lo que ya existía (la ficha,
         el contrato, el buscador). Unir es seguro; partir es lo que no se
         hace, y por eso el nombre completo se compone de las piezas leídas y
         nunca al revés. */
      if (doc.perfil === 'dni' && parte) {
        const n = doc.campos.nombre || {};
        const a1 = doc.campos.apellido1 || {};
        const a2 = doc.campos.apellido2 || {};
        const completo = [n.valor, a1.valor, a2.valor].filter(Boolean).join(' ').trim();
        const peor = [n, a1].reduce((p, c) =>
          RANGO[c.confianza || 'baja'] < RANGO[p.confianza || 'baja'] ? c : p, n);
        proponer(parte + '_nombre', completo || null, completo ? peor.confianza : 'baja', doc.tipo,
          completo ? (n.nota || a1.nota) : 'No se pudo leer el nombre completo');
      }

      Object.keys(mapa).forEach(leido => {
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
        // «hombre»/«mujer» → V/H. Cualquier otra cosa se descarta.
        if (/_sexo$/.test(campo)) valor = sexoDe(valor);

        proponer(campo, valor, dato.confianza, doc.tipo, dato.nota);
      });
    });

    /* Qué documento se ha aportado dice qué es cada parte: un CIF identifica
       a una empresa, y una factura de venta la emite una empresa. No es una
       lectura del modelo sino del checklist, así que va con confianza alta
       y su origen declarado — pero sigue siendo propuesta: la valida el
       gestor como todo lo demás.

       Encaja con la exención de ITP que ya existe: con `vendedor_tipo` en
       empresa, la pestaña de ITP avisa de que la venta con factura suele
       quedar exenta. El toggle lo marca el gestor, nunca esto. */
    const hay = (...tipos) => (lecturas || []).some(d => tipos.indexOf(d.tipo) !== -1);
    const marcarEmpresa = (parte, nota) => {
      if (campos.indexOf(parte + '_tipo') === -1) return;
      out[parte + '_tipo'] = { valor: 'empresa', confianza: 'alta', origen: 'checklist', nota: nota };
      /* Una persona jurídica es X en el formato del Colegio. No es una
         lectura del documento sino una consecuencia de que la parte sea una
         empresa, así que se propone con el mismo origen que el tipo. */
      out[parte + '_sexo'] = {
        valor: 'X', confianza: 'alta', origen: 'checklist',
        nota: 'X = persona jurídica.'
      };
    };

    if (hay('factura_venta', 'cif_vendedor')) {
      marcarEmpresa('vendedor', 'La venta se documenta con factura o CIF de empresa.');
    }
    if (hay('cif_comprador')) {
      marcarEmpresa('comprador', 'Se ha aportado el CIF de la empresa compradora.');
    }

    /* --- Los dos datos que antes ponía el gestor a mano ---
       Se proponen igual que el resto: con su confianza y su origen, y en
       blanco si no se leen. Que estén aquí no los convierte en confirmados;
       los valida el gestor como todo lo demás. */

    // 1 · Tipo de vehículo: sale de la clasificación de la ficha técnica.
    const ficha = (lecturas || []).find(d => d.extraido && d.perfil === 'ficha_tecnica');
    if (ficha && ficha.campos) {
      const cl = ficha.campos.clasificacion || {};
      const tipo = tipoVehiculo(cl.valor, (ficha.campos.combustible || {}).valor);
      if (tipo) {
        proponer('tipo_vehiculo', tipo, cl.confianza || 'media', ficha.tipo,
          'Clasificación de la ficha técnica: «' + cl.valor + '».');
      } else if (cl.valor) {
        proponer('tipo_vehiculo', null, 'baja', ficha.tipo,
          'La ficha dice «' + cl.valor + '», que no encaja con ningún tipo del Anexo I: elígelo tú.');
      }
    }

    /* 2 · CCAA: la del domicilio del COMPRADOR, que es quien liquida el ITP.
       Sale del reverso de su DNI (o del domicilio social si compra una
       empresa). Si la provincia no se lee o no se reconoce, queda en blanco:
       la CCAA cambia el tipo impositivo y una equivocada sale cara. */
    const idComprador = (lecturas || []).find(d =>
      d.extraido && (d.tipo === 'dni_comprador' || d.tipo === 'cif_comprador'));
    if (idComprador && idComprador.campos && campos.indexOf('ccaa') !== -1) {
      const pr = idComprador.campos.provincia || {};
      const ccaa = global.GT_CCAA_DE_PROVINCIA ? global.GT_CCAA_DE_PROVINCIA(pr.valor) : null;
      if (ccaa) {
        proponer('ccaa', ccaa, pr.confianza || 'media', idComprador.tipo,
          'Residencia del comprador: ' + pr.valor + '.');
      } else if (pr.valor) {
        proponer('ccaa', null, 'baja', idComprador.tipo,
          '«' + pr.valor + '» no es una provincia reconocida: elige la CCAA tú.');
      }
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

  /**
   * Caras que faltan, en cristiano: «DNI / NIE del comprador · falta el
   * reverso». No es lo mismo que un campo ilegible — el domicilio está en
   * blanco porque nadie subió esa cara, y eso se arregla subiéndola.
   */
  function avisosCaras(tr, lecturas) {
    const etiqueta = {};
    T.docsDe(tr, {}).forEach(d => { etiqueta[d.tipo] = d.label; });

    return (lecturas || [])
      .filter(d => d.extraido && d.caras_faltan && d.caras_faltan.length)
      .map(d => ({
        tipo: d.tipo,
        documento: etiqueta[d.tipo] || d.tipo,
        caras: d.caras_faltan,
        texto: (etiqueta[d.tipo] || d.tipo) + ' · falta el ' + d.caras_faltan.join(' y el ')
      }));
  }

  global.GTGestIA = {
    propuestas: propuestas,
    aExpediente: aExpediente,
    huecos: huecos,
    avisosCaras: avisosCaras,
    CAMPOS_PERSONA: CAMPOS_PERSONA,
    sexoDe: sexoDe
  };
})(window);
