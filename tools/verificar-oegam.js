#!/usr/bin/env node
/* ============================================================
   Verificación del exportador OEGAM · transferencia
   ------------------------------------------------------------
   El XML que sale de aquí lo importa la gestoría en el programa del
   Colegio para inscribir un cambio de titularidad. Un tag fuera de
   sitio lo rechaza el importador; un tag INVENTADO no lo rechaza
   nadie, y eso es lo que hay que impedir.

   Este script compara el XML generado contra la plantilla de
   referencia —data/oegam/plantilla-transferencia.xml— y comprueba:

     1 · está bien formado (el tokenizador falla si no lo está)
     2 · MISMA estructura y MISMO orden de etiquetas que la plantilla
     3 · los campos que asigna OEGAM/DGT van VACÍOS
     4 · las constantes copiadas de la plantilla valen lo que allí
     5 · formatos: cuerpo DD/MM/AAAA, atributo FechaCreacion MM/DD/AAAA
     6 · codificación ISO-8859-1 declarada Y respetada byte a byte
     7 · los tags vacíos son self-closing
     8 · no se inventa: sin catálogo de tipos de vía SIGLAS_DIRECCION
         va vacía, y una provincia con dos códigos posibles también
     9 · EXENTO_ITP sigue al toggle del gestor, no al tipo de vendedor

       node tools/verificar-oegam.js

   Sale con código 1 a la primera discrepancia.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PLANTILLA = path.join(RAIZ, 'data', 'oegam', 'plantilla-transferencia.xml');
const FUENTE = path.join(RAIZ, 'assets', 'js', 'oegam.js');

/* Los módulos del CRM son IIFE sobre `window`: se ejecutan tal cual, sin
   copiar ni reimplementar nada. Si cambian, cambia lo que se verifica.

   Van los cuatro y en su orden porque la comprobación de punta a punta
   recorre la cadena entera: lo que Gest-IA lee del DNI → gestia.js lo mapea
   a `datos` → oegam.js lo escribe en el XML. Probar solo el último tramo
   dejaría fuera justo donde se pierden los datos. */
global.window = globalThis;
['config', 'tramites', 'gestia'].forEach(m =>
  (0, eval)(fs.readFileSync(path.join(RAIZ, 'assets', 'js', m + '.js'), 'utf8')));
(0, eval)(fs.readFileSync(FUENTE, 'utf8'));

const O = globalThis.GTOegam;
const IA = globalThis.GTGestIA;
const TR = globalThis.GTTramites;
if (!O || !IA || !TR) { console.error('No se pudieron cargar los módulos del CRM'); process.exit(2); }

/* ============================================================
   Tokenizador · valida y devuelve los elementos en orden
   ============================================================ */
function elementos(xml) {
  const lista = [];
  const pila = [];
  let i = 0;

  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) throw new Error('XML mal formado: «<» sin «>» en la posición ' + lt);
    let cuerpo = xml.slice(lt + 1, gt);

    if (cuerpo[0] === '/') {
      const tag = cuerpo.slice(1).trim();
      const abierto = pila.pop();
      if (abierto !== tag) {
        throw new Error(`XML mal formado: </${tag}> cierra a <${abierto || 'nada'}>`);
      }
      i = gt + 1;
      continue;
    }

    const auto = cuerpo.endsWith('/');
    if (auto) cuerpo = cuerpo.slice(0, -1);
    const tag = cuerpo.trim().split(/\s+/)[0];
    const ruta = pila.concat(tag).join('/');

    if (auto) { lista.push({ ruta, tag, valor: '', self: true }); i = gt + 1; continue; }

    const cierre = '</' + tag + '>';
    const sig = xml.indexOf('<', gt + 1);
    if (sig !== -1 && xml.startsWith(cierre, sig)) {
      lista.push({ ruta, tag, valor: xml.slice(gt + 1, sig), self: false });
      i = sig + cierre.length;
      continue;
    }

    lista.push({ ruta, tag, valor: null, self: false });
    pila.push(tag);
    i = gt + 1;
  }

  if (pila.length) throw new Error('XML mal formado: quedan sin cerrar ' + pila.join(', '));
  return lista;
}

/* ============================================================
   Caso de prueba · empresa compra a particular, como la plantilla
   ============================================================ */

const GESTORIA = {
  nombre: 'GESTORIA EJEMPLO SL',
  nif: 'B00000000',
  num_colegiado: '0000',
  provincia: 'Madrid',
  telefono: '900000000',
  direccion: 'Calle Gestoria Ejemplo',
  municipio: 'Madrid',
  cp: '28000'
};

/* Fichas del CRM. De aquí —y solo de aquí— salen municipio, CP y provincia:
   son columnas propias de `gestotrafic_clientes`. El cruce es por NIF exacto. */
const CLIENTES = [
  {
    tipo: 'empresa', razon_social: 'EMPRESA EJEMPLO SL',
    nombre: 'EMPRESA EJEMPLO SL', apellidos: null, nif: 'B00000001',
    direccion: 'Via Ejemplo 1', cp: '08000',
    ciudad: 'Municipio Ejemplo', provincia: 'Barcelona'
  },
  {
    tipo: 'particular', nombre: 'Nombre', apellidos: 'Apellidouno Apellidodos',
    nif: '00000001R', direccion: 'Calle Ejemplo 1', cp: '29000',
    ciudad: 'Municipio Ejemplo', provincia: 'Málaga'
  }
];

const EXPEDIENTE = {
  referencia: 'EXP-2026-0001',
  matricula: '0000XXX',
  marca: 'Marca Ejemplo',
  modelo: 'Modelo Ejemplo',
  fecha_matriculacion: '2020-01-01',
  comprador_nombre: 'EMPRESA EJEMPLO SL',
  comprador_nif: 'B00000001',
  comprador_direccion: 'Via Ejemplo 1, 08000 Municipio Ejemplo',
  comprador_telefono: '',
  vendedor_nombre: 'Nombre Apellidouno Apellidodos',
  vendedor_nif: '00000001R',
  vendedor_direccion: 'Calle Ejemplo 1, 29000 Municipio Ejemplo',
  vendedor_telefono: '',
  datos: {
    comprador_tipo: 'empresa',
    vendedor_tipo: 'particular',
    bastidor: 'XXXXXXXXXXXXXXXXX',
    fecha_venta: '2026-01-01',
    itp_exento: false
  }
};

const HOY = new Date(2026, 0, 1);        // 1 de enero de 2026, fijo y determinista

/* ============================================================
   Comprobaciones
   ============================================================ */

let fallos = 0;
function ok(cond, titulo, detalle) {
  if (cond) { console.log('  ✓ ' + titulo); return true; }
  fallos++;
  console.log('  ✗ ' + titulo + (detalle ? '\n      ' + detalle : ''));
  return false;
}

console.log('\nVerificación del exportador OEGAM\n' + '='.repeat(52));

if (!fs.existsSync(PLANTILLA)) {
  console.error('No encuentro la plantilla de referencia:\n  ' + PLANTILLA);
  process.exit(2);
}

/* La plantilla declara ISO-8859-1 pero el fichero que nos pasaron está
   guardado en UTF-8. Da igual: de ella solo se leen NOMBRES DE ETIQUETA y
   valores ASCII, que son idénticos en las dos codificaciones. */
const plantilla = elementos(fs.readFileSync(PLANTILLA, 'utf8'));
const r = O.construir(EXPEDIENTE, { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
const generado = elementos(r.xml);

const valorDe = (lista, ruta) => {
  const e = lista.find(x => x.ruta === ruta);
  return e ? e.valor : undefined;
};

/* --- 1 · Bien formado ---------------------------------------------- */
console.log('\n1 · XML bien formado');
ok(generado.length > 0, 'el tokenizador acepta el XML generado (etiquetas balanceadas)');

/* --- 2 · Misma estructura y mismo orden ----------------------------- */
console.log('\n2 · Estructura y orden idénticos a la plantilla');
const rutasP = plantilla.map(e => e.ruta);
const rutasG = generado.map(e => e.ruta);

ok(rutasG.length === rutasP.length,
  `mismo número de etiquetas (${rutasP.length})`,
  `plantilla ${rutasP.length}, generado ${rutasG.length}`);

const primeraDif = rutasP.findIndex((x, i) => x !== rutasG[i]);
ok(primeraDif === -1, 'mismas etiquetas, en el mismo orden y con el mismo anidamiento',
  primeraDif === -1 ? '' :
    `posición ${primeraDif}: plantilla «${rutasP[primeraDif]}» · generado «${rutasG[primeraDif] || '(nada)'}»`);

/* Sobrantes y ausentes, por si el conteo cuadra pero el contenido no. */
const soloP = rutasP.filter(x => rutasG.indexOf(x) === -1);
const soloG = rutasG.filter(x => rutasP.indexOf(x) === -1);
ok(soloP.length === 0, 'no falta ninguna etiqueta de la plantilla', soloP.join(', '));
ok(soloG.length === 0, 'no se añade ninguna etiqueta que la plantilla no tenga', soloG.join(', '));

/* --- 3 · Lo que asigna OEGAM va vacío -------------------------------- */
console.log('\n3 · Campos que asigna OEGAM/DGT · vacíos');
O.ASIGNA_OEGAM.forEach(tag => {
  const e = generado.filter(x => x.tag === tag);
  ok(e.length > 0 && e.every(x => x.valor === '' && x.self),
    `${tag} vacío y self-closing`,
    e.length ? 'valor: ' + JSON.stringify(e.map(x => x.valor)) : 'la etiqueta no aparece');
});

/* --- 4 · Constantes copiadas de la plantilla ------------------------- */
console.log('\n4 · Constantes con el valor de la plantilla');
[
  'CABECERA/DATOS_GESTORIA/TIPO_DGT',
  'TRANSMISION/CAMBIO_SERVICIO',
  'TRANSMISION/DATOS_VEHICULO/MODO_ADJUDICACION',
  'TRANSMISION/DATOS_VEHICULO/TIPO_TRANSFERENCIA',
  'TRANSMISION/DATOS_VEHICULO/DECLARACION_RESPONSABILIDAD',
  'TRANSMISION/DATOS_VEHICULO/TIPO_ID_VEHICULO',
  'TRANSMISION/DATOS_VEHICULO/TARA',
  'TRANSMISION/DATOS_VEHICULO/PESO_MMA',
  'TRANSMISION/DATOS_VEHICULO/PLAZAS',
  'TRANSMISION/DATOS_TRANSMITENTE/NUMERO_TITULARES',
  'TRANSMISION/DATOS_PRESENTACION/MODELO_ITP',
  'TRANSMISION/DATOS_PRESENTACION/NO_SUJETO_ITP',
  'TRANSMISION/DATOS_PRESENTACION/EXENTO_CEM',
  'TRANSMISION/DATOS_PRESENTACION/EXENTO_IEDMT',
  'TRANSMISION/DATOS_PRESENTACION/NO_SUJETO_IEDMT'
].forEach(ruta => {
  const clave = 'FORMATO_GA/' + ruta;
  const esperado = valorDe(plantilla, clave);
  const obtenido = valorDe(generado, clave);
  ok(esperado === obtenido, `${ruta.split('/').pop()} = ${JSON.stringify(esperado)}`,
    `plantilla ${JSON.stringify(esperado)} · generado ${JSON.stringify(obtenido)}`);
});

/* --- 5 · Formatos de fecha ------------------------------------------ */
console.log('\n5 · Formatos de fecha');
const attr = /FechaCreacion="([^"]*)"/.exec(r.xml);
ok(!!attr && attr[1] === '01/01/2026',
  'atributo FechaCreacion en MM/DD/AAAA', attr ? attr[1] : 'no aparece');

ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/FECHA_CREACION') === '01/01/2026',
  'FECHA_CREACION en DD/MM/AAAA');

/* 1 de febrero: la única fecha que distingue DD/MM de MM/DD sin ambigüedad. */
const febrero = O.construir(
  Object.assign({}, EXPEDIENTE, {
    fecha_matriculacion: '2020-02-01',
    datos: Object.assign({}, EXPEDIENTE.datos, { fecha_venta: '2026-02-01' })
  }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: new Date(2026, 1, 1) });
const eFeb = elementos(febrero.xml);

ok(valorDe(eFeb, 'FORMATO_GA/TRANSMISION/DATOS_VEHICULO/FECHA_MATRICULACION') === '01/02/2020',
  'FECHA_MATRICULACION del 1-feb sale 01/02/2020 (día antes que mes)',
  valorDe(eFeb, 'FORMATO_GA/TRANSMISION/DATOS_VEHICULO/FECHA_MATRICULACION'));
ok(valorDe(eFeb, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/FECHA_CONTRATO') === '01/02/2026',
  'FECHA_CONTRATO del 1-feb sale 01/02/2026',
  valorDe(eFeb, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/FECHA_CONTRATO'));
ok(/FechaCreacion="02\/01\/2026"/.test(febrero.xml),
  'y el atributo del mismo día sale al revés: 02/01/2026 (mes antes que día)');

/* --- 6 · ISO-8859-1 -------------------------------------------------- */
console.log('\n6 · Codificación ISO-8859-1');
ok(r.xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>'),
  'la declaración anuncia ISO-8859-1');

/* El acento va en la MARCA a propósito: el nombre del transmitente sale de
   su ficha de cliente, así que un acento puesto en `vendedor_nombre` no
   llegaría al XML y la comprobación no probaría nada. */
const conAcentos = O.construir(
  Object.assign({}, EXPEDIENTE, { marca: 'Muñoz Ibáñez' }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
const bytes = conAcentos.bytes;
const comoLatin1 = Buffer.from(bytes).toString('latin1');

ok(comoLatin1 === conAcentos.xml.replace(/[€]/g, 'EUR'),
  'los bytes releídos como Latin-1 devuelven el mismo texto');
ok(bytes.indexOf(0xD1) !== -1, 'la Ñ va como un solo byte 0xD1, no como los dos de UTF-8');
ok(conAcentos.fueraLatin1.length === 0, 'ningún carácter se ha perdido');

const raro = O.construir(
  Object.assign({}, EXPEDIENTE, { marca: 'Marca 東 Ejemplo' }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
ok(raro.fueraLatin1.indexOf('東') !== -1,
  'un carácter fuera de Latin-1 se sustituye Y se denuncia en el informe');

/* --- 7 · Tags vacíos self-closing ------------------------------------ */
console.log('\n7 · Tags vacíos self-closing');
const vaciosNoSelf = generado.filter(e => e.valor === '' && !e.self);
ok(vaciosNoSelf.length === 0, 'todo tag sin valor se cierra en sí mismo',
  vaciosNoSelf.map(e => e.tag).join(', '));
ok(/<OBSERVACIONES\/>/.test(r.xml), 'p. ej. <OBSERVACIONES/>');

/* --- 8 · No se inventa ----------------------------------------------- */
console.log('\n8 · Anti-invención');

ok(Object.keys(O.SIGLAS).length === 0,
  'el catálogo de tipos de vía sigue vacío (lo publica OEGAM, no nosotros)');
['SIGLAS_DIRECCION_ADQUIRIENTE', 'SIGLAS_DIRECCION_TRANSMITENTE', 'SIGLAS_DIRECCION_PRESENTADOR']
  .forEach(tag => {
    const e = generado.find(x => x.tag === tag);
    ok(e && e.valor === '', `${tag} vacío mientras no haya catálogo`, e && e.valor);
  });
ok(r.pendientes.some(p => /SIGLAS_DIRECCION_TRANSMITENTE/.test(p.tag) && /CALLE/.test(p.motivo)),
  'pero el informe dice que el tipo de vía detectado es CALLE');

/* Provincias: las que tienen un solo código salen; las que tienen dos, no. */
ok(O.codigoProvincia('Madrid').codigo === 'M', 'Madrid → M (lo confirma la plantilla)');
ok(O.codigoProvincia('Barcelona').codigo === 'B', 'Barcelona → B (lo confirma la plantilla)');
ok(O.codigoProvincia('Málaga').codigo === 'MA', 'Málaga → MA (lo confirma la plantilla)');
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_TRANSMITENTE/PROVINCIA_TRANSMITENTE') === 'MA',
  'la provincia del transmitente sale de su ficha de cliente');

const amb = O.codigoProvincia('Girona');
ok(amb.codigo === '' && /GI o GE/.test(amb.motivo || ''),
  'Girona, con dos códigos históricos, sale VACÍA y con el motivo',
  JSON.stringify(amb));
ok(O.codigoProvincia('Provincia Inventada').codigo === '',
  'una provincia que no está en la tabla sale vacía');

/* El desglose fino de la dirección no se adivina del texto libre. */
['LETRA', 'ESCALERA', 'PISO', 'PUERTA', 'BLOQUE', 'KM', 'HM'].forEach(p => {
  const e = generado.find(x => x.tag === p + '_DIRECCION_TRANSMITENTE');
  ok(e && e.valor === '', `${p}_DIRECCION_TRANSMITENTE vacío (no se deduce del texto libre)`);
});

/* Un particular sin ficha de cliente: ni nombre partido, ni municipio. */
const suelto = O.construir(
  Object.assign({}, EXPEDIENTE, {
    vendedor_nif: '99999999R',
    vendedor_nombre: 'Jose Maria de la Fuente Ruiz'
  }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
const eSuelto = elementos(suelto.xml);
ok(valorDe(eSuelto, 'FORMATO_GA/TRANSMISION/DATOS_TRANSMITENTE/APELLIDO1_RAZON_SOCIAL_TRANSMITENTE') === '',
  'sin ficha de cliente, el nombre suelto NO se parte en nombre y apellidos');
ok(suelto.pendientes.some(p => /reparte nombre y apellidos/.test(p.motivo)),
  'y el informe explica que hay que repartirlo');
ok(suelto.faltan.some(f => f.tag === 'APELLIDO1_RAZON_SOCIAL_TRANSMITENTE'),
  'además consta como campo obligatorio que falta');

/* Sexo y fecha de nacimiento de un particular: el CRM no los tiene. */
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_TRANSMITENTE/SEXO_TRANSMITENTE') === '',
  'SEXO_TRANSMITENTE vacío: un particular no declara su sexo en el CRM');
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_TRANSMITENTE/FECHA_NACIMIENTO_TRANSMITENTE') === '',
  'FECHA_NACIMIENTO_TRANSMITENTE vacía por lo mismo');
ok(r.pendientes.some(p => p.tag === 'SEXO_TRANSMITENTE'),
  'los dos salen en la lista de lo que completa el gestor');

/* La empresa sí tiene sexo: X, persona jurídica. No es una deducción, es
   lo que declara la plantilla y lo que dice el checklist del expediente. */
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/SEXO_ADQUIRIENTE') === 'X',
  'SEXO_ADQUIRIENTE = X porque el comprador es una empresa');
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/APELLIDO1_RAZON_SOCIAL_ADQUIRIENTE')
  === 'EMPRESA EJEMPLO SL',
  'y su razón social va entera en APELLIDO1_RAZON_SOCIAL');

/* --- 9 · EXENTO_ITP sigue al gestor ---------------------------------- */
console.log('\n9 · EXENTO_ITP · lo decide el gestor, no el tipo de vendedor');
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/EXENTO_ITP') === 'NO',
  'sin el toggle marcado: EXENTO_ITP = NO');

const vendeEmpresa = O.construir(
  Object.assign({}, EXPEDIENTE, {
    datos: Object.assign({}, EXPEDIENTE.datos, { vendedor_tipo: 'empresa' })
  }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
ok(valorDe(elementos(vendeEmpresa.xml), 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/EXENTO_ITP') === 'NO',
  'con vendedor empresa pero sin confirmar la exención: sigue NO');

const conExencion = O.construir(
  Object.assign({}, EXPEDIENTE, {
    datos: Object.assign({}, EXPEDIENTE.datos, { vendedor_tipo: 'empresa', itp_exento: true })
  }),
  { gestoria: GESTORIA, clientes: CLIENTES, hoy: HOY });
const eExento = elementos(conExencion.xml);
ok(valorDe(eExento, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/EXENTO_ITP') === 'SI',
  'con el toggle marcado por el gestor: EXENTO_ITP = SI');
ok(valorDe(eExento, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/FECHA_FACTURA') === '01/01/2026',
  'y entonces FECHA_FACTURA lleva la fecha de la operación');
ok(valorDe(generado, 'FORMATO_GA/TRANSMISION/DATOS_PRESENTACION/FECHA_FACTURA') === '',
  'sin exención no hay factura: FECHA_FACTURA vacía');

/* --- 10 · Dirección: lo que sí se extrae ----------------------------- */
console.log('\n10 · Descomposición conservadora de la dirección');
const d = O.partirDireccion('Calle Mieses 1, 28220 Majadahonda');
ok(d.tipoVia === 'CALLE', 'tipo de vía detectado: CALLE', d.tipoVia);
ok(d.via === 'MIESES', 'nombre de vía: MIESES', d.via);
ok(d.numero === '1', 'número: 1', d.numero);
ok(d.cp === '28220', 'CP: 28220', d.cp);
ok(O.partirDireccion('Av. de España 22, Madrid').tipoVia === 'AVENIDA',
  '«Av. de España 22» → AVENIDA');
ok(O.partirDireccion('Un sitio sin tipo de via').tipoVia === '',
  'una dirección sin tipo de vía reconocible no se fuerza a ninguno');

/* ============================================================
   11 · De punta a punta · los dos DNIs leídos
   ------------------------------------------------------------
   Esto es lo que hay que demostrar: con la config demo y los DNIs de
   comprador y vendedor leídos a dos caras, el XML sale COMPLETO.

   Se simula la respuesta de la Edge Function —el JSON que devuelve Claude
   por documento— y se hace pasar por la cadena real: GTGestIA.propuestas →
   aExpediente → GTOegam.construir. Ni un solo campo se escribe a mano en el
   expediente, así que si el mapeo se rompe, esto se cae.
   ============================================================ */
console.log('\n11 · De punta a punta · los dos DNIs leídos');

/** Un campo tal y como lo devuelve la Edge Function. */
const c = (valor, confianza) => ({ valor, confianza: confianza || 'alta', nota: '' });

/** Lectura de un DNI a dos caras, con el formato exacto de gestia-extraer. */
function lecturaDni(tipo, d) {
  return {
    extraido: true, tipo, perfil: 'dni',
    legible: true, observacion: '',
    caras_vistas: { anverso: true, reverso: true },
    caras_faltan: [],
    campos: {
      nombre: c(d.nombre), apellido1: c(d.apellido1), apellido2: c(d.apellido2),
      numero: c(d.numero), sexo: c(d.sexo),
      fecha_nacimiento: c(d.nacimiento), fecha_caducidad: c(d.caducidad),
      direccion: c(d.direccion),
      via_nombre: c(d.via), via_numero: c(d.via_numero),
      via_escalera: c(d.escalera || ''), via_piso: c(d.piso || ''),
      via_puerta: c(d.puerta || ''), via_letra: c(d.letra || ''),
      municipio: c(d.municipio), provincia: c(d.provincia), cp: c(d.cp)
    }
  };
}

const LECTURAS = [
  lecturaDni('dni_comprador', {
    nombre: 'Lucia', apellido1: 'Ferrer', apellido2: 'Ibáñez',
    numero: '00000002S', sexo: 'mujer',
    nacimiento: '1985-03-14', caducidad: '2032-05-20',
    direccion: 'SIETE VIENTOS 39 PBJ',
    via: 'SIETE VIENTOS', via_numero: '39', piso: 'PBJ',
    municipio: 'Majadahonda', provincia: 'Madrid', cp: '28220'
  }),
  lecturaDni('dni_vendedor', {
    nombre: 'Andres', apellido1: 'De La Fuente', apellido2: 'Ruiz',
    numero: '00000001R', sexo: 'hombre',
    nacimiento: '1970-01-01', caducidad: '2030-01-01',
    direccion: 'CALLE EJEMPLO 1, 2 B',
    via: 'EJEMPLO', via_numero: '1', piso: '2', puerta: 'B',
    municipio: 'Málaga', provincia: 'Málaga', cp: '29000'
  }),
  {
    extraido: true, tipo: 'ficha_tecnica', perfil: 'ficha_tecnica',
    legible: true, observacion: '', campos: {
      marca: c('Mercedes-Benz'), modelo: c('Clase A 180 d'),
      bastidor: c('WDD1760121J000000'), matricula: c('4821 NBH'),
      fecha_matriculacion: c('2019-06-10'), combustible: c('Diesel'),
      cvf: c('9.5'), cilindrada: c('1461'), clasificacion: c('TURISMO')
    }
  }
];

const trTransfer = TR.tramite('transferencia');
const props = IA.propuestas(trTransfer, LECTURAS);
const fila = IA.aExpediente(trTransfer, props, {
  comprador_tipo: 'particular', vendedor_tipo: 'particular'
});

/* El expediente tal y como queda tras el alta con Gest-IA. `fila` trae las
   columnas propias y `fila.datos` el jsonb; se juntan igual que en el CRM. */
const EXP_IA = Object.assign({ referencia: 'EXP-2026-0042' }, fila);
EXP_IA.datos = Object.assign({}, fila.datos, { fecha_venta: '2026-03-05' });

const eIA = elementos(O.construir(EXP_IA, { hoy: HOY }).xml);
const rIA = O.construir(EXP_IA, { hoy: HOY });
const v = (ruta) => valorDe(eIA, 'FORMATO_GA/TRANSMISION/' + ruta);

// --- Gestoría y presentador, de la config demo ---
console.log('\n   Gestoría y presentador (config demo)');
[
  ['CABECERA/DATOS_GESTORIA/NIF', 'B00000000'],
  ['CABECERA/DATOS_GESTORIA/NOMBRE', 'WHITEMOON TRÁFICO'],
  ['CABECERA/DATOS_GESTORIA/PROFESIONAL', '0000'],
  ['CABECERA/DATOS_GESTORIA/PROVINCIA', 'M']
].forEach(([ruta, esperado]) => {
  const got = valorDe(eIA, 'FORMATO_GA/' + ruta);
  ok(got === esperado, `${ruta.split('/').pop()} = ${esperado}`, got);
});
[
  ['DNI_PRESENTADOR', 'B00000000'],
  ['APELLIDO1_RAZON_SOCIAL_PRESENTADOR', 'WHITEMOON TRÁFICO'],
  ['TELEFONO_PRESENTADOR', '900000000'],
  ['NOMBRE_VIA_DIRECCION_PRESENTADOR', 'MADRID'],
  ['NUMERO_DIRECCION_PRESENTADOR', '9'],
  ['PISO_DIRECCION_PRESENTADOR', '2'],
  ['PUERTA_DIRECCION_PRESENTADOR', 'B'],
  ['MUNICIPIO_PRESENTADOR', 'MAJADAHONDA'],
  ['CP_PRESENTADOR', '28220'],
  ['PROVINCIA_PRESENTADOR', 'M']
].forEach(([tag, esperado]) => {
  const got = v('DATOS_PRESENTADOR/' + tag);
  ok(got === esperado, `${tag} = ${esperado}`, got);
});

// --- Adquiriente: mujer → H ---
console.log('\n   Adquiriente · del DNI del comprador');
[
  ['DNI_ADQUIRIENTE', '00000002S'],
  ['SEXO_ADQUIRIENTE', 'H'],
  ['NOMBRE_ADQUIRIENTE', 'LUCIA'],
  ['APELLIDO1_RAZON_SOCIAL_ADQUIRIENTE', 'FERRER'],
  ['APELLIDO2_ADQUIRIENTE', 'IBÁÑEZ'],
  ['FECHA_NACIMIENTO_ADQUIRIENTE', '14/03/1985'],
  ['FECHA_CADUCIDAD_NIF_ADQUIRIENTE', '20/05/2032'],
  ['NOMBRE_VIA_DIRECCION_ADQUIRIENTE', 'SIETE VIENTOS'],
  ['NUMERO_DIRECCION_ADQUIRIENTE', '39'],
  ['PISO_DIRECCION_ADQUIRIENTE', 'PBJ'],
  ['MUNICIPIO_ADQUIRIENTE', 'MAJADAHONDA'],
  ['PROVINCIA_ADQUIRIENTE', 'M'],
  ['CP_ADQUIRIENTE', '28220']
].forEach(([tag, esperado]) => {
  const got = v('DATOS_ADQUIRIENTE/' + tag);
  ok(got === esperado, `${tag} = ${esperado}`, got);
});

// --- Transmitente: hombre → V, y un apellido compuesto sin partir ---
console.log('\n   Transmitente · del DNI del vendedor');
[
  ['SEXO_TRANSMITENTE', 'V'],
  ['NOMBRE_TRANSMITENTE', 'ANDRES'],
  ['APELLIDO1_RAZON_SOCIAL_TRANSMITENTE', 'DE LA FUENTE'],
  ['APELLIDO2_TRANSMITENTE', 'RUIZ'],
  ['FECHA_NACIMIENTO_TRANSMITENTE', '01/01/1970'],
  ['FECHA_CADUCIDAD_NIF_TRANSMITENTE', '01/01/2030'],
  ['NOMBRE_VIA_DIRECCION_TRANSMITENTE', 'EJEMPLO'],
  ['NUMERO_DIRECCION_TRANSMITENTE', '1'],
  ['PISO_DIRECCION_TRANSMITENTE', '2'],
  ['PUERTA_DIRECCION_TRANSMITENTE', 'B'],
  ['PROVINCIA_TRANSMITENTE', 'MA'],
  ['CP_TRANSMITENTE', '29000']
].forEach(([tag, esperado]) => {
  const got = v('DATOS_TRANSMITENTE/' + tag);
  ok(got === esperado, `${tag} = ${esperado}`, got);
});

// --- Vehículo y contrato ---
console.log('\n   Vehículo y contrato');
ok(v('DATOS_VEHICULO/NUMERO_BASTIDOR') === 'WDD1760121J000000',
  'NUMERO_BASTIDOR llega desde la ficha técnica', v('DATOS_VEHICULO/NUMERO_BASTIDOR'));
ok(v('MATRICULA') === '4821 NBH', 'MATRICULA', v('MATRICULA'));
ok(v('DATOS_PRESENTACION/FECHA_CONTRATO') === '05/03/2026',
  'FECHA_CONTRATO sale de la fecha del contrato del expediente',
  v('DATOS_PRESENTACION/FECHA_CONTRATO'));

// --- Y lo que importa: qué queda vacío ---
console.log('\n   Lo único que queda vacío');
const RELLENOS_OBLIGADOS = [
  'NIF', 'NOMBRE', 'PROFESIONAL', 'PROVINCIA', 'MATRICULA', 'NUMERO_BASTIDOR',
  'MARCA', 'MODELO', 'FECHA_MATRICULACION', 'FECHA_CONTRATO',
  'DNI_ADQUIRIENTE', 'SEXO_ADQUIRIENTE', 'FECHA_NACIMIENTO_ADQUIRIENTE',
  'DNI_TRANSMITENTE', 'SEXO_TRANSMITENTE', 'FECHA_NACIMIENTO_TRANSMITENTE'
];
const huecos = RELLENOS_OBLIGADOS.filter(t => !valorDe(eIA, eIA.find(x => x.tag === t).ruta));
ok(huecos.length === 0, 'ningún campo de datos se queda vacío', huecos.join(', '));
ok(rIA.faltan.length === 0, 'el informe no reporta ningún obligatorio pendiente',
  rIA.faltan.map(x => x.tag).join(', '));

/* Los pendientes que quedan tienen que ser SOLO los tipos de vía (sin
   catálogo) y la nota de TARA/PESO/PLAZAS. Nada de personas. */
const pendPersona = rIA.pendientes.filter(p =>
  !/^SIGLAS_DIRECCION_/.test(p.tag) && !/^TARA/.test(p.tag));
ok(pendPersona.length === 0,
  'no queda ningún hueco de persona: solo SIGLAS_DIRECCION y la nota de TARA',
  pendPersona.map(p => p.tag).join(', '));

/* ============================================================
   11 bis · El esquema del DNI cabe en el límite de la API
   ------------------------------------------------------------
   La API admite como mucho 16 parámetros con unión (`anyOf`) por esquema, y
   un `valor` nullable gasta uno. Pasarse no da un aviso: devuelve 400 y
   TODA lectura de DNI deja de funcionar de golpe, en producción y sin que
   ningún test de aquí se entere. Por eso se cuenta desde fuera.
   ============================================================ */
console.log('\n11 bis · Presupuesto de uniones del esquema de Gest-IA');
/* Sin normalizar los saltos de línea esto no encuentra nada en Windows, donde
   git deja el fichero en CRLF, y un `✗` por el final de línea no dice nada. */
const FN = fs.readFileSync(
  path.join(RAIZ, 'supabase', 'functions', 'gestia-extraer', 'index.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

const perfilDni = /\bdni:\s*\{[\s\S]*?\n  \},\n  cif:/.exec(FN);
ok(!!perfilDni, 'se localiza el perfil `dni` en la Edge Function');
if (perfilDni) {
  const campos = perfilDni[0].match(/^\s{6}\w+:\s*\{/gm) || [];
  const simples = perfilDni[0].match(/simple:\s*true/g) || [];
  const uniones = campos.length - simples.length;
  console.log(`      ${campos.length} campos · ${simples.length} sin unión · ${uniones} uniones`);
  ok(uniones <= 16, `el perfil dni gasta ${uniones} uniones y el tope es 16`);
  ok(simples.length === 6, 'los seis campos del desglose de la vía van sin unión', String(simples.length));
}

/* ============================================================
   12 · Sexo · V hombre · H mujer · X empresa
   ============================================================ */
console.log('\n12 · Códigos de sexo');
ok(IA.sexoDe('hombre') === 'V', '«hombre» → V');
ok(IA.sexoDe('mujer') === 'H', '«mujer» → H  (H, no M)');
ok(IA.sexoDe('Mujer') === 'H', 'la caja da igual');
ok(IA.sexoDe('varón') === 'V', '«varón», con tilde, también');
ok(IA.sexoDe('M') === null, '«M» sola se descarta: en el DNI es masculino y aquí no es nada');
ok(IA.sexoDe('F') === null, '«F» sola se descarta igual');
ok(IA.sexoDe(null) === null, 'sin lectura, null');
ok(O.CONSTANTES.SEXOS.join('') === 'VHX', 'el exportador solo admite V, H o X');

/* Un sexo que no sea uno de los tres no llega al XML. */
const sexoRaro = O.construir(
  Object.assign({}, EXP_IA, {
    datos: Object.assign({}, EXP_IA.datos, { comprador_sexo: 'M' })
  }), { hoy: HOY });
ok(valorDe(elementos(sexoRaro.xml), 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/SEXO_ADQUIRIENTE') === '',
  'un «M» colado en el expediente sale VACÍO, no se traduce a ojo');

/* Una empresa es X aunque nadie lo haya leído de ningún documento. */
const empresaCompra = O.construir(
  Object.assign({}, EXP_IA, {
    datos: Object.assign({}, EXP_IA.datos, { comprador_tipo: 'empresa', comprador_sexo: null })
  }), { hoy: HOY });
ok(valorDe(elementos(empresaCompra.xml), 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/SEXO_ADQUIRIENTE') === 'X',
  'un comprador empresa es X por serlo, sin necesidad de lectura');

/* Y Gest-IA lo propone sola en cuanto aparece el CIF en el checklist. */
const conCif = IA.propuestas(trTransfer, [{ extraido: true, tipo: 'cif_comprador', perfil: 'cif', campos: {
  razon_social: c('EMPRESA EJEMPLO SL'), cif: c('B00000001'),
  domicilio: c('VIA EJEMPLO 1'), provincia: c('Barcelona') } }]);
ok(conCif.comprador_sexo && conCif.comprador_sexo.valor === 'X',
  'con un CIF en el checklist, Gest-IA propone X');

/* ============================================================
   13 · DNI caducado · avisa, no calla
   ============================================================ */
console.log('\n13 · DNI caducado');
const caducado = O.construir(
  Object.assign({}, EXP_IA, {
    datos: Object.assign({}, EXP_IA.datos, { vendedor_caducidad_nif: '2024-02-29' })
  }), { hoy: HOY });

ok(valorDe(elementos(caducado.xml), 'FORMATO_GA/TRANSMISION/DATOS_TRANSMITENTE/FECHA_CADUCIDAD_NIF_TRANSMITENTE')
  === '29/02/2024',
  'la fecha caducada va al XML tal cual: no se oculta ni se corrige');
ok(caducado.avisos.some(a => a.tipo === 'dni_caducado' && /vendedor/.test(a.texto)),
  'y salta el aviso de DNI caducado del vendedor');
ok(!rIA.avisos.some(a => a.tipo === 'dni_caducado'),
  'con los dos DNIs en vigor no salta ningún aviso de caducidad');

/* ============================================================
   14 · La config de demo se declara demo
   ============================================================ */
console.log('\n14 · Config de demo señalada');
ok(globalThis.GT_CONFIG.GESTORIA.demo === true,
  'GT_CONFIG.GESTORIA lleva `demo: true`');
ok(rIA.avisos.some(a => a.tipo === 'gestoria_demo'),
  'y el informe avisa de que el CIF y el colegiado son inventados');
ok(!O.construir(EXP_IA, { gestoria: GESTORIA, hoy: HOY })
  .avisos.some(a => a.tipo === 'gestoria_demo'),
  'con una gestoría real (sin la bandera) el aviso desaparece');

/* ============================================================
   15 · «SIETE VIENTOS 39 PBJ» · el bug que había
   ============================================================ */
console.log('\n15 · El nombre de la vía es solo el nombre de la vía');
const sv = O.partirDireccion('SIETE VIENTOS 39 PBJ');
ok(sv.via === 'SIETE VIENTOS', 'via = «SIETE VIENTOS», sin el número ni la planta', sv.via);
ok(sv.numero === '39', 'numero = 39', sv.numero);
ok(sv.restoSinUsar === 'PBJ',
  '«PBJ» queda apartado y señalado, no pegado al nombre de la calle', sv.restoSinUsar);

/* Sin DNI leído, el desglose no se inventa: solo vía y número. */
const soloTexto = O.construir({
  referencia: 'EXP-2026-0099', matricula: '1111 AAA',
  comprador_nombre: 'X', comprador_nif: '00000002S',
  comprador_direccion: 'SIETE VIENTOS 39 PBJ',
  vendedor_nombre: 'Y', vendedor_nif: '00000001R',
  datos: { comprador_tipo: 'particular', vendedor_tipo: 'particular' }
}, { hoy: HOY });
const eST = elementos(soloTexto.xml);
ok(valorDe(eST, 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/NOMBRE_VIA_DIRECCION_ADQUIRIENTE') === 'SIETE VIENTOS',
  'del texto libre sale la vía limpia');
ok(valorDe(eST, 'FORMATO_GA/TRANSMISION/DATOS_ADQUIRIENTE/PISO_DIRECCION_ADQUIRIENTE') === '',
  'pero el piso NO se deduce de «PBJ» sin ver el DNI');
ok(soloTexto.pendientes.some(p => p.tag === 'PISO_DIRECCION_ADQUIRIENTE' && /PBJ/.test(p.motivo)),
  'y el informe enseña lo que quedó sin repartir');

/* ============================================================ */
console.log('\n' + '='.repeat(52));
if (fallos) {
  console.log(`${fallos} comprobación(es) FALLIDA(S). No se mergea.\n`);
  process.exit(1);
}
console.log('Todo correcto: el XML calca la plantilla y no inventa nada.\n');
