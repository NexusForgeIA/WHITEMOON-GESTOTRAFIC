/* ============================================================
   GestoTrafic · Exportador OEGAM (FORMATO_GA) · Transferencia
   ------------------------------------------------------------
   Genera el XML que la gestoría IMPORTA en el programa del Colegio
   de Madrid, para no reteclear el expediente.

   La referencia de estructura es data/oegam/plantilla-transferencia.xml
   (fichero FICTICIO aportado por la gestoría). De ahí salen —verbatim—
   los nombres de etiqueta, su ORDEN, la codificación ISO-8859-1, el
   formato de fechas y los tags vacíos self-closing.

   ⛔ REGLA DE LA CASA (CLAUDE.md): aquí no se inventa NADA.

   Este XML inscribe un cambio de titularidad ante la DGT. Un campo
   plausible pero falso no lo revisa nadie; un campo vacío se ve. Por eso:

     · Lo que asigna OEGAM/DGT al importar va VACÍO siempre (ASIGNA_OEGAM).
     · PROVINCIA sale de la tabla oficial de códigos. Provincia con dos
       códigos históricos posibles → VACÍA y marcada, que la elija el gestor.
     · SIGLAS_DIRECCION (tipo de vía) va SIEMPRE vacía mientras
       `SIGLAS` esté sin cargar: el código es numérico y su tabla la
       publica OEGAM. Se detecta la ETIQUETA («CALLE», «AVENIDA») y se
       dice cuál es, para que el gestor busque el código en dos segundos.
     · Los datos de una PERSONA —sexo, nacimiento, caducidad y el desglose
       del domicilio— salen de su DNI, leído por Gest-IA a dos caras. Lo
       que no se lea queda vacío y marcado; del texto libre NO se deducen.
     · Nombre y apellidos de un particular se separan solo si vienen ya
       separados (del DNI o de la ficha del CRM). De una cadena suelta no.
     · El sexo solo admite V (hombre), H (mujer) o X (persona jurídica).

   Nada de lo que sale de aquí se presenta solo: el gestor revisa el XML,
   completa lo marcado y lo importa él.
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     1 · CATÁLOGOS OFICIALES
     ============================================================ */

  /* --- Provincias · código de letra ------------------------------------
     Es el código provincial de la DGT (el de las matrículas anteriores a
     2000, que sigue identificando la Jefatura). La plantilla confirma tres:
     M=Madrid, B=Barcelona, MA=Málaga.

     Las provincias que cambiaron de código y conviven con el antiguo NO se
     resuelven aquí: van con `ambiguo` y el exportador deja el campo VACÍO
     con los dos candidatos en el informe. Elegir uno a ciegas es
     exactamente lo que prohíbe la regla de la casa, y el gestor lo
     resuelve mirando su propio programa. */
  const PROVINCIAS = {
    'A CORUNA': 'C', 'LA CORUNA': 'C', 'CORUNA': 'C',
    'ALAVA': 'VI', 'ARABA': 'VI',
    'ALBACETE': 'AB',
    'ALICANTE': 'A', 'ALACANT': 'A',
    'ALMERIA': 'AL',
    'ASTURIAS': 'O', 'OVIEDO': 'O',
    'AVILA': 'AV',
    'BADAJOZ': 'BA',
    'BALEARES': { ambiguo: ['PM', 'IB'] },
    'ILLES BALEARS': { ambiguo: ['PM', 'IB'] },
    'ISLAS BALEARES': { ambiguo: ['PM', 'IB'] },
    'BARCELONA': 'B',
    'BURGOS': 'BU',
    'CACERES': 'CC',
    'CADIZ': 'CA',
    'CANTABRIA': 'S', 'SANTANDER': 'S',
    'CASTELLON': 'CS', 'CASTELLO': 'CS',
    'CEUTA': 'CE',
    'CIUDAD REAL': 'CR',
    'CORDOBA': 'CO',
    'CUENCA': 'CU',
    'GIRONA': { ambiguo: ['GI', 'GE'] }, 'GERONA': { ambiguo: ['GI', 'GE'] },
    'GRANADA': 'GR',
    'GUADALAJARA': 'GU',
    'GUIPUZCOA': 'SS', 'GIPUZKOA': 'SS',
    'HUELVA': 'H',
    'HUESCA': 'HU',
    'JAEN': 'J',
    'LEON': 'LE',
    'LLEIDA': 'L', 'LERIDA': 'L',
    'LUGO': 'LU',
    'MADRID': 'M',
    'MALAGA': 'MA',
    'MELILLA': 'ML',
    'MURCIA': 'MU',
    'NAVARRA': 'NA', 'PAMPLONA': 'NA',
    'OURENSE': { ambiguo: ['OU', 'OR'] }, 'ORENSE': { ambiguo: ['OU', 'OR'] },
    'PALENCIA': 'P',
    'LAS PALMAS': 'GC',
    'PONTEVEDRA': 'PO',
    'LA RIOJA': 'LO', 'LOGRONO': 'LO',
    'SALAMANCA': 'SA',
    'SANTA CRUZ DE TENERIFE': 'TF', 'TENERIFE': 'TF',
    'SEGOVIA': 'SG',
    'SEVILLA': 'SE',
    'SORIA': 'SO',
    'TARRAGONA': 'T',
    'TERUEL': 'TE',
    'TOLEDO': 'TO',
    'VALENCIA': 'V',
    'VALLADOLID': 'VA',
    'VIZCAYA': 'BI', 'BIZKAIA': 'BI',
    'ZAMORA': 'ZA',
    'ZARAGOZA': 'Z'
  };

  /* --- Tipos de vía · SIGLAS_DIRECCION ---------------------------------
     VACÍO A PROPÓSITO, y no es un olvido.

     OEGAM identifica el tipo de vía con un CÓDIGO NUMÉRICO de su propio
     catálogo. La plantilla pone `41` en las tres direcciones —incluida una
     que se llama «VIA EJEMPLO»—, así que ahí `41` es relleno, no la prueba
     de que 41 sea CALLE. Deducir la tabla de eso sería inventarla, y un
     tipo de vía equivocado va impreso en el permiso de circulación.

     PARA ACTIVARLO: pide a la gestoría la tabla de tipos de vía de OEGAM
     y rellena aquí `ETIQUETA_DEL_CATALOGO: 'codigo'`, p. ej.:

         const SIGLAS = { CALLE: '41', AVENIDA: '02', PLAZA: '58' };

     Mientras esté vacío, el exportador emite SIGLAS_DIRECCION_* vacío y
     apunta en el informe qué tipo de vía ha detectado en cada dirección,
     para que el gestor ponga el código sin releer el domicilio. */
  const SIGLAS = {};

  /* Detección de la ETIQUETA del tipo de vía en una dirección de texto
     libre. Esto NO es el código: es lo que se le enseña al gestor y lo que
     se busca en `SIGLAS` cuando el catálogo esté cargado. El orden importa
     —las formas largas antes que las cortas— para que «AVENIDA» no la cace
     el patrón de «AV». */
  const TIPOS_VIA = [
    { etiqueta: 'AVENIDA',      re: /^(AVENIDA|AVDA|AVD|AVGDA|AV)\b\.?/ },
    { etiqueta: 'CALLE',        re: /^(CALLE|CALLE\s|CL|C\/|C\.)\.?/ },
    { etiqueta: 'PLAZA',        re: /^(PLAZA|PLZA|PZA|PLZ|PL)\b\.?/ },
    { etiqueta: 'PASEO',        re: /^(PASEO|PSEO|PSO|PS)\b\.?/ },
    { etiqueta: 'CARRETERA',    re: /^(CARRETERA|CTRA|CRTA|CR)\b\.?/ },
    { etiqueta: 'CAMINO',       re: /^(CAMINO|CMNO|CM)\b\.?/ },
    { etiqueta: 'TRAVESIA',     re: /^(TRAVESIA|TRVA|TRAV|TR)\b\.?/ },
    { etiqueta: 'RONDA',        re: /^(RONDA|RDA|RD)\b\.?/ },
    { etiqueta: 'GLORIETA',     re: /^(GLORIETA|GTA)\b\.?/ },
    { etiqueta: 'PASAJE',       re: /^(PASAJE|PSJE|PJE)\b\.?/ },
    { etiqueta: 'RAMBLA',       re: /^(RAMBLA|RBLA)\b\.?/ },
    { etiqueta: 'BULEVAR',      re: /^(BULEVAR|BLVR)\b\.?/ },
    { etiqueta: 'ALAMEDA',      re: /^(ALAMEDA|ALMD)\b\.?/ },
    { etiqueta: 'CUESTA',       re: /^(CUESTA|CSTA)\b\.?/ },
    { etiqueta: 'CALLEJON',     re: /^(CALLEJON|CJON)\b\.?/ },
    { etiqueta: 'URBANIZACION', re: /^(URBANIZACION|URBANIZACIO|URB)\b\.?/ },
    { etiqueta: 'POLIGONO',     re: /^(POLIGONO|POLIG|POL|PG)\b\.?/ },
    { etiqueta: 'PARQUE',       re: /^(PARQUE|PQUE)\b\.?/ },
    { etiqueta: 'BARRIO',       re: /^(BARRIO|BRRO)\b\.?/ },
    { etiqueta: 'LUGAR',        re: /^(LUGAR|LGAR|LG)\b\.?/ },
    { etiqueta: 'VIA',          re: /^(VIA)\b\.?/ }
  ];

  /* --- Campos que asigna OEGAM/DGT al importar -------------------------
     Van VACÍOS siempre. Rellenarlos desde aquí sería inventar un número de
     documento o un código electrónico que asigna la plataforma. */
  const ASIGNA_OEGAM = [
    'NUMERO_DOCUMENTO',
    'CODIGO_ELECTRONICO_TRANSFERENCIA',
    'CODIGO_ELECTRONICO_MATRICULACION',
    'FECHA_PRESENTACION',
    'FECHA_DEVOLUCION'
  ];

  /* --- Constantes de la plantilla --------------------------------------
     Copiadas VERBATIM de plantilla-transferencia.xml. Son los valores de
     una transferencia estándar y no se calculan a partir del expediente.
     Su SIGNIFICADO está sin verificar (nadie nos ha pasado el catálogo de
     códigos), así que viven aquí juntas, señaladas, y salen en el informe
     para que la gestoría las confirme una vez y para siempre. */
  const CONSTANTES = {
    TIPO_DGT:                   'TRANSMISION ELECTRONICA',
    CAMBIO_SERVICIO:            'NO',
    MODO_ADJUDICACION:          '1',
    TIPO_TRANSFERENCIA:         '1',
    DECLARACION_RESPONSABILIDAD:'NO',
    TIPO_ID_VEHICULO:           '40',
    MODELO_ITP:                 '620',
    NO_SUJETO_ITP:              'NO',
    EXENTO_CEM:                 'NO',
    EXENTO_IEDMT:               'NO',
    NO_SUJETO_IEDMT:            'NO',
    NUMERO_TITULARES:           '1',

    /* Códigos de sexo del formato, confirmados por la gestoría:
         V = hombre · H = mujer · X = persona jurídica
       La de mujer es H, NO M. La M no significa nada aquí, y es justo la
       letra que uno pondría por instinto —o la que trae el propio DNI, donde
       M es «masculino»—. Se comprueba contra esta lista y lo que no sea uno
       de los tres se queda vacío. */
    SEXOS:                      ['V', 'H', 'X'],
    SEXO_PERSONA_JURIDICA:      'X'
  };

  /* Etiquetas legibles para el informe. Solo las de campos que el gestor
     puede tener que tocar: no hace falta traducir las 140. */
  const ETIQUETAS = {
    NIF: 'NIF de la gestoría',
    NOMBRE: 'Nombre de la gestoría',
    PROFESIONAL: 'Nº de profesional colegiado',
    PROVINCIA: 'Provincia de la gestoría',
    MATRICULA: 'Matrícula',
    NUMERO_BASTIDOR: 'Nº de bastidor (VIN)',
    MARCA: 'Marca',
    MODELO: 'Modelo',
    FECHA_MATRICULACION: '1ª matriculación',
    FECHA_CONTRATO: 'Fecha del contrato o factura',
    JEFATURA_PROVINCIAL: 'Jefatura provincial'
  };

  /* --- Obligatorios para que la importación sirva de algo --------------
     Criterio de GestoTrafic, no de OEGAM: es la lista que la gestoría debe
     confirmar. Vacío uno de estos, el XML se genera igual pero el panel
     avisa antes de descargarlo. */
  const OBLIGATORIOS = [
    'NIF', 'NOMBRE', 'PROFESIONAL', 'PROVINCIA',
    'MATRICULA',
    'DNI_ADQUIRIENTE', 'APELLIDO1_RAZON_SOCIAL_ADQUIRIENTE', 'SEXO_ADQUIRIENTE',
    'DNI_TRANSMITENTE', 'APELLIDO1_RAZON_SOCIAL_TRANSMITENTE', 'SEXO_TRANSMITENTE',
    'NUMERO_BASTIDOR', 'MARCA', 'MODELO', 'FECHA_MATRICULACION',
    'FECHA_CONTRATO'
  ];

  /* ============================================================
     2 · Utilidades
     ============================================================ */

  const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

  /** Mayúsculas sin acentos ni signos, para comparar contra los catálogos. */
  function norm(texto) {
    if (vacio(texto)) return '';
    return String(texto)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9\/. ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* El XML va en mayúsculas como la plantilla. Los acentos SÍ se conservan:
     ISO-8859-1 los representa y el nombre es el nombre. */
  function mayus(texto) {
    if (vacio(texto)) return '';
    return String(texto).toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /** AAAA-MM-DD (o Date) → DD/MM/AAAA. Formato del cuerpo del XML. */
  function fechaDDMMAAAA(valor) {
    const d = aFecha(valor);
    if (!d) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /** MM/DD/AAAA · SOLO para el atributo FechaCreacion, que va al revés. */
  function fechaMMDDAAAA(valor) {
    const d = aFecha(valor);
    if (!d) return '';
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear();
  }

  const pad = (n) => (n < 10 ? '0' : '') + n;

  function aFecha(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return isNaN(+valor) ? null : valor;
    const s = String(valor).trim();
    // AAAA-MM-DD se parte a mano: `new Date('2020-01-01')` es UTC y en
    // España puede retroceder al día 31 anterior.
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const d = new Date(s);
    return isNaN(+d) ? null : d;
  }

  /** Código de provincia, o el motivo por el que no se puede poner. */
  function codigoProvincia(nombre) {
    const k = norm(nombre);
    if (!k) return { codigo: '', motivo: null };
    const c = PROVINCIAS[k];
    if (!c) return { codigo: '', motivo: '«' + nombre + '» no está en la tabla de provincias' };
    if (typeof c === 'string') return { codigo: c, motivo: null };
    return {
      codigo: '',
      motivo: '«' + nombre + '» tiene dos códigos históricos (' + c.ambiguo.join(' o ')
        + '): elige el que use tu programa'
    };
  }

  /* ============================================================
     3 · Dirección
     ------------------------------------------------------------
     El CRM guarda el domicilio como TEXTO LIBRE («Calle Mieses 1,
     Majadahonda») y OEGAM lo quiere descompuesto en once campos.

     Aquí solo se extrae lo que se lee sin interpretar: el tipo de vía si
     encabeza la cadena, el nombre de la vía, el número y el código postal
     (cinco dígitos seguidos no son otra cosa). Letra, escalera, piso,
     puerta, bloque, km y hm NO se sacan del texto libre: quedan vacíos y
     marcados. Municipio y provincia solo salen de la FICHA DEL CLIENTE,
     que los tiene en columnas propias; del texto no se adivinan.
     ============================================================ */
  function partirDireccion(texto) {
    const out = { tipoVia: '', via: '', numero: '', cp: '', restoSinUsar: '' };
    if (vacio(texto)) return out;

    let s = mayus(texto);

    // El CP es lo único inequívoco: cinco dígitos aislados.
    const mcp = /(?:^|[\s,])(\d{5})(?=$|[\s,])/.exec(s);
    if (mcp) {
      out.cp = mcp[1];
      s = (s.slice(0, mcp.index) + ' ' + s.slice(mcp.index + mcp[0].length)).trim();
    }

    // Solo la primera parte, antes de la coma, describe la vía. Lo que
    // venga detrás (municipio, provincia) NO se reparte a ciegas.
    const partes = s.split(',');
    let via = partes.shift().trim();
    const cola = [partes.join(', ').trim()];

    const nv = norm(via);
    const tipo = TIPOS_VIA.find(t => t.re.test(nv));
    if (tipo) {
      out.tipoVia = tipo.etiqueta;
      via = via.replace(/^\s*[A-Za-zÀ-ÿ\/.]+\.?\s*/, '').trim();
    }

    /* El NOMBRE de la vía es lo que va ANTES del primer número, y solo eso.
       En «SIETE VIENTOS 39 PBJ» el nombre es «SIETE VIENTOS»: el 39 es el
       portal y «PBJ» la planta. Antes se quitaba el número y se dejaba
       «SIETE VIENTOS PBJ» como nombre de calle, que no es ninguna calle.

       Lo que sigue al número NO se reparte en piso/puerta: eso lo lee
       Gest-IA del DNI, que está viendo el documento. Aquí solo se aparta,
       para que no contamine el nombre, y se devuelve como `restoSinUsar`
       para que el informe lo enseñe. */
    const mnum = /(?:^|[\s,])(?:N[ºO°.]?\s*)?(\d{1,4})(?=$|[\s,])/.exec(via);
    if (mnum) {
      out.numero = mnum[1];
      cola.unshift(via.slice(mnum.index + mnum[0].length).replace(/^[\s,]+/, '').trim());
      via = via.slice(0, mnum.index).replace(/[\s,]+$/, '').trim();
    }

    out.via = via;
    out.restoSinUsar = cola.filter(Boolean).join(', ');
    return out;
  }

  /* ============================================================
     4 · Las partes del expediente
     ============================================================ */

  const leer = (exp, campo) => {
    const T = global.GTTramites;
    if (T && T.leer) return T.leer(exp, campo);
    if (!exp) return null;
    if (exp[campo] !== undefined && exp[campo] !== null) return exp[campo];
    return (exp.datos && exp.datos[campo] !== undefined) ? exp.datos[campo] : null;
  };

  /** Ficha del CRM cuyo NIF coincide con el de esta parte. Coincidencia
      EXACTA de documento, no parecido de nombre: de ahí salen el municipio,
      el CP y la provincia, que en texto libre no se adivinan. */
  function clienteDe(nif, clientes) {
    const n = norm(nif).replace(/[^A-Z0-9]/g, '');
    if (!n || !Array.isArray(clientes)) return null;
    return clientes.find(c => norm(c.nif).replace(/[^A-Z0-9]/g, '') === n) || null;
  }

  /** El primer valor que no esté vacío. */
  const primero = (...vs) => {
    for (const v of vs) if (!vacio(v)) return v;
    return '';
  };

  /**
   * Reúne los datos de una parte (comprador → adquiriente, vendedor →
   * transmitente).
   *
   * Tres fuentes, en este orden y por este motivo:
   *
   *   1. Lo que Gest-IA leyó del DNI (o corrigió el gestor), en `datos`.
   *      Es el documento oficial de esa persona: manda.
   *   2. La ficha de cliente del CRM, cruzada por NIF EXACTO. Tiene
   *      municipio, CP y provincia en columnas propias.
   *   3. El domicilio en texto libre del expediente, partido con cuidado.
   *      Es el último recurso y solo aporta vía, número y CP.
   *
   * Lo que no salga de ninguna de las tres se queda vacío y sale en el
   * informe. Nunca se rellena por parecido.
   */
  function parte(exp, prefijo, clientes, hoy) {
    const d = (campo) => leer(exp, prefijo + '_' + campo);

    const esEmpresa = d('tipo') === 'empresa';
    const nombre = d('nombre');
    const nif = d('nif');
    const cli = clienteDe(nif, clientes);
    const libre = partirDireccion(d('direccion'));

    /* --- Nombre y apellidos ---
       Empresa → la razón social entera en APELLIDO1, que es lo que pide el
       formato (APELLIDO1_RAZON_SOCIAL).

       Particular → las tres piezas tal y como las lee Gest-IA del DNI, que
       las imprime separadas. Si no hay lectura, la ficha del cliente. Y si
       tampoco, VACÍO: de «José María de la Fuente Ruiz» en un solo campo no
       se deduce dónde acaba el nombre, y partirlo por un espacio inscribiría
       a otra persona. */
    let ape1 = '', ape2 = '', pila = '', avisoNombre = null;

    if (esEmpresa) {
      ape1 = mayus(nombre);
    } else if (!vacio(d('apellido1'))) {
      pila = mayus(d('nombre_pila'));
      ape1 = mayus(d('apellido1'));
      ape2 = mayus(d('apellido2'));
    } else if (cli && !vacio(cli.nombre) && !vacio(cli.apellidos)) {
      pila = mayus(cli.nombre);
      const trozos = mayus(cli.apellidos).split(' ').filter(Boolean);
      if (trozos.length === 2) {
        ape1 = trozos[0];
        ape2 = trozos[1];
      } else {
        // Un apellido compuesto («DE LA FUENTE RUIZ») no se parte por el
        // espacio: entero en APELLIDO1 y que el gestor lo reparta.
        ape1 = trozos.join(' ');
        if (trozos.length > 2) {
          avisoNombre = 'los apellidos van juntos en APELLIDO1 (parecen compuestos): sepáralos si procede';
        }
      }
    } else if (!vacio(nombre)) {
      avisoNombre = 'el CRM guarda «' + nombre + '» en un solo campo y el DNI no se ha leído: '
        + 'reparte nombre y apellidos';
    }

    /* --- Sexo · V hombre · H mujer · X persona jurídica ---
       Solo se acepta uno de los tres códigos. Una empresa es X porque lo es,
       no porque lo diga un documento. */
    let sexo = mayus(d('sexo'));
    if (CONSTANTES.SEXOS.indexOf(sexo) === -1) {
      sexo = esEmpresa ? CONSTANTES.SEXO_PERSONA_JURIDICA : '';
    }

    /* --- Domicilio ---
       El desglose fino (escalera, piso, puerta, letra) SOLO sale del DNI:
       del texto libre no se saca, porque en «SIETE VIENTOS 39 PBJ» nada
       distingue una planta de un nombre de calle sin ver el documento. */
    const dir = {
      tipoVia: libre.tipoVia,
      via: mayus(primero(d('via'), libre.via)),
      numero: mayus(primero(d('via_numero'), libre.numero)),
      escalera: mayus(d('escalera')),
      piso: mayus(d('piso')),
      puerta: mayus(d('puerta')),
      letra: mayus(d('letra')),
      restoSinUsar: libre.restoSinUsar,
      // ¿Hay desglose de verdad, o solo lo que se pudo raspar del texto?
      delDni: !vacio(d('via'))
    };

    const provNombre = primero(d('provincia'), cli ? cli.provincia : null);
    const prov = codigoProvincia(provNombre);

    /* --- Caducidad del DNI ---
       Un DNI caducado no lo rechaza este exportador: lo AVISA. Quien decide
       si se puede tramitar con él es el gestor, y para eso necesita verlo
       antes de importar, no descubrirlo en la ventanilla. */
    const caducidad = aFecha(d('caducidad_nif'));
    const caducado = !!(caducidad && hoy && caducidad < hoy);

    return {
      esEmpresa,
      nombreCompleto: nombre,
      dni: mayus(nif),
      sexo,
      ape1, ape2, pila, avisoNombre,
      nacimiento: fechaDDMMAAAA(d('nacimiento')),
      caducidadNif: fechaDDMMAAAA(d('caducidad_nif')),
      caducado,
      telefono: mayus(d('telefono')),
      dir,
      municipio: mayus(primero(d('municipio'), cli ? cli.ciudad : null)),
      cp: mayus(primero(d('cp'), cli ? cli.cp : null, libre.cp)),
      provinciaNombre: provNombre || null,
      provincia: prov.codigo,
      provinciaMotivo: prov.motivo,
      teniaDireccion: !vacio(d('direccion')) || !vacio(d('via')),
      cliente: cli
    };
  }

  /* ============================================================
     5 · Construcción del XML
     ============================================================ */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const campo = (tag, valor) => ({ tag, valor: vacio(valor) ? '' : String(valor) });
  const bloque = (tag, hijos) => ({ tag, hijos });

  function serializar(nodo, nivel) {
    const sangria = '  '.repeat(nivel);
    if (nodo.hijos) {
      return sangria + '<' + nodo.tag + '>\n'
        + nodo.hijos.map(n => serializar(n, nivel + 1)).join('\n') + '\n'
        + sangria + '</' + nodo.tag + '>';
    }
    // Tags vacíos self-closing, como la plantilla.
    if (nodo.valor === '') return sangria + '<' + nodo.tag + '/>';
    return sangria + '<' + nodo.tag + '>' + esc(nodo.valor) + '</' + nodo.tag + '>';
  }

  /* Los once campos de dirección de una parte, en el orden del formato.
     `sufijo` es _ADQUIRIENTE o _TRANSMITENTE. Solo cambia el sufijo: el
     orden de los tags de dirección es el mismo en las dos. */
  function camposDireccion(p, sufijo) {
    return [
      // Vacío mientras SIGLAS esté sin cargar (ver el catálogo arriba).
      campo('SIGLAS_DIRECCION' + sufijo, SIGLAS[p.dir.tipoVia] || ''),
      campo('NOMBRE_VIA_DIRECCION' + sufijo, p.dir.via),
      campo('NUMERO_DIRECCION' + sufijo, p.dir.numero),
      campo('LETRA_DIRECCION' + sufijo, p.dir.letra),
      campo('ESCALERA_DIRECCION' + sufijo, p.dir.escalera),
      campo('PISO_DIRECCION' + sufijo, p.dir.piso),
      campo('PUERTA_DIRECCION' + sufijo, p.dir.puerta)
    ];
  }

  function bloqueAdquiriente(p) {
    return bloque('DATOS_ADQUIRIENTE', [
      campo('DNI_ADQUIRIENTE', p.dni),
      campo('SEXO_ADQUIRIENTE', p.sexo),
      campo('APELLIDO1_RAZON_SOCIAL_ADQUIRIENTE', p.ape1),
      campo('APELLIDO2_ADQUIRIENTE', p.ape2),
      campo('NOMBRE_ADQUIRIENTE', p.pila),
      campo('FECHA_NACIMIENTO_ADQUIRIENTE', p.nacimiento),
      campo('TELEFONO_ADQUIRIENTE', p.telefono)
    ].concat(camposDireccion(p, '_ADQUIRIENTE')).concat([
      campo('PROVINCIA_ADQUIRIENTE', p.provincia),
      campo('MUNICIPIO_ADQUIRIENTE', p.municipio),
      campo('PUEBLO_ADQUIRIENTE', ''),
      campo('CP_ADQUIRIENTE', p.cp),
      campo('FECHA_CADUCIDAD_NIF_ADQUIRIENTE', p.caducidadNif),
      campo('BLOQUE_DIRECCION_ADQUIRIENTE', ''),
      campo('KM_DIRECCION_ADQUIRIENTE', ''),
      campo('HM_DIRECCION_ADQUIRIENTE', ''),
      campo('ACTUALIZACION_DOMICILIO_ADQUIRIENTE', ''),
      campo('AUTONOMO_ADQUIRIENTE', ''),
      campo('CODIGO_IAE_ADQUIRIENTE', ''),
      // El representante de una empresa no está en el expediente: lo pone
      // el gestor con el poder o el mandato delante.
      campo('NOMBRE_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('APELLIDO1_RAZON_SOCIAL_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('APELLIDO2_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('MOTIVO_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('FECHA_INICIO_TUTELA_ADQUIRIENTE', ''),
      campo('FECHA_FIN_TUTELA_ADQUIRIENTE', ''),
      campo('DNI_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('NOMBRE_APELLIDOS_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('CONCEPTO_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('DOCUMENTOS_REPRESENTANTE_ADQUIRIENTE', ''),
      campo('FECHA_CADUCIDAD_NIF_REPRESENTANTE_ADQUIRIENTE', '')
    ]));
  }

  /* OJO: el transmitente NO es el adquiriente con otro sufijo. No lleva
     ACTUALIZACION_DOMICILIO, el orden del bloque de representante es
     distinto (CONCEPTO va antes que DNI) y añade dos tags al final. Por eso
     va escrito entero y no generado con el mismo molde. */
  function bloqueTransmitente(p) {
    return bloque('DATOS_TRANSMITENTE', [
      campo('DNI_TRANSMITENTE', p.dni),
      campo('SEXO_TRANSMITENTE', p.sexo),
      campo('APELLIDO1_RAZON_SOCIAL_TRANSMITENTE', p.ape1),
      campo('APELLIDO2_TRANSMITENTE', p.ape2),
      campo('NOMBRE_TRANSMITENTE', p.pila),
      campo('FECHA_NACIMIENTO_TRANSMITENTE', p.nacimiento),
      campo('TELEFONO_TRANSMITENTE', p.telefono)
    ].concat(camposDireccion(p, '_TRANSMITENTE')).concat([
      campo('PROVINCIA_TRANSMITENTE', p.provincia),
      campo('MUNICIPIO_TRANSMITENTE', p.municipio),
      campo('PUEBLO_TRANSMITENTE', ''),
      campo('CP_TRANSMITENTE', p.cp),
      campo('FECHA_CADUCIDAD_NIF_TRANSMITENTE', p.caducidadNif),
      campo('BLOQUE_DIRECCION_TRANSMITENTE', ''),
      campo('KM_DIRECCION_TRANSMITENTE', ''),
      campo('HM_DIRECCION_TRANSMITENTE', ''),
      campo('AUTONOMO_TRANSMITENTE', ''),
      campo('CODIGO_IAE_TRANSMITENTE', ''),
      campo('NOMBRE_REPRESENTANTE_TRANSMITENTE', ''),
      campo('APELLIDO1_RAZON_SOCIAL_REPRESENTANTE_TRANSMITENTE', ''),
      campo('APELLIDO2_REPRESENTANTE_TRANSMITENTE', ''),
      campo('MOTIVO_REPRESENTANTE_TRANSMITENTE', ''),
      campo('FECHA_INICIO_TUTELA_TRANSMITENTE', ''),
      campo('FECHA_FIN_TUTELA_TRANSMITENTE', ''),
      campo('CONCEPTO_REPRESENTANTE_TRANSMITENTE', ''),
      campo('DNI_REPRESENTANTE_TRANSMITENTE', ''),
      campo('NOMBRE_APELLIDOS_REPRESENTANTE_TRANSMITENTE', ''),
      campo('DOCUMENTOS_REPRESENTANTE_TRANSMITENTE', ''),
      campo('FECHA_CADUCIDAD_NIF_REPRESENTANTE_TRANSMITENTE', ''),
      campo('TIPO_DOCUMENTO_SUSTITUTIVO_REPRESENTANTE_TRANSMITENTE', ''),
      campo('NUMERO_TITULARES', CONSTANTES.NUMERO_TITULARES)
    ]));
  }

  /* El presentador es la propia gestoría: mismos datos colegiados que
     firman el mandato y encabezan el expediente del Colegio. */
  function bloquePresentador(g) {
    /* El domicilio de la gestoría se declara ya desglosado en la config
       (`via`, `via_numero`, `piso`…), porque se escribe una vez y se sabe
       cómo se reparte. El parseo del texto libre queda solo de respaldo,
       para una config antigua que solo tenga `direccion`. */
    const dir = partirDireccion(g.direccion);
    const tipoVia = g.tipo_via || dir.tipoVia;
    return bloque('DATOS_PRESENTADOR', [
      campo('DNI_PRESENTADOR', mayus(g.nif)),
      campo('APELLIDO1_RAZON_SOCIAL_PRESENTADOR', mayus(g.nombre)),
      campo('APELLIDO2_PRESENTADOR', ''),
      campo('NOMBRE_PRESENTADOR', ''),
      campo('TELEFONO_PRESENTADOR', mayus(g.telefono)),
      campo('SIGLAS_DIRECCION_PRESENTADOR', SIGLAS[tipoVia] || ''),
      campo('NOMBRE_VIA_DIRECCION_PRESENTADOR', mayus(primero(g.via, dir.via))),
      campo('NUMERO_DIRECCION_PRESENTADOR', mayus(primero(g.via_numero, dir.numero))),
      campo('LETRA_DIRECCION_PRESENTADOR', mayus(g.letra)),
      campo('ESCALERA_DIRECCION_PRESENTADOR', mayus(g.escalera)),
      campo('PISO_DIRECCION_PRESENTADOR', mayus(g.piso)),
      campo('PUERTA_DIRECCION_PRESENTADOR', mayus(g.puerta)),
      campo('PROVINCIA_PRESENTADOR', codigoProvincia(g.provincia).codigo),
      campo('MUNICIPIO_PRESENTADOR', mayus(g.municipio)),
      campo('CP_PRESENTADOR', vacio(g.cp) ? dir.cp : mayus(g.cp)),
      campo('SEXO_PRESENTADOR', ''),
      campo('FECHA_NACIMIENTO_PRESENTADOR', ''),
      campo('PUEBLO_PRESENTADOR', ''),
      campo('BLOQUE_DIRECCION_PRESENTADOR', ''),
      campo('KM_DIRECCION_PRESENTADOR', ''),
      campo('HM_DIRECCION_PRESENTADOR', ''),
      campo('FECHA_CADUCIDAD_NIF_PRESENTADOR', ''),
      campo('TIPO_DOCUMENTO_SUSTITUTIVO_PRESENTADOR', ''),
      campo('FECHA_CADUCIDAD_DOCUMENTO_SUSTITUTIVO_PRESENTADOR', '')
    ]);
  }

  function bloqueVehiculo(exp) {
    return bloque('DATOS_VEHICULO', [
      campo('NUMERO_BASTIDOR', mayus(leer(exp, 'bastidor'))),
      campo('MARCA', mayus(exp.marca)),
      campo('MODELO', mayus(exp.modelo)),
      campo('FECHA_MATRICULACION', fechaDDMMAAAA(exp.fecha_matriculacion)),
      campo('FECHA_CADUCIDAD_ITV', ''),
      campo('SERVICIO_DESTINO', ''),
      campo('MODO_ADJUDICACION', CONSTANTES.MODO_ADJUDICACION),
      campo('TIPO_TRANSFERENCIA', CONSTANTES.TIPO_TRANSFERENCIA),
      campo('MOTIVO_ITV', ''),
      campo('CONCEPTO_ITV', ''),
      campo('FECHA_ITV', ''),
      campo('ESTACION_ITV', ''),
      campo('CALLE_DIRECCION_VEHICULO', ''),
      campo('NUMERO_DIRECCION_VEHICULO', ''),
      campo('PROVINCIA_VEHICULO', ''),
      campo('PUEBLO_VEHICULO', ''),
      campo('DECLARACION_RESPONSABILIDAD', CONSTANTES.DECLARACION_RESPONSABILIDAD),
      campo('TIPO_ID_VEHICULO', CONSTANTES.TIPO_ID_VEHICULO),
      campo('SERVICIO_ANTERIOR', ''),
      campo('SERVICIO', ''),
      campo('VEHICULO_AGRICOLA', ''),
      /* La plantilla pone 0 en los tres. NO son datos del expediente —el
         CRM no guarda tara, MMA ni plazas—, así que se copia el 0 de la
         plantilla y se avisa en el informe: si el programa los exige de
         verdad, salen de la ficha técnica y los pone el gestor. */
      campo('TARA', '0'),
      campo('PESO_MMA', '0'),
      campo('PLAZAS', '0')
    ]);
  }

  function bloquePresentacion(exp, g) {
    const T = global.GTTramites;
    /* EXENTO_ITP sale del toggle «Operación con factura (exenta de ITP)»
       de la pestaña de ITP, que MARCA EL GESTOR a mano. No se deduce de
       que el vendedor sea una empresa: la pestaña se limita a avisar de
       que suele proceder, y confirmarlo es cosa de una persona. */
    const exento = T && T.esExentoITP ? T.esExentoITP(exp) : leer(exp, 'itp_exento') === true;

    return bloque('DATOS_PRESENTACION', [
      campo('CODIGO_ELECTRONICO_TRANSFERENCIA', ''),
      campo('TIPO_TASA', ''),
      campo('CODIGO_TASA', ''),
      campo('MODELO_ITP', CONSTANTES.MODELO_ITP),
      campo('EXENTO_ITP', exento ? 'SI' : 'NO'),
      campo('NO_SUJETO_ITP', CONSTANTES.NO_SUJETO_ITP),
      campo('EXENTO_CEM', CONSTANTES.EXENTO_CEM),
      campo('EXENTO_IEDMT', CONSTANTES.EXENTO_IEDMT),
      campo('NO_SUJETO_IEDMT', CONSTANTES.NO_SUJETO_IEDMT),
      // El número de factura no está en el expediente: lo pone el gestor.
      campo('NUMERO_FACTURA', ''),
      campo('FECHA_FACTURA', exento ? fechaDDMMAAAA(leer(exp, 'fecha_venta')) : ''),
      campo('FECHA_CONTRATO', fechaDDMMAAAA(leer(exp, 'fecha_venta'))),
      campo('CODIGO_ELECTRONICO_MATRICULACION', ''),
      campo('JEFATURA_PROVINCIAL', codigoProvincia(g.provincia).codigo),
      campo('FECHA_PRESENTACION', '')
    ]);
  }

  /* ============================================================
     6 · ISO-8859-1
     ------------------------------------------------------------
     Un Blob de una cadena JS sale en UTF-8, y la plantilla declara
     ISO-8859-1: con acentos, el importador leería «GARCÍA» mal. Así que
     se pasa a bytes a mano.

     Antes se normalizan las comillas y guiones tipográficos, que un
     copiar-pegar mete sin querer y Latin-1 no representa. Lo que aun así
     se salga del juego de caracteres se sustituye y SE DICE cuál era: un
     carácter perdido en silencio dentro de un nombre es un nombre mal
     inscrito.
     ============================================================ */
  const SUSTITUCIONES = [
    [/[‘’‛′]/g, "'"],
    [/[“”‟″]/g, '"'],
    [/[‐-―−]/g, '-'],
    [/[…]/g, '...'],
    [/[   ]/g, ' '],
    [/[€]/g, 'EUR']
  ];

  function aLatin1(texto) {
    let s = texto;
    SUSTITUCIONES.forEach(([re, por]) => { s = s.replace(re, por); });

    const fuera = [];
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c <= 0xFF) {
        bytes[i] = c;
      } else {
        bytes[i] = 0x3F;                       // '?'
        if (fuera.indexOf(s[i]) === -1) fuera.push(s[i]);
      }
    }
    return { bytes, fuera };
  }

  /* ============================================================
     7 · API pública
     ============================================================ */

  /**
   * Construye el XML OEGAM de una transferencia.
   *
   * @param exp       expediente completo (con `datos` y, si la hay, `cliente`)
   * @param opciones  { gestoria, clientes, hoy }
   * @returns { xml, bytes, nombre, faltan, pendientes, asignaOegam,
   *            constantes, fueraLatin1 }
   */
  function construir(exp, opciones) {
    const o = opciones || {};
    const g = Object.assign({}, (global.GT_CONFIG && global.GT_CONFIG.GESTORIA) || {}, o.gestoria || {});

    /* `demo` no es un campo más que se herede al mezclar: dice si los datos
       de la gestoría son de mentira, y quien los aporta es quien lo sabe. Si
       la llamada trae su propia gestoría, trae también su propia respuesta.
       Heredarla del config marcaría como demo un XML bueno — o, peor, al
       revés: dejar de avisar de que el CIF es inventado. */
    if (o.gestoria) g.demo = !!o.gestoria.demo;
    const clientes = o.clientes || (exp && exp.cliente ? [exp.cliente] : []);
    const hoy = o.hoy || new Date();

    const adq = parte(exp, 'comprador', clientes, hoy);
    const tra = parte(exp, 'vendedor', clientes, hoy);

    const raiz = {
      tag: 'FORMATO_GA',
      atributos: { FechaCreacion: fechaMMDDAAAA(hoy), Plataforma: 'OEGAM' },
      hijos: [
        bloque('CABECERA', [
          bloque('DATOS_GESTORIA', [
            campo('NIF', mayus(g.nif)),
            campo('NOMBRE', mayus(g.nombre)),
            campo('PROFESIONAL', mayus(g.num_colegiado)),
            campo('PROVINCIA', codigoProvincia(g.provincia).codigo),
            campo('TIPO_DGT', CONSTANTES.TIPO_DGT)
          ])
        ]),
        bloque('TRANSMISION', [
          campo('NUMERO_DOCUMENTO', ''),
          campo('REFERENCIA_PROPIA', mayus(exp.referencia)),
          campo('FECHA_CREACION', fechaDDMMAAAA(hoy)),
          campo('FECHA_DEVOLUCION', ''),
          campo('OBSERVACIONES', ''),
          campo('MATRICULA', mayus(exp.matricula)),
          campo('CAMBIO_SERVICIO', CONSTANTES.CAMBIO_SERVICIO),
          bloqueAdquiriente(adq),
          bloqueTransmitente(tra),
          bloquePresentador(g),
          bloqueVehiculo(exp),
          bloque('DATOS_LIMITACION', [
            campo('TIPO_LIMITACION', ''),
            campo('FECHA_LIMITACION', ''),
            campo('NUMERO_REGISTRO_LIMITACION', ''),
            campo('FINANCIERA_LIMITACION', '')
          ]),
          bloquePresentacion(exp, g)
        ])
      ]
    };

    const atributos = Object.keys(raiz.atributos)
      .map(k => ' ' + k + '="' + esc(raiz.atributos[k]) + '"').join('');

    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n'
      + '<' + raiz.tag + atributos + '>\n'
      + raiz.hijos.map(n => serializar(n, 1)).join('\n') + '\n'
      + '</' + raiz.tag + '>\n';

    const { bytes, fuera } = aLatin1(xml);

    return {
      xml,
      bytes,
      nombre: 'oegam-transferencia-' + (exp.referencia || 'expediente') + '.xml',
      faltan: obligatoriosQueFaltan(raiz),
      pendientes: pendientesDe(adq, tra, g),
      avisos: avisosDe(adq, tra, g),
      asignaOegam: ASIGNA_OEGAM.slice(),
      constantes: CONSTANTES,
      fueraLatin1: fuera
    };
  }

  /** Recorre el árbol y devuelve los tags de OBLIGATORIOS que salen vacíos. */
  function obligatoriosQueFaltan(raiz) {
    const vistos = {};
    (function recorrer(n) {
      if (n.hijos) return n.hijos.forEach(recorrer);
      if (vistos[n.tag] === undefined) vistos[n.tag] = n.valor;
    })({ hijos: raiz.hijos });

    return OBLIGATORIOS
      .filter(t => vacio(vistos[t]))
      .map(t => ({ tag: t, etiqueta: ETIQUETAS[t] || t }));
  }

  const PARTES_XML = [
    ['ADQUIRIENTE', 'comprador', 'compradora'],
    ['TRANSMITENTE', 'vendedor', 'vendedora']
  ];

  /** Lo que el gestor tiene que completar a mano, y por qué. */
  function pendientesDe(adq, tra, g) {
    const out = [];
    const add = (tag, motivo) => out.push({ tag, motivo });
    const porParte = { ADQUIRIENTE: adq, TRANSMITENTE: tra };

    PARTES_XML.forEach(([suf, quien, quienA]) => {
      const p = porParte[suf];

      if (vacio(p.sexo)) {
        add('SEXO_' + suf, 'no se ha leído el sexo del ' + quien
          + ' en su DNI: V (hombre) o H (mujer)');
      }

      if (p.esEmpresa) {
        add('DNI_REPRESENTANTE_' + suf, 'el representante de la empresa ' + quienA
          + ' no está en el expediente: sale del poder o del mandato');
      } else {
        if (vacio(p.nacimiento)) {
          add('FECHA_NACIMIENTO_' + suf, 'no se ha leído la fecha de nacimiento del '
            + quien + ' en su DNI (está en el anverso)');
        }
        if (vacio(p.caducidadNif)) {
          add('FECHA_CADUCIDAD_NIF_' + suf, 'no se ha leído la caducidad del DNI del ' + quien);
        }
      }
      if (p.avisoNombre) add('APELLIDO1_RAZON_SOCIAL_' + suf, p.avisoNombre);

      if (p.teniaDireccion) {
        if (!SIGLAS[p.dir.tipoVia]) {
          add('SIGLAS_DIRECCION_' + suf, p.dir.tipoVia
            ? 'tipo de vía detectado «' + p.dir.tipoVia + '»: falta su código en el catálogo OEGAM'
            : 'no se reconoce el tipo de vía en el domicilio del ' + quien);
        }
        /* Con el DNI leído, el desglose lo pone Gest-IA viendo el documento y
           no hay nada que avisar. Sin él, lo único que hay es una cadena de
           texto: se dice, y se enseña lo que quedó suelto detrás del número. */
        if (!p.dir.delDni) {
          add('PISO_DIRECCION_' + suf, 'el DNI del ' + quien + ' no se ha leído: piso, puerta, '
            + 'letra y escalera no se sacan del domicilio en texto libre'
            + (p.dir.restoSinUsar ? ' (sin repartir: «' + p.dir.restoSinUsar + '»)' : ''));
        }
      }
      if (vacio(p.municipio)) {
        add('MUNICIPIO_' + suf, 'no se ha leído el municipio del ' + quien
          + ' (reverso del DNI) ni lo tiene su ficha de cliente');
      }
      if (vacio(p.provincia)) {
        add('PROVINCIA_' + suf, p.provinciaMotivo
          || 'no se ha leído la provincia del ' + quien + ' (reverso del DNI)');
      }
    });

    const tipoViaGestoria = g.tipo_via || partirDireccion(g.direccion).tipoVia;
    if (!SIGLAS[tipoViaGestoria]) {
      add('SIGLAS_DIRECCION_PRESENTADOR', tipoViaGestoria
        ? 'tipo de vía detectado «' + tipoViaGestoria + '»: falta su código en el catálogo OEGAM'
        : 'falta el catálogo de tipos de vía de OEGAM');
    }
    add('TARA / PESO_MMA / PLAZAS',
      'van a 0 como en la plantilla: el CRM no los guarda, salen de la ficha técnica');

    return out;
  }

  /**
   * Avisos que NO son huecos: cosas rellenas que hay que mirar antes de
   * importar. Un hueco se ve solo; esto no.
   */
  function avisosDe(adq, tra, g) {
    const out = [];
    const porParte = { ADQUIRIENTE: adq, TRANSMITENTE: tra };

    PARTES_XML.forEach(([suf, quien]) => {
      const p = porParte[suf];
      if (p.caducado) {
        out.push({
          tipo: 'dni_caducado',
          texto: 'El DNI del ' + quien + ' está CADUCADO (' + p.caducidadNif
            + '). La fecha va en el XML tal cual: decidir si se puede tramitar con él '
            + 'es cosa tuya, pero no lo descubras en la ventanilla.'
        });
      }
    });

    if (g.demo) {
      out.push({
        tipo: 'gestoria_demo',
        texto: 'Los datos de la gestoría son los de la DEMO: el CIF, el número de '
          + 'profesional y el teléfono son inventados. Este XML NO se presenta. '
          + 'Sustitúyelos en GT_CONFIG.GESTORIA y quita `demo: true`.'
      });
    }

    return out;
  }

  /** Descarga el XML como fichero, codificado en ISO-8859-1. */
  function descargar(exp, opciones) {
    const r = construir(exp, opciones);
    const blob = new Blob([r.bytes], { type: 'application/xml;charset=ISO-8859-1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return r;
  }

  global.GTOegam = {
    construir,
    descargar,
    // Expuestos para tools/verificar-oegam.js y para poder probarlos sueltos.
    partirDireccion,
    codigoProvincia,
    fechaDDMMAAAA,
    fechaMMDDAAAA,
    aLatin1,
    PROVINCIAS,
    SIGLAS,
    ASIGNA_OEGAM,
    CONSTANTES,
    OBLIGATORIOS
  };
})(typeof window !== 'undefined' ? window : globalThis);
