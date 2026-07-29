#!/usr/bin/env node
/* ============================================================
   Verificación de los honorarios y del total al cliente
   ------------------------------------------------------------
   Aquí solo hay una regla que importa, y es la que se comprueba de
   cinco maneras distintas:

       EL IVA SE APLICA SOLO A LOS HONORARIOS.

   Ni al ITP —es un impuesto— ni a la tasa DGT —es un SUPLIDO, que por
   el art. 78.Tres.3.º LIVA no forma parte de la base imponible—. Meter
   cualquiera de los dos en la base del IVA le cobra al cliente un dinero
   que no debe y deja una factura mal emitida, y es un error que NO se ve:
   el total sale más alto y parece igual de correcto.

   Se ejecuta el módulo real (assets/js/honorarios.js), no una copia.

       node tools/verificar-honorarios.js

   Sale con código 1 a la primera discrepancia.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/* Los módulos del CRM son IIFE sobre `window`: se ejecutan tal cual. Va
   `tramites` porque `honorarios.js` lee los campos con `GTTramites.leer`,
   que es lo que resuelve columna propia vs. `datos`. */
global.window = globalThis;
['tramites', 'honorarios'].forEach(m =>
  (0, eval)(fs.readFileSync(path.join(RAIZ, 'assets', 'js', m + '.js'), 'utf8')));

const H = globalThis.GTHonorarios;
if (!H) { console.error('No se pudo cargar assets/js/honorarios.js'); process.exit(2); }

let fallos = 0;
function ok(cond, titulo, detalle) {
  if (cond) { console.log('  ✓ ' + titulo); return true; }
  fallos++;
  console.log('  ✗ ' + titulo + (detalle ? '\n      ' + detalle : ''));
  return false;
}

/** Un expediente con el ITP ya calculado. `calculo_json` es la prueba. */
const expediente = (extra) => Object.assign({
  itp_importe: 340,
  tasa_dgt: 55.7,
  calculo_json: { itp: 340, tasa_dgt: 55.7 },
  datos: {}
}, extra || {});

console.log('\nVerificación de honorarios · IVA solo sobre honorarios\n' + '='.repeat(56));

/* ============================================================
   1 · El caso del enunciado
   ============================================================ */
console.log('\n1 · Honorarios 100 € al 21%');

const base = H.calcular(expediente({ datos: { honorarios: 100 } }));

ok(base.honorarios === 100, 'honorarios = 100,00 €', String(base.honorarios));
ok(base.ivaTipo === 21, 'el tipo por defecto es el 21%', String(base.ivaTipo));
ok(base.iva === 21, 'IVA = 21,00 €  (100 × 21%)', String(base.iva));
ok(base.honorariosConIva === 121, 'honorarios con IVA = 121,00 €', String(base.honorariosConIva));
ok(base.itp === 340, 'el ITP se arrastra tal cual: 340,00 €', String(base.itp));
ok(base.tasaDgt === 55.7, 'la tasa DGT se arrastra tal cual: 55,70 €', String(base.tasaDgt));
ok(base.total === 516.7, 'TOTAL = 340 + 55,70 + 100 + 21 = 516,70 €', String(base.total));

/* ============================================================
   2 · El IVA NO toca ni al ITP ni a la tasa
   ------------------------------------------------------------
   La comprobación de verdad: si el IVA se colara en alguna de esas dos
   líneas, el total subiría y NADIE lo vería. Así que en vez de mirar el
   total, se comprueba de dónde sale.
   ============================================================ */
console.log('\n2 · El IVA no toca al ITP ni a la tasa DGT');

ok(base.total === base.itp + base.tasaDgt + base.honorarios + base.iva,
  'el total es exactamente la suma de las cuatro líneas',
  `${base.itp} + ${base.tasaDgt} + ${base.honorarios} + ${base.iva} ≠ ${base.total}`);

/* Con el mismo ITP y la misma tasa, DOBLAR los honorarios tiene que
   subir el total en (honorarios + su IVA) y en nada más. */
const doble = H.calcular(expediente({ datos: { honorarios: 200 } }));
ok(doble.total - base.total === 121,
  'doblar los honorarios sube el total en 121 € exactos (100 + su IVA)',
  String(doble.total - base.total));
ok(doble.itp === base.itp && doble.tasaDgt === base.tasaDgt,
  'y no mueve ni el ITP ni la tasa');

/* Sin honorarios NO hay IVA. Si el IVA tocara el ITP o la tasa, aquí
   saldría un importe: es la prueba más directa de las cinco. */
const sinHonorarios = H.calcular(expediente());
ok(sinHonorarios.iva === null,
  'sin honorarios NO hay IVA que cobrar (ni sobre el ITP ni sobre la tasa)',
  String(sinHonorarios.iva));
ok(sinHonorarios.total === 395.7,
  'y el total es solo impuesto + tasa: 395,70 €', String(sinHonorarios.total));

/* Con honorarios a 0 el IVA es 0: un cero es una tarifa declarada, no un
   hueco, y sigue sin arrastrar el ITP ni la tasa a la base. */
const cero = H.calcular(expediente({ datos: { honorarios: 0 } }));
ok(cero.iva === 0 && cero.total === 395.7,
  'honorarios a 0 → IVA 0 y el total sigue siendo impuesto + tasa',
  `iva=${cero.iva} total=${cero.total}`);

/* El ataque directo: un ITP y una tasa enormes con honorarios minúsculos.
   Si algo los sumara a la base, el IVA se dispararía. */
const desproporcion = H.calcular(expediente({
  itp_importe: 10000, tasa_dgt: 500,
  calculo_json: { itp: 10000 },
  datos: { honorarios: 1 }
}));
ok(desproporcion.iva === 0.21,
  'con ITP de 10.000 € y tasa de 500 €, el IVA de 1 € de honorarios sigue siendo 0,21 €',
  String(desproporcion.iva));
ok(desproporcion.total === 10501.21,
  'y el total es 10.000 + 500 + 1 + 0,21', String(desproporcion.total));

/* ============================================================
   3 · El tipo de IVA es editable y solo mueve los honorarios
   ============================================================ */
console.log('\n3 · Cambiar el tipo de IVA');

const alDiez = H.calcular(expediente({ datos: { honorarios: 100, honorarios_iva_tipo: 10 } }));
ok(alDiez.iva === 10, 'al 10%: IVA = 10,00 €', String(alDiez.iva));
ok(alDiez.honorariosConIva === 110, 'honorarios con IVA = 110,00 €', String(alDiez.honorariosConIva));
ok(alDiez.itp === 340 && alDiez.tasaDgt === 55.7,
  'el ITP y la tasa NO se mueven al cambiar el tipo',
  `itp=${alDiez.itp} tasa=${alDiez.tasaDgt}`);
ok(alDiez.total === 505.7, 'TOTAL = 340 + 55,70 + 100 + 10 = 505,70 €', String(alDiez.total));

const aCero = H.calcular(expediente({ datos: { honorarios: 100, honorarios_iva_tipo: 0 } }));
ok(aCero.iva === 0 && aCero.total === 495.7,
  'un tipo del 0% es un tipo, no un campo vacío: IVA 0 y total 495,70 €',
  `iva=${aCero.iva} total=${aCero.total}`);

/* ============================================================
   4 · Anti-invención
   ============================================================ */
console.log('\n4 · Anti-invención');

/* Sin cálculo del ITP no se suma un ITP imaginario. La prueba de que se
   calculó es `calculo_json`, NO `itp_importe`: el toggle de exención lo
   pone a 0 sin que nadie haya calculado nada. */
const sinCalcular = H.calcular({ itp_importe: 0, tasa_dgt: null, datos: { honorarios: 100 } });
ok(sinCalcular.hayCalculoItp === false, 'sin `calculo_json` no se da el ITP por calculado');
ok(sinCalcular.itp === null && sinCalcular.tasaDgt === null,
  'el ITP y la tasa salen vacíos, no a cero',
  `itp=${sinCalcular.itp} tasa=${sinCalcular.tasaDgt}`);
ok(sinCalcular.total === 121,
  'y el total suma SOLO lo que hay: honorarios + IVA = 121 €', String(sinCalcular.total));
ok(sinCalcular.faltan.some(f => /sin calcular/.test(f)),
  'el desglose declara que falta calcular el ITP', JSON.stringify(sinCalcular.faltan));

/* El caso que engaña: exento marcado sin haber calculado. `itp_importe`
   vale 0 y parecería un ITP calculado de 0 €. */
const exentoSinCalcular = H.calcular({ itp_importe: 0, tasa_dgt: 55.7, datos: { itp_exento: true, honorarios: 100 } });
ok(exentoSinCalcular.itp === null && exentoSinCalcular.tasaDgt === null,
  'un «exento» sin cálculo no se cuela como un ITP de 0 € ni arrastra la tasa',
  `itp=${exentoSinCalcular.itp} tasa=${exentoSinCalcular.tasaDgt}`);

/* Vacío total: no hay total que enseñar, y se dice. */
const nada = H.calcular({ datos: {} });
ok(nada.total === null, 'sin ITP y sin honorarios no hay total: null, no 0 €', String(nada.total));
ok(nada.faltan.length === 2, 'y se declaran los dos huecos', JSON.stringify(nada.faltan));

/* Un expediente exento CON cálculo sí suma: el ITP es 0 de verdad. */
const exento = H.calcular(expediente({
  itp_importe: 0, calculo_json: { itp: 340 },
  datos: { itp_exento: true, honorarios: 100 }
}));
ok(exento.exentoItp === true, 'la exención se declara en el desglose');
ok(exento.itp === 0 && exento.total === 176.7,
  'exento con cálculo: ITP 0 € y total = 55,70 + 100 + 21 = 176,70 €',
  `itp=${exento.itp} total=${exento.total}`);

/* Basura en el campo no es un número: no se interpreta a ojo. */
const basura = H.calcular(expediente({ datos: { honorarios: 'cien euros' } }));
ok(basura.honorarios === null && basura.iva === null,
  'un texto en el campo de honorarios no se convierte en cifra',
  `honorarios=${basura.honorarios}`);

/* ============================================================
   5 · Céntimos · la suma de las líneas es el total impreso
   ============================================================ */
console.log('\n5 · Redondeo a céntimo');

ok(H.centimos(0.1 + 0.2) === 0.3, '0,1 + 0,2 = 0,30 € y no 0,30000000000000004');

/* 33,33 × 21% = 6,9993 → 7,00 €. Si la milésima se arrastrara, el total
   no cuadraría con la suma de las líneas que se imprimen. */
const milesimas = H.calcular(expediente({ datos: { honorarios: 33.33 } }));
ok(milesimas.iva === 7, '33,33 € al 21% → IVA 7,00 € (6,9993 redondeado)', String(milesimas.iva));
ok(milesimas.honorariosConIva === 40.33, 'con IVA = 40,33 €', String(milesimas.honorariosConIva));
ok(milesimas.total === H.centimos(milesimas.itp + milesimas.tasaDgt + milesimas.honorarios + milesimas.iva),
  'el total cuadra al céntimo con las cuatro líneas impresas', String(milesimas.total));

/* Un tipo con decimales tampoco descuadra. */
const decimal = H.calcular(expediente({ datos: { honorarios: 99.99, honorarios_iva_tipo: 21 } }));
ok(decimal.iva === 21, '99,99 € al 21% → 21,00 € (20,9979 redondeado)', String(decimal.iva));

/* ============================================================
   6 · El total guardado no se queda atrás
   ------------------------------------------------------------
   `conTotal` es el único sitio que escribe `honorarios_total_cliente`, y
   por él pasan los tres caminos que mueven las cifras: guardar honorarios,
   calcular el ITP y marcar la exención. Si alguno se lo saltara, quedaría
   un total antiguo guardado contradiciendo a las otras cuatro cifras.
   ============================================================ */
console.log('\n6 · El total guardado se recalcula, no se hereda');

const exp1 = expediente({ datos: { honorarios: 100 } });
const d1 = H.conTotal(exp1, exp1.datos);
ok(d1.honorarios_total_cliente === 516.7,
  'al guardar honorarios se escribe el total: 516,70 €', String(d1.honorarios_total_cliente));

// Ahora se recalcula el ITP y sube a 480 €: el total tiene que seguirlo.
const exp2 = Object.assign({}, exp1, { itp_importe: 480, datos: d1 });
const d2 = H.conTotal(exp2, d1);
ok(d2.honorarios_total_cliente === 656.7,
  'recalculado el ITP a 480 €, el total pasa a 656,70 € y no se queda en 516,70',
  String(d2.honorarios_total_cliente));

// Y si se quitan los honorarios, el total baja a solo impuesto + tasa.
const sinHon = Object.assign({}, d2);
delete sinHon.honorarios;
const d3 = H.conTotal(Object.assign({}, exp2, { datos: sinHon }), sinHon);
ok(d3.honorarios_total_cliente === 535.7,
  'quitados los honorarios, el total vuelve a impuesto + tasa: 535,70 €',
  String(d3.honorarios_total_cliente));

// Sin nada que sumar no se deja un total escrito de antes.
const d4 = H.conTotal({ datos: {} }, {});
ok(d4.honorarios_total_cliente === undefined,
  'sin nada que sumar no queda ningún total guardado',
  JSON.stringify(d4));

/* ============================================================ */
console.log('\n' + '='.repeat(56));
if (fallos) {
  console.log(`${fallos} comprobación(es) FALLIDA(S). No se mergea.\n`);
  process.exit(1);
}
console.log('Todo correcto: el IVA solo toca los honorarios.\n');
