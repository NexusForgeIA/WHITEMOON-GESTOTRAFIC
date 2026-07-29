#!/usr/bin/env node
/* ============================================================
   Verificación del cambio de servicio y su bloqueo
   ------------------------------------------------------------
   Dos cosas que NO son la misma, y que aquí se comprueban por separado:

     1 · REGISTRAR el cambio · siempre que el gestor lo marque, haya
         bloqueo o no. Sale en el XML como CAMBIO_SERVICIO = SI.
     2 · BLOQUEAR la tramitación · solo cuando el CÓDIGO de clasificación
         tiene que cambiar y la ficha técnica todavía no lo refleja.

   La regla es POR CÓDIGO, no por etiqueta. Taxi y Particular tienen el
   MISMO código (1000), así que ese cambio de servicio se registra pero
   no bloquea nada: mandar a la ITV a quien no tiene que ir es un error
   tan real como dejar pasar al que sí.

   Se comprueban los dos caminos —alta manual y Gest-IA— sobre el módulo
   real, y que el XML de OEGAM registre el cambio sin inventarse el
   código de servicio de OEGAM, que es otra tabla y no la tenemos.

       node tools/verificar-servicio.js

   Sale con código 1 a la primera discrepancia.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/* Los módulos del CRM son IIFE sobre `window`: se ejecutan tal cual. El
   orden importa —`tramites` monta sus desplegables con `servicio` ya
   cargado— y es el mismo de app.html. */
global.window = globalThis;
['config', 'servicio', 'tramites', 'gestia', 'oegam'].forEach(m =>
  (0, eval)(fs.readFileSync(path.join(RAIZ, 'assets', 'js', m + '.js'), 'utf8')));

const S = globalThis.GTServicio;
const O = globalThis.GTOegam;
const IA = globalThis.GTGestIA;
const TR = globalThis.GTTramites;
if (!S || !O || !IA || !TR) { console.error('No se pudieron cargar los módulos'); process.exit(2); }

let fallos = 0;
function ok(cond, titulo, detalle) {
  if (cond) { console.log('  ✓ ' + titulo); return true; }
  fallos++;
  console.log('  ✗ ' + titulo + (detalle ? '\n      ' + detalle : ''));
  return false;
}

/** Expediente de transferencia con el cambio de servicio que se le diga. */
const exp = (datos) => ({
  referencia: 'EXP-2026-0001', matricula: '0000XXX',
  marca: 'Marca', modelo: 'Modelo', fecha_matriculacion: '2020-01-01',
  comprador_nombre: 'C', comprador_nif: '00000002S',
  vendedor_nombre: 'V', vendedor_nif: '00000001R',
  datos: Object.assign({ comprador_tipo: 'particular', vendedor_tipo: 'particular' }, datos || {})
});

const cambio = (anterior, destino, extra) => exp(Object.assign({
  cambio_servicio: 'si', servicio_anterior: anterior, servicio_destino: destino
}, extra || {}));

console.log('\nVerificación del cambio de servicio\n' + '='.repeat(52));

/* ============================================================
   1 · Los códigos confirmados, y solo esos
   ============================================================ */
console.log('\n1 · Catálogo de servicios');

const cod = (id) => (S.servicio(id) || {}).codigo;
ok(cod('particular') === '1000', 'Particular = 1000', String(cod('particular')));
ok(cod('taxi') === '1000', 'Taxi = 1000 (el MISMO que particular)', String(cod('taxi')));
ok(cod('vtc') === '1041', 'VTC = 1041', String(cod('vtc')));
ok(cod('asn') === '1003', 'ASN (alquiler sin conductor) = 1003', String(cod('asn')));

const conCodigo = S.SERVICIOS.filter(s => s.codigo !== null).map(s => s.codigo).sort();
ok(JSON.stringify(conCodigo) === JSON.stringify(['1000', '1000', '1003', '1041']),
  'no hay ningún código más que los tres confirmados', JSON.stringify(conCodigo));
ok(S.SERVICIOS.some(s => s.codigo === null),
  'y los servicios sin código confirmado se declaran con null, no con un número inventado');

/* ============================================================
   2 · Sin cambio de servicio no pasa nada
   ============================================================ */
console.log('\n2 · Sin cambio de servicio');

const sin = S.evaluar(exp());
ok(sin.cambia === false, 'no hay cambio que registrar');
ok(sin.bloqueado === false, 'y no se bloquea nada');
ok(S.puedeIrA(exp(), 'tramitacion').puede === true, 'el expediente puede pasar a tramitación');

const xmlSin = O.construir(exp(), { hoy: new Date(2026, 0, 1) }).xml;
ok(/<CAMBIO_SERVICIO>NO<\/CAMBIO_SERVICIO>/.test(xmlSin),
  'el XML sale con CAMBIO_SERVICIO = NO');

/* ============================================================
   3 · Taxi → Particular · MISMO código: registra, NO bloquea
   ============================================================ */
console.log('\n3 · Taxi → Particular (1000 → 1000)');

const taxi = S.evaluar(cambio('taxi', 'particular'));
ok(taxi.cambia === true, 'el cambio de servicio se registra');
ok(taxi.mismoCodigo === true, 'los dos códigos son 1000: el mismo');
ok(taxi.requiereItv === false, 'NO requiere pasar por la ITV');
ok(taxi.bloqueado === false, 'y NO bloquea la tramitación', taxi.motivo);
ok(S.puedeIrA(cambio('taxi', 'particular'), 'tramitacion').puede === true,
  'el expediente puede pasar a tramitación');

/* Y sin haber leído la ficha técnica siquiera: si los códigos coinciden,
   no hay nada que comprobar en ella. */
ok(S.evaluar(cambio('taxi', 'particular', { clasificacion_codigo: null })).bloqueado === false,
  'tampoco bloquea cuando no consta el código de la ficha: no hace falta');

const rTaxi = O.construir(cambio('taxi', 'particular'), { hoy: new Date(2026, 0, 1) });
ok(/<CAMBIO_SERVICIO>SI<\/CAMBIO_SERVICIO>/.test(rTaxi.xml),
  'el XML sale con CAMBIO_SERVICIO = SI');
ok(!rTaxi.avisos.some(a => a.tipo === 'cambio_servicio_bloqueado'),
  'y el informe no avisa de ningún bloqueo');

/* ============================================================
   4 · VTC → Particular · códigos distintos: BLOQUEA hasta la ITV
   ============================================================ */
console.log('\n4 · VTC → Particular (1041 → 1000)');

const vtcEnOrigen = S.evaluar(cambio('vtc', 'particular', { clasificacion_codigo: '1041' }));
ok(vtcEnOrigen.requiereItv === true, 'requiere cambio de clasificación en la ITV');
ok(vtcEnOrigen.bloqueado === true, 'con la ficha todavía en 1041: BLOQUEADO', vtcEnOrigen.motivo);
ok(/1041→1000/.test(vtcEnOrigen.aviso || ''),
  'el aviso dice el cambio exacto: 1041→1000', vtcEnOrigen.aviso);
ok(/ITV/.test(vtcEnOrigen.aviso || '') && /ficha técnica/i.test(vtcEnOrigen.aviso || ''),
  'y que la ficha técnica debe reflejar el destino antes de transferir');

const paso = S.puedeIrA(cambio('vtc', 'particular', { clasificacion_codigo: '1041' }), 'tramitacion');
ok(paso.puede === false, 'no deja pasar a tramitación');
ok(S.puedeIrA(cambio('vtc', 'particular', { clasificacion_codigo: '1041' }), 'documentacion').puede === true,
  'pero sí deja volver a documentación: el bloqueo es para adelante');

const vtcEnDestino = S.evaluar(cambio('vtc', 'particular', { clasificacion_codigo: '1000' }));
ok(vtcEnDestino.bloqueado === false, 'con la ficha ya en 1000: DESBLOQUEADO', vtcEnDestino.motivo);
ok(vtcEnDestino.fichaEnDestino === true, 'y consta que la ficha muestra el destino');
ok(S.puedeIrA(cambio('vtc', 'particular', { clasificacion_codigo: '1000' }), 'tramitacion').puede === true,
  'ya puede pasar a tramitación');

/* Sin código de la ficha NO se da por bueno: un hueco no es un permiso. */
const vtcSinFicha = S.evaluar(cambio('vtc', 'particular'));
ok(vtcSinFicha.bloqueado === true,
  'sin código de la ficha sigue BLOQUEADO: un hueco no desbloquea', vtcSinFicha.motivo);
ok(/No consta el código/.test(vtcSinFicha.aviso || ''), 'y se dice que falta leerlo');

/* Un código que no es ni el origen ni el destino tampoco cuela. */
const vtcOtro = S.evaluar(cambio('vtc', 'particular', { clasificacion_codigo: '2000' }));
ok(vtcOtro.bloqueado === true, 'un código distinto de los dos tampoco desbloquea', vtcOtro.motivo);

/* La salida a mano: el gestor lo confirma con la ficha delante. */
const vtcConfirmado = S.evaluar(cambio('vtc', 'particular',
  { clasificacion_codigo: '1041', servicio_itv_confirmado: 'si' }));
ok(vtcConfirmado.bloqueado === false,
  'el gestor puede desbloquearlo a mano confirmándolo', vtcConfirmado.motivo);

/* El XML registra el cambio aunque esté bloqueado, y lo AVISA. */
const rVtc = O.construir(cambio('vtc', 'particular', { clasificacion_codigo: '1041' }),
  { hoy: new Date(2026, 0, 1) });
ok(/<CAMBIO_SERVICIO>SI<\/CAMBIO_SERVICIO>/.test(rVtc.xml),
  'el XML registra CAMBIO_SERVICIO = SI aunque esté bloqueado');
ok(rVtc.avisos.some(a => a.tipo === 'cambio_servicio_bloqueado' && /1041→1000/.test(a.texto)),
  'y el informe avisa del bloqueo antes de importar');

/* ============================================================
   5 · ASN → Particular · igual que VTC
   ============================================================ */
console.log('\n5 · ASN → Particular (1003 → 1000)');

const asnEnOrigen = S.evaluar(cambio('asn', 'particular', { clasificacion_codigo: '1003' }));
ok(asnEnOrigen.bloqueado === true, 'con la ficha en 1003: BLOQUEADO', asnEnOrigen.motivo);
ok(/1003→1000/.test(asnEnOrigen.aviso || ''), 'el aviso dice 1003→1000', asnEnOrigen.aviso);
ok(S.evaluar(cambio('asn', 'particular', { clasificacion_codigo: '1000' })).bloqueado === false,
  'con la ficha ya en 1000: DESBLOQUEADO');

/* ============================================================
   6 · Anti-invención
   ============================================================ */
console.log('\n6 · Anti-invención');

/* Un servicio sin código confirmado NO es «no bloquea»: es que no se
   puede decidir, y entonces se pide. Es la trampa de este módulo. */
const otro = S.evaluar(cambio('otro', 'particular'));
ok(otro.bloqueado === true,
  'un servicio sin código confirmado BLOQUEA en vez de dejar pasar', otro.motivo);
ok(/no está en el catálogo|No consta el código/i.test(otro.aviso || ''),
  'y el aviso pide el código en lugar de suponerlo', otro.aviso);
ok(otro.motivo === 'codigo_sin_confirmar', 'con su motivo propio', otro.motivo);

/* Marcado el cambio pero sin decir de qué a qué: tampoco se supone. */
const aMedias = S.evaluar(exp({ cambio_servicio: 'si' }));
ok(aMedias.bloqueado === true && aMedias.motivo === 'faltan_servicios',
  'marcar el cambio sin indicar origen y destino bloquea y lo dice', aMedias.motivo);

/* El código de OEGAM para SERVICIO es OTRA tabla, y no la tenemos: sus
   tags salen VACÍOS, igual que SIGLAS_DIRECCION. */
const eVtc = rVtc.xml;
ok(/<SERVICIO_ANTERIOR\/>/.test(eVtc) && /<SERVICIO\/>/.test(eVtc) && /<SERVICIO_DESTINO\/>/.test(eVtc),
  'SERVICIO_ANTERIOR, SERVICIO y SERVICIO_DESTINO salen VACÍOS: su catálogo es de OEGAM');
ok(rVtc.pendientes.some(p => /SERVICIO/.test(p.tag) && /1041|VTC/.test(p.motivo)),
  'pero el informe dice qué servicio es y con qué código de clasificación',
  JSON.stringify(rVtc.pendientes.filter(p => /SERVICIO/.test(p.tag))));

/* ============================================================
   7 · El mismo comportamiento por el camino de Gest-IA
   ------------------------------------------------------------
   Gest-IA no decide nada distinto: lee el código de la ficha técnica y lo
   deja en el expediente, y a partir de ahí la regla es la misma función.
   ============================================================ */
console.log('\n7 · Por el camino de Gest-IA');

const c = (valor) => ({ valor, confianza: 'alta', nota: '' });
const fichaConCodigo = (codigo) => ({
  extraido: true, tipo: 'ficha_tecnica', perfil: 'ficha_tecnica',
  legible: true, observacion: '', campos: {
    marca: c('Mercedes-Benz'), modelo: c('Clase A 180 d'),
    bastidor: c('WDD1760121J000000'), matricula: c('4821 NBH'),
    fecha_matriculacion: c('2019-06-10'), combustible: c('Diesel'),
    cvf: c('9.5'), cilindrada: c('1461'), clasificacion: c('TURISMO'),
    clasificacion_codigo: c(codigo)
  }
});

const trTransfer = TR.tramite('transferencia');

/* El código de la ficha llega al expediente por el mapeo real. */
const props1041 = IA.propuestas(trTransfer, [fichaConCodigo('1041')]);
ok(props1041.clasificacion_codigo && props1041.clasificacion_codigo.valor === '1041',
  'Gest-IA propone el código de clasificación leído de la ficha (1041)',
  JSON.stringify(props1041.clasificacion_codigo));

const filaIA = IA.aExpediente(trTransfer, props1041, {
  comprador_tipo: 'particular', vendedor_tipo: 'particular',
  cambio_servicio: 'si', servicio_anterior: 'vtc', servicio_destino: 'particular'
});
const expIA = Object.assign({ referencia: 'EXP-2026-0042' }, filaIA);
const rIA = S.evaluar(expIA);
ok(rIA.fichaCodigo === '1041', 'el expediente montado por Gest-IA lleva el código 1041', String(rIA.fichaCodigo));
ok(rIA.bloqueado === true, 'y queda BLOQUEADO con el mismo motivo', rIA.motivo);
ok(rIA.aviso === S.evaluar(cambio('vtc', 'particular', { clasificacion_codigo: '1041' })).aviso,
  'el aviso es EXACTAMENTE el mismo que por el camino manual');

/* Con la ficha ya cambiada, Gest-IA desbloquea igual. */
const filaOk = IA.aExpediente(trTransfer, IA.propuestas(trTransfer, [fichaConCodigo('1000')]), {
  comprador_tipo: 'particular', vendedor_tipo: 'particular',
  cambio_servicio: 'si', servicio_anterior: 'vtc', servicio_destino: 'particular'
});
ok(S.evaluar(Object.assign({ referencia: 'X' }, filaOk)).bloqueado === false,
  'y con la ficha ya en 1000 desbloquea, igual que a mano');

/* Si el modelo NO lee el código, no se inventa: queda para el gestor. */
const propsNull = IA.propuestas(trTransfer, [fichaConCodigo(null)]);
const filaNull = IA.aExpediente(trTransfer, propsNull, {
  comprador_tipo: 'particular', vendedor_tipo: 'particular',
  cambio_servicio: 'si', servicio_anterior: 'vtc', servicio_destino: 'particular'
});
const rNull = S.evaluar(Object.assign({ referencia: 'X' }, filaNull));
ok(rNull.fichaCodigo === null, 'un código que no se lee queda en blanco, no se supone');
ok(rNull.bloqueado === true, 'y el expediente sigue bloqueado hasta que alguien lo mire', rNull.motivo);

/* ============================================================
   8 · El formulario declara los campos (alta manual)
   ============================================================ */
console.log('\n8 · El formulario del trámite los declara');

const nombres = TR.campos(trTransfer).map(x => x.n);
['cambio_servicio', 'servicio_anterior', 'servicio_destino',
  'servicio_itv_confirmado', 'clasificacion_codigo'].forEach(n => {
  ok(nombres.indexOf(n) !== -1, `la ficha declara ${n}`);
});

const campo = (n) => TR.campos(trTransfer).find(x => x.n === n);
ok(campo('cambio_servicio').def === 'no', 'por defecto NO cambia de servicio');
['servicio_anterior', 'servicio_destino', 'servicio_itv_confirmado'].forEach(n => {
  const c2 = campo(n);
  ok(c2.soloSi && c2.soloSi.campo === 'cambio_servicio' && c2.soloSi.valor === 'si',
    `${n} solo se pide cuando hay cambio de servicio`);
});
/* El código de la ficha NO se oculta: si lo hiciera, `recoger()` lo
   vaciaría al desmarcar el cambio y se perdería lo que leyó Gest-IA. */
ok(!campo('clasificacion_codigo').soloSi,
  'el código de clasificación se pide siempre: ocultarlo lo borraría al guardar');
ok(!campo('clasificacion_codigo').col && !campo('cambio_servicio').col,
  'todo va a `datos` (jsonb): sin migración');

/* Los desplegables ofrecen exactamente el catálogo del módulo. */
const ops = campo('servicio_destino').op.filter(o => o.v).map(o => o.v).sort();
const ids = S.SERVICIOS.map(s => s.id).sort();
ok(JSON.stringify(ops) === JSON.stringify(ids),
  'el desplegable ofrece exactamente los servicios del catálogo',
  JSON.stringify(ops) + ' vs ' + JSON.stringify(ids));

/* ============================================================ */
console.log('\n' + '='.repeat(52));
if (fallos) {
  console.log(`${fallos} comprobación(es) FALLIDA(S). No se mergea.\n`);
  process.exit(1);
}
console.log('Todo correcto: se registra siempre, se bloquea solo por código.\n');
