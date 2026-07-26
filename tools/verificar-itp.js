#!/usr/bin/env node
/* ============================================================
   Verificación del motor fiscal · gestotrafic-itp
   ------------------------------------------------------------
   CLAUDE.md exige que cualquier cambio en `gestotrafic-itp` o en los
   precios se valide contra la calculadora de producción, y que el valor
   venal, la base imponible y la cuota coincidan AL CÉNTIMO.

   Este script lo automatiza. No reimplementa el cálculo: extrae del
   index.html de la calculadora sus tablas y funciones reales y las
   ejecuta, así que si producción cambia, cambia la referencia.

       node tools/verificar-itp.js [ruta/al/calculadora-itp/index.html]

   Sale con código 1 si algún caso discrepa. Cubre:
     · los tres casos de referencia de CLAUDE.md (regresión),
     · el valor base automático de turismos (Anexo I) y de motos (tramo),
     · las ramas fiscales: exención, cuota fija, ECO, >15 CVf, uso especial,
     · y los dos casos en los que el motor DEBE negarse a calcular.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const CALC = process.argv[2] || path.join(
  __dirname, '..', '..', 'WHITEMOON-WEB', 'calculadora-itp', 'index.html');

const URL = 'https://mlaqtniujnvfxcvcourm.supabase.co/functions/v1/gestotrafic-itp';
// Clave publicable: es pública por diseño (el acceso lo controla RLS).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sYXF0bml1am52ZnhjdmNvdXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzUyMzIsImV4cCI6MjA5MzQxMTIzMn0.Neh7VUS8ADsxf0DPab0JoJyGXOAXnLIaXzXbKzj2BGs';

const TRANS = '2026-07-26';   // fecha de transmisión fija: los casos son deterministas

/* ---------- La calculadora de producción, tal cual ---------- */

if (!fs.existsSync(CALC)) {
  console.error(`No encuentro la calculadora de producción en:\n  ${CALC}\n` +
                'Pásala como argumento: node tools/verificar-itp.js <ruta/index.html>');
  process.exit(2);
}
const HTML = fs.readFileSync(CALC, 'utf8');

function saca(re, nombre) {
  const m = HTML.match(re);
  if (!m) throw new Error('No se encontró en la calculadora: ' + nombre);
  return m[0];
}

const P = new Function('tablaAutocaravanas', 'tablaEmbarcaciones', [
  saca(/const tablaTurismos = \[[\s\S]*?\];/, 'tablaTurismos'),
  saca(/const ccaaData = \{[\s\S]*?\n\};/, 'ccaaData'),
  saca(/const valencianaCuotas = \{[\s\S]*?\n\};/, 'valencianaCuotas'),
  saca(/function aniosUso\([\s\S]*?\n\}/, 'aniosUso'),
  saca(/function buscarPctDepreciacion\([\s\S]*?\n\}/, 'buscarPctDepreciacion'),
  saca(/function cuotaFijaValenciana\([\s\S]*?\n\}/, 'cuotaFijaValenciana'),
  saca(/function cuotaFijaEstandar\([\s\S]*?\n\}/, 'cuotaFijaEstandar'),
  saca(/function calcularTipoNormal\([\s\S]*?\n\}/, 'calcularTipoNormal'),
].join('\n') + `
  return { ccaaData, aniosUso, buscarPctDepreciacion, cuotaFijaValenciana,
           cuotaFijaEstandar, calcularTipoNormal };`)([], []);

/* Secuencia de cálculo copiada de calcular() en el index.html de producción. */
function calculadoraProduccion(v, esMoto) {
  const anos = P.aniosUso(v.fecha_matriculacion, v.fecha_transmision);
  const pct = P.buscarPctDepreciacion('turismo-coche', anos);
  const p = P.ccaaData[v.ccaa];
  if (!p) throw new Error('CCAA desconocida en la calculadora: ' + v.ccaa);

  const valorFiscal = v.valor_boe * pct[1] * (v.uso_especial ? 0.7 : 1);
  let baseImponible = valorFiscal;
  if (v.precio_contrato > 0 && v.precio_contrato > valorFiscal) baseImponible = v.precio_contrato;

  let itp = 0;
  if (p.exA > 0 && anos >= p.exA && v.valor_boe < p.exV) {
    itp = 0;
  } else if (v.ccaa === 'Comunidad Valenciana') {
    const cf = P.cuotaFijaValenciana(anos, v.cilindrada, baseImponible, !!esMoto);
    itp = cf ? cf.cuota : P.calcularTipoNormal(p, v.etiqueta_dgt, v.cvf, baseImponible).itp;
  } else if (p.cA > 0 && anos >= p.cA) {
    const cuota = P.cuotaFijaEstandar(p, anos, v.cilindrada);
    itp = cuota !== null ? cuota : P.calcularTipoNormal(p, v.etiqueta_dgt, v.cvf, baseImponible).itp;
  } else {
    itp = P.calcularTipoNormal(p, v.etiqueta_dgt, v.cvf, baseImponible).itp;
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  return { valor_venal: r2(valorFiscal), base_imponible: r2(baseImponible), itp: r2(itp) };
}

/* ---------- Casos ----------
   `base` es el valor del Anexo I que se espera. En los casos automáticos el
   motor tiene que resolverlo solo; si resolviera otra fila, las cifras
   dejarían de cuadrar y el caso falla. */
const CASOS = [
  { n: 'REF · turismo 2019, base manual 19.800, contrato 8.600', base: 19800,
    p: { tipo_vehiculo:'coche', valor_boe:19800, precio_contrato:8600,
         fecha_matriculacion:'2019-03-15', ccaa:'Comunidad de Madrid' } },
  { n: 'REF · moto 600 cc 2018, base por tramo', base: 6700, esMoto: true,
    p: { tipo_vehiculo:'moto', cilindrada:600, fecha_matriculacion:'2018-04-19',
         ccaa:'Comunidad de Madrid' } },
  { n: 'REF · moto eléctrica 11 kW 2022, base por tramo', base: 4500, esMoto: true,
    p: { tipo_vehiculo:'moto_electrica', potencia_kw:11,
         fecha_matriculacion:'2022-05-10', ccaa:'Comunidad de Madrid' } },

  { n: 'Anexo I · SEAT IBIZA 1.0 TSI Style (2021), Madrid', base: 13600,
    p: { tipo_vehiculo:'coche', marca:'SEAT', modelo:'IBIZA',
         version:'IBIZA 1.0 TSI Style (2021)', fecha_matriculacion:'2021-06-15',
         ccaa:'Comunidad de Madrid', cilindrada:999, cvf:7.83, etiqueta_dgt:'C' } },
  { n: 'Anexo I · SEAT IBIZA Style Plus, contrato 8.500 manda', base: 16900,
    p: { tipo_vehiculo:'coche', marca:'SEAT', modelo:'IBIZA',
         version:'IBIZA 1.0 TSI Style Plus (2021)', fecha_matriculacion:'2021-03-01',
         ccaa:'Comunidad de Madrid', cilindrada:999, cvf:7.83, etiqueta_dgt:'C',
         precio_contrato:8500 } },
  { n: 'Anexo I · TESLA MODEL 3 Gran Autonomía RWD, Cataluña, etiqueta 0', base: 48300,
    p: { tipo_vehiculo:'coche', marca:'TESLA', modelo:'MODEL',
         version:'MODEL 3 Gran Autonomía RWD', fecha_matriculacion:'2020-09-10',
         ccaa:'Cataluña', cvf:43.67, etiqueta_dgt:'0' } },
  { n: 'Anexo I · TESLA MODEL 3 Performance AWD, Galicia, etiqueta 0', base: 57600,
    p: { tipo_vehiculo:'coche', marca:'TESLA', modelo:'MODEL',
         version:'MODEL 3 Performance AWD', fecha_matriculacion:'2021-01-20',
         ccaa:'Galicia', cvf:70.07, etiqueta_dgt:'0' } },
  { n: 'Anexo I · CLIO Authentique 3p, fila fijada por id (63 kW)', base: 11400,
    p: { tipo_vehiculo:'coche', valor_base_id:'9f7ef3df-718a-4d14-b671-781881387d7e',
         fecha_matriculacion:'2011-05-10', ccaa:'Comunidad de Madrid',
         cilindrada:1461, cvf:11.03 } },

  { n: 'Rama · Andalucía, >15 CVf (8%)', base: 20500,
    p: { tipo_vehiculo:'coche', valor_boe:20500, fecha_matriculacion:'2016-02-10',
         ccaa:'Andalucía', cilindrada:1968, cvf:16.5 } },
  { n: 'Rama · Cataluña, exención por antigüedad', base: 12000,
    p: { tipo_vehiculo:'coche', valor_boe:12000, fecha_matriculacion:'2012-01-10',
         ccaa:'Cataluña', cilindrada:1600, cvf:9.5 } },
  { n: 'Rama · Aragón, cuota fija (>10 años, 1.400 cc)', base: 9000,
    p: { tipo_vehiculo:'coche', valor_boe:9000, fecha_matriculacion:'2012-06-01',
         ccaa:'Aragón', cilindrada:1400, cvf:9.0 } },
  { n: 'Rama · C. Valenciana, cuota fija coche 5-12 años', base: 9000,
    p: { tipo_vehiculo:'coche', valor_boe:9000, fecha_matriculacion:'2018-06-01',
         ccaa:'Comunidad Valenciana', cilindrada:1600, cvf:9.0 } },
  { n: 'Rama · Baleares, etiqueta ECO (2%)', base: 24000,
    p: { tipo_vehiculo:'coche', valor_boe:24000, fecha_matriculacion:'2021-04-01',
         ccaa:'Baleares', cilindrada:1600, cvf:9.0, etiqueta_dgt:'ECO' } },
  { n: 'Rama · Madrid, uso especial (taxi) al 70%', base: 18000,
    p: { tipo_vehiculo:'coche', valor_boe:18000, fecha_matriculacion:'2020-02-01',
         ccaa:'Comunidad de Madrid', cilindrada:1600, cvf:9.0, uso_especial:true } }
];

async function motor(payload) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', apikey: ANON },
    body: JSON.stringify(payload)
  });
  return res.json();
}

(async () => {
  let fallos = 0;
  const filas = [];

  for (const c of CASOS) {
    const r = await motor({ ...c.p, fecha_transmision: TRANS });
    if (r.error) {
      console.log(`FALLO · ${c.n}\n    el motor devolvió: ${r.error} ${r.mensaje || ''}`);
      fallos++;
      continue;
    }
    const esp = calculadoraProduccion({
      valor_boe: c.base,
      fecha_matriculacion: c.p.fecha_matriculacion, fecha_transmision: TRANS,
      ccaa: c.p.ccaa, cilindrada: c.p.cilindrada || 0, cvf: c.p.cvf || 0,
      etiqueta_dgt: c.p.etiqueta_dgt || '', precio_contrato: c.p.precio_contrato || 0,
      uso_especial: !!c.p.uso_especial
    }, c.esMoto);

    const ok = r.detalle.valor_boe === c.base
            && r.valor_venal === esp.valor_venal
            && r.base_imponible === esp.base_imponible
            && r.itp === esp.itp;
    if (!ok) fallos++;
    filas.push({
      caso: c.n,
      'base Anexo I': r.detalle.valor_boe === c.base ? String(c.base) : `${r.detalle.valor_boe} ≠ ${c.base}`,
      origen: r.detalle.valor_base_origen,
      'venal calc/motor': `${esp.valor_venal} / ${r.valor_venal}`,
      'base calc/motor': `${esp.base_imponible} / ${r.base_imponible}`,
      'ITP calc/motor': `${esp.itp} / ${r.itp}`,
      '': ok ? 'OK' : 'FALLO'
    });
  }
  console.table(filas);

  /* El motor tiene que NEGARSE a calcular en estos dos casos. */
  const amb = await motor({ tipo_vehiculo:'coche', marca:'RENAULT', modelo:'CLIO',
    version:'CLIO 1.5 DCI Authentique 3p', fecha_matriculacion:'2011-05-10',
    fecha_transmision: TRANS, ccaa:'Comunidad de Madrid' });
  const okAmb = amb.error === 'sin_valor_boe' && amb.motivo === 'varias_versiones'
             && (amb.candidatos || []).length > 1;
  console.log(`\nVarias versiones → ${amb.error}/${amb.motivo}, ` +
              `${(amb.candidatos || []).length} candidatos · ${okAmb ? 'OK' : 'FALLO'}`);
  if (!okAmb) fallos++;

  const sin = await motor({ tipo_vehiculo:'coche', marca:'NOEXISTE', modelo:'FANTASMA',
    fecha_matriculacion:'2018-01-01', fecha_transmision: TRANS, ccaa:'Comunidad de Madrid' });
  const okSin = sin.error === 'sin_valor_boe' && sin.motivo === 'sin_match';
  console.log(`Sin match        → ${sin.error}/${sin.motivo} · ${okSin ? 'OK' : 'FALLO'}`);
  if (!okSin) fallos++;

  console.log(fallos === 0
    ? '\nTODO OK · el motor coincide con la calculadora de producción al céntimo.'
    : `\n${fallos} DISCREPANCIAS · no mergear.`);
  process.exit(fallos === 0 ? 0 : 1);
})();
