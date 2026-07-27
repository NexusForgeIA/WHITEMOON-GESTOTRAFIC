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

  // Datos de la gestoría que aparecen en el contrato generado
  GESTORIA: {
    nombre: 'GestoTrafic · Gestoría de Tráfico',
    ciudad: 'Majadahonda, Madrid',
    provincia: 'Madrid',
    /* Número de colegiado de la gestoría. Se imprime en la portada del
       expediente completo; vacío, no se imprime. NO se inventa. */
    num_colegiado: ''
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
