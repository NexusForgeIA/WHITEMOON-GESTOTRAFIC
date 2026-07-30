/* ============================================================
   GestoTrafic · Configuración
   ------------------------------------------------------------
   Backend Supabase con tablas AISLADAS y namespaced:
     gestotrafic_clientes · gestotrafic_expedientes · gestotrafic_documentos
   No comparte tablas, FKs ni triggers con ningún otro sistema.
   La clave publicable (anon) es pública por diseño: el acceso lo
   controla RLS en el servidor.
   ============================================================ */
window.GT_CONFIG = {
  SUPABASE_URL: 'https://mlaqtniujnvfxcvcourm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sYXF0bml1am52ZnhjdmNvdXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzUyMzIsImV4cCI6MjA5MzQxMTIzMn0.Neh7VUS8ADsxf0DPab0JoJyGXOAXnLIaXzXbKzj2BGs',

  TABLA_CLIENTES: 'gestotrafic_clientes',
  TABLA_EXPEDIENTES: 'gestotrafic_expedientes',
  TABLA_DOCUMENTOS: 'gestotrafic_documentos',
  TABLA_USUARIOS: 'gestotrafic_usuarios',

  /* Cada cambio de estado de un expediente, con su fecha. Lo escribe un
     TRIGGER, no la aplicación, y desde el navegador es de SOLO LECTURA: es la
     prueba de cuánto se tardó, y una prueba que se puede editar no lo es.
     Sin esta tabla el panel no puede calcular ningún tiempo. */
  TABLA_HISTORIAL: 'gestotrafic_estado_historial',

  BUCKET_DOCS: 'gestotrafic-docs',

  // Motor de cálculo ITP (BOE 2026 · Orden HAC/1501/2025)
  FN_ITP: 'gestotrafic-itp',

  // Login y alta de gestores (verifica bcrypt y emite la sesión)
  FN_AUTH: 'gestotrafic-auth',

  // Gest-IA · lectura de documentos con Claude (visión)
  FN_GESTIA: 'gestia-extraer',

  /* Propone el valor base del Anexo I con lo que Gest-IA leyó de la ficha.
     Va por Edge Function porque las búsquedas solo tienen `execute` en el
     servidor y las ~71.000 filas no tienen por qué bajar al navegador. */
  FN_VALOR_BASE: 'gestotrafic-valor-base',

  /* Genera el expediente completo (HTML para el Colegio + PDF) leyendo el
     bucket privado con el service_role. */
  FN_EXPEDIENTE: 'gestotrafic-expediente',

  /* Borra un expediente entero —archivos, documentos y expediente— en el
     orden que exige la política del bucket. */
  FN_BORRAR_EXPEDIENTE: 'gestotrafic-borrar-expediente',

  /* Credenciales de ICOGAM (certificado colegial, clave API y token).
     Va por Edge Function porque es la única que tiene la clave de cifrado:
     la tabla `gestotrafic_credenciales` es inalcanzable desde el navegador
     y los secretos no se pueden volver a leer una vez guardados. */
  FN_CREDENCIALES: 'gestotrafic-credenciales',

  /* Colegio cuyo formato de exportación se usa. Hoy solo hay uno; el
     exportador (assets/js/oegam.js) está aislado para que añadir otro sea
     añadir un módulo, no tocar la ficha del expediente. */
  EXPORTACION: 'oegam',

  /* ⚠️ DATOS DE LA GESTORÍA · FICTICIOS, SON LOS DE LA DEMO ⚠️
     ------------------------------------------------------------
     Salen en el contrato, en la portada del expediente completo y en el XML
     de OEGAM (DATOS_GESTORIA y DATOS_PRESENTADOR). Son los mismos datos
     colegiados que firman el mandato.

     `demo: true` los marca como PLACEHOLDER. Con esa bandera puesta, la
     pestaña de exportación avisa en rojo de que el XML lleva un CIF y un
     número de colegiado inventados y NO debe presentarse.

     AL INSTALAR EN UNA GESTORÍA REAL: sustituye los cuatro marcados
     «DEMO» por los suyos y quita `demo: true`. Son datos que aporta ella;
     no se rellenan a ojo, porque un NIF falso acaba en un documento que se
     presenta ante la DGT.

     La diferencia con lo anterior es deliberada: antes iban vacíos, y en una
     demo eso deja media exportación en blanco sin que se entienda por qué.
     Un placeholder EVIDENTE y señalado enseña el formato entero y no se
     confunde con un dato bueno. */
  GESTORIA: {
    nombre: 'WhiteMoon Tráfico',
    ciudad: 'Majadahonda, Madrid',
    provincia: 'Madrid',

    demo: true,                    // ← quitar al instalar en una gestoría real

    num_colegiado: '0000',         // DEMO · <PROFESIONAL>
    nif: 'B00000000',              // DEMO · <NIF> y <DNI_PRESENTADOR>
    telefono: '900000000',         // DEMO · <TELEFONO_PRESENTADOR>

    /* El domicilio va dos veces a propósito: `direccion` es la línea legible
       que se imprime en el contrato y en la portada, y el desglose es lo que
       pide OEGAM en campos separados. Aquí se declara desglosado en lugar de
       partir la cadena, porque el domicilio de la propia gestoría se escribe
       una vez y se sabe exactamente cómo se reparte. */
    direccion: 'Calle Madrid 9, 2ºB',
    via: 'Madrid',                 // <NOMBRE_VIA_DIRECCION_PRESENTADOR>
    via_numero: '9',
    escalera: '',
    piso: '2',
    puerta: 'B',
    letra: '',
    municipio: 'Majadahonda',      // <MUNICIPIO_PRESENTADOR>
    cp: '28220'                    // <CP_PRESENTADOR> · provincia M (Madrid)
  }
};

/* --- Colegios de Gestores Administrativos ---------------------------------
   La portada del expediente completo lleva el Colegio de la provincia de la
   gestoría (`GESTORIA.provincia`). Aquí solo va el NOMBRE oficial, que es
   público; la dirección, el CIF o el código de colegiado NO se rellenan a
   ojo: si hacen falta, los aporta la gestoría.

   Al instalar en una gestoría nueva: añade su provincia con el nombre de su
   Colegio y ajusta `GESTORIA.provincia`. Una provincia sin entrada NO se
   inventa — la portada dice "pendiente de configurar" y se ve. */
window.GT_COLEGIOS = {
  'Madrid': { nombre: 'Ilustre Colegio Oficial de Gestores Administrativos de Madrid' }
};

/** Colegio de la provincia configurada, o null si no está declarado. */
window.GT_COLEGIO = function () {
  var p = window.GT_CONFIG.GESTORIA.provincia;
  var c = window.GT_COLEGIOS[p];
  return c ? { provincia: p, nombre: c.nombre } : { provincia: p, nombre: null };
};

/* --- Catálogos --- */

window.GT_ESTADOS = [
  { id: 'nuevo',         label: 'Nuevo',                 color: '#8888a0' },
  { id: 'documentacion', label: 'Documentación pendiente', color: '#ffb45c' },
  { id: 'tramitacion',   label: 'En tramitación',        color: '#7c4dff' },
  { id: 'presentado',    label: 'Presentado',            color: '#7cb8ff' },
  { id: 'completado',    label: 'Completado',            color: '#00d4aa' }
];

window.GT_CCAA = [
  'Andalucía', 'Aragón', 'Asturias', 'Baleares', 'Canarias (IGIC)', 'Cantabria',
  'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Ceuta', 'Comunidad de Madrid',
  'Comunidad Valenciana', 'Extremadura', 'Galicia', 'La Rioja', 'Melilla',
  'Murcia', 'Navarra', 'País Vasco'
];

/* --- Provincia → Comunidad Autónoma ---------------------------------------
   El ITP se liquida en la CCAA de residencia del COMPRADOR, y su provincia
   sale del reverso de su DNI. Traducir provincia a comunidad es geografía, no
   fiscalidad: no hay nada que estimar, o la provincia está en esta tabla o no
   está. Lo que NO se hace es adivinar la provincia a partir de la calle, del
   código postal o del municipio; eso lo decide el gestor.

   Las claves van sin acentos y en mayúsculas: la comparación normaliza. */
window.GT_PROVINCIAS = {
  ALMERIA: 'Andalucía', CADIZ: 'Andalucía', CORDOBA: 'Andalucía', GRANADA: 'Andalucía',
  HUELVA: 'Andalucía', JAEN: 'Andalucía', MALAGA: 'Andalucía', SEVILLA: 'Andalucía',

  HUESCA: 'Aragón', TERUEL: 'Aragón', ZARAGOZA: 'Aragón',

  ASTURIAS: 'Asturias', OVIEDO: 'Asturias',

  BALEARES: 'Baleares', 'ILLES BALEARS': 'Baleares', 'ISLAS BALEARES': 'Baleares',

  'LAS PALMAS': 'Canarias (IGIC)', 'SANTA CRUZ DE TENERIFE': 'Canarias (IGIC)',
  TENERIFE: 'Canarias (IGIC)',

  CANTABRIA: 'Cantabria', SANTANDER: 'Cantabria',

  ALBACETE: 'Castilla-La Mancha', 'CIUDAD REAL': 'Castilla-La Mancha',
  CUENCA: 'Castilla-La Mancha', GUADALAJARA: 'Castilla-La Mancha', TOLEDO: 'Castilla-La Mancha',

  AVILA: 'Castilla y León', BURGOS: 'Castilla y León', LEON: 'Castilla y León',
  PALENCIA: 'Castilla y León', SALAMANCA: 'Castilla y León', SEGOVIA: 'Castilla y León',
  SORIA: 'Castilla y León', VALLADOLID: 'Castilla y León', ZAMORA: 'Castilla y León',

  BARCELONA: 'Cataluña', GIRONA: 'Cataluña', GERONA: 'Cataluña',
  LLEIDA: 'Cataluña', LERIDA: 'Cataluña', TARRAGONA: 'Cataluña',

  BADAJOZ: 'Extremadura', CACERES: 'Extremadura',

  'A CORUNA': 'Galicia', 'LA CORUNA': 'Galicia', LUGO: 'Galicia',
  OURENSE: 'Galicia', ORENSE: 'Galicia', PONTEVEDRA: 'Galicia',

  'LA RIOJA': 'La Rioja', LOGRONO: 'La Rioja',
  MADRID: 'Comunidad de Madrid',
  MURCIA: 'Murcia',
  NAVARRA: 'Navarra', PAMPLONA: 'Navarra',

  ALAVA: 'País Vasco', ARABA: 'País Vasco', 'VITORIA GASTEIZ': 'País Vasco',
  GUIPUZCOA: 'País Vasco', GIPUZKOA: 'País Vasco',
  VIZCAYA: 'País Vasco', BIZKAIA: 'País Vasco',

  ALICANTE: 'Comunidad Valenciana', ALACANT: 'Comunidad Valenciana',
  CASTELLON: 'Comunidad Valenciana', CASTELLO: 'Comunidad Valenciana',
  VALENCIA: 'Comunidad Valenciana',

  CEUTA: 'Ceuta', MELILLA: 'Melilla'
};

/* --- Las 52 provincias, para el desplegable del domicilio -----------------
   `GT_PROVINCIAS` de arriba traduce provincia → CCAA y admite alias (GERONA,
   GIRONA…) porque lee lo que venga de un documento. Esto es otra cosa: es la
   lista CERRADA que se le ofrece al gestor, un nombre por provincia.

   Escribir la provincia a mano era el hueco por el que se colaba «Vizkaya» o
   «La Coruña, A» y el exportador la dejaba vacía sin que nadie entendiera por
   qué. Con el desplegable, lo que se guarda siempre lo reconocen las DOS
   tablas: la de CCAA (tipo de ITP) y la de códigos de OEGAM.

   Los nombres van en la forma que reconocen ambas —la comparación normaliza
   acentos y mayúsculas—, y `tools/verificar-oegam.js` comprueba una a una que
   las 52 resuelven. Añadir una que no resuelva rompe la verificación, que es
   justo lo que tiene que pasar. */
window.GT_PROVINCIAS_LISTA = [
  'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila', 'Badajoz',
  'Baleares', 'Barcelona', 'Burgos', 'Cáceres', 'Cádiz', 'Cantabria',
  'Castellón', 'Ceuta', 'Ciudad Real', 'Córdoba', 'Cuenca', 'Girona',
  'Granada', 'Guadalajara', 'Guipúzcoa', 'Huelva', 'Huesca', 'Jaén',
  'La Coruña', 'La Rioja', 'Las Palmas', 'León', 'Lleida', 'Lugo', 'Madrid',
  'Málaga', 'Melilla', 'Murcia', 'Navarra', 'Ourense', 'Palencia',
  'Pontevedra', 'Salamanca', 'Santa Cruz de Tenerife', 'Segovia', 'Sevilla',
  'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia', 'Valladolid',
  'Vizcaya', 'Zamora', 'Zaragoza'
];

/* --- Tipos de vía ---------------------------------------------------------
   Lo que se guarda (`v`) es la ETIQUETA del tipo de vía, no su código: el
   código de OEGAM (SIGLAS_DIRECCION) es numérico y su tabla la publica el
   Colegio. Mientras no la tengamos, ese campo del XML sale VACÍO —no se
   inventa— y el informe de exportación dice qué tipo de vía se ha elegido
   para que el gestor ponga el código en dos segundos. Cuando llegue la tabla
   se rellena `SIGLAS` en assets/js/oegam.js y estos valores son sus claves.

   Por eso las etiquetas son EXACTAMENTE las que oegam.js sabe detectar en un
   domicilio en texto libre: es un solo vocabulario para el desplegable y para
   la detección, y el verificador comprueba que no se separen. */
window.GT_TIPOS_VIA = [
  { v: '',             l: '— Sin especificar —' },
  { v: 'CALLE',        l: 'Calle' },
  { v: 'AVENIDA',      l: 'Avenida' },
  { v: 'PLAZA',        l: 'Plaza' },
  { v: 'PASEO',        l: 'Paseo' },
  { v: 'CAMINO',       l: 'Camino' },
  { v: 'CARRETERA',    l: 'Carretera' },
  { v: 'TRAVESIA',     l: 'Travesía' },
  { v: 'RONDA',        l: 'Ronda' },
  { v: 'GLORIETA',     l: 'Glorieta' },
  { v: 'VIA',          l: 'Vía' },
  { v: 'CALLEJON',     l: 'Callejón' },
  { v: 'PASAJE',       l: 'Pasaje' },
  { v: 'RAMBLA',       l: 'Rambla' },
  { v: 'BULEVAR',      l: 'Bulevar' },
  { v: 'ALAMEDA',      l: 'Alameda' },
  { v: 'CUESTA',       l: 'Cuesta' },
  { v: 'URBANIZACION', l: 'Urbanización' },
  { v: 'POLIGONO',     l: 'Polígono' },
  { v: 'PARQUE',       l: 'Parque' },
  { v: 'BARRIO',       l: 'Barrio' },
  { v: 'LUGAR',        l: 'Lugar' }
];

/**
 * CCAA de una provincia leída de un documento, o `null` si no se reconoce.
 *
 * Devolver `null` es una respuesta legítima y es lo que se hace ante cualquier
 * duda: la CCAA cambia el tipo del ITP, así que una equivocada sale más cara
 * que un hueco que el gestor rellena en dos segundos.
 */
window.GT_CCAA_DE_PROVINCIA = function (texto) {
  if (!texto) return null;
  var p = String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!p) return null;
  return window.GT_PROVINCIAS[p] || null;
};

/* Tipos de vehículo a efectos del Anexo I.
   Los que NO son turismo se tarifan por TRAMO de cilindrada (o de kW en
   eléctricas): el motor resuelve el valor base solo y el campo manual sobra,
   por eso van con `auto: true`.

   Turismos (61.634 filas) y autocaravanas (9.252) se tarifan por
   marca/modelo/versión. NO llevan `auto: true` a propósito: el valor base solo
   se rellena cuando el gestor elige una versión concreta en el desplegable, y
   mientras tanto el campo sigue editable a mano. Dos versiones del mismo
   modelo pueden diferir en más de mil euros, así que no se automatiza.

   `boe` es el `tipo_vehiculo` con el que están cargadas sus filas. Turismo y
   autocaravana NO son intercambiables: el Anexo IV les aplica tablas de
   depreciación distintas, así que cada uno busca solo entre las suyas. */
window.GT_TIPOS_VEHICULO = [
  { id: 'coche',          label: 'Turismo',          auto: false, por: 'marca_modelo', boe: 'turismo' },
  { id: 'autocaravana',   label: 'Autocaravana',     auto: false, por: 'marca_modelo', boe: 'autocaravana' },
  { id: 'moto',           label: 'Motocicleta',      auto: true,  por: 'cilindrada' },
  { id: 'moto_electrica', label: 'Moto eléctrica',   auto: true,  por: 'kw' },
  { id: 'quad',           label: 'Quad',             auto: true,  por: 'cilindrada' },
  { id: 'buggy',          label: 'Buggy',            auto: true,  por: 'cilindrada' }
];

/* Etiquetas DGT · las usa el panel de cálculo ITP */
window.GT_ETIQUETAS = [
  { id: '',    label: 'Sin etiqueta / no aplica' },
  { id: 'B',   label: 'B (amarilla)' },
  { id: 'C',   label: 'C (verde)' },
  { id: 'ECO', label: 'ECO (azul y verde)' },
  { id: '0',   label: '0 emisiones (azul)' }
];

/* Los campos y el checklist documental de cada trámite viven en
   assets/js/tramites.js (GT_TRAMITES). Añadir un trámite nuevo es
   añadir una entrada allí: no hay que tocar formularios ni BD. */
