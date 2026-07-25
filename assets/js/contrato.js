/* ============================================================
   GestoTrafic · Generador de contrato de compraventa
   Genera un documento HTML imprimible (→ PDF con "Guardar como
   PDF" del navegador) pre-rellenado con los datos del expediente.
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) {
    if (v === null || v === undefined || v === '') return '_______________';
    return String(v).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function eur(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '_______';
    return new Intl.NumberFormat('es-ES', {
      style: 'currency', currency: 'EUR', minimumFractionDigits: 2
    }).format(Number(n));
  }

  function fechaLarga(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(+d)) d = new Date();
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function fechaCorta(iso) {
    if (!iso) return '____________';
    var d = new Date(iso);
    return isNaN(+d) ? '____________' : d.toLocaleDateString('es-ES');
  }

  function construirHTML(exp) {
    var hoy = fechaLarga(null);
    var precio = exp.precio_contrato;

    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
      '<title>Contrato de compraventa · ' + esc(exp.referencia) + '</title>' +
      '<style>' +
      '@page{size:A4;margin:18mm 16mm}' +
      'body{font-family:Georgia,"Times New Roman",serif;font-size:11.2pt;line-height:1.62;color:#111;max-width:800px;margin:0 auto;padding:26px}' +
      'h1{font-size:16pt;text-align:center;margin:0 0 4px;letter-spacing:.4px}' +
      '.sub{text-align:center;font-size:9.4pt;color:#555;margin-bottom:26px}' +
      'h2{font-size:11.4pt;margin:24px 0 9px;border-bottom:1.4px solid #222;padding-bottom:4px;text-transform:uppercase;letter-spacing:.7px}' +
      'p{margin:0 0 10px;text-align:justify}' +
      'table{width:100%;border-collapse:collapse;margin:10px 0 4px}' +
      'td{padding:6px 9px;border:1px solid #bbb;font-size:10.4pt;vertical-align:top}' +
      'td.k{background:#f2f2f5;width:31%;font-weight:bold}' +
      'ol{padding-left:19px;margin:8px 0}li{margin-bottom:8px;text-align:justify}' +
      '.firmas{display:flex;gap:44px;margin-top:46px}' +
      '.firma{flex:1;text-align:center;font-size:10pt}' +
      '.firma .linea{border-top:1px solid #222;margin-top:56px;padding-top:6px}' +
      '.pie{margin-top:34px;padding-top:11px;border-top:1px solid #ccc;font-size:8.3pt;color:#666;text-align:center}' +
      '.aviso{margin-top:14px;padding:9px 12px;background:#fbf5e4;border:1px solid #e2cf9c;font-size:8.6pt;color:#6b5626}' +
      '.wm{color:#7c4dff;font-weight:bold}' +
      '@media print{.noprint{display:none}body{padding:0}}' +
      '.noprint{position:fixed;top:14px;right:14px;display:flex;gap:9px}' +
      '.noprint button{font-family:system-ui,sans-serif;font-size:13px;font-weight:600;padding:9px 17px;border-radius:8px;border:0;cursor:pointer;background:#7c4dff;color:#fff}' +
      '.noprint button.sec{background:#fff;color:#333;border:1px solid #bbb}' +
      '</style></head><body>' +

      '<div class="noprint">' +
      '<button onclick="window.print()">Imprimir / Guardar PDF</button>' +
      '<button class="sec" onclick="window.close()">Cerrar</button>' +
      '</div>' +

      '<h1>Contrato de Compraventa de Vehículo Usado</h1>' +
      '<div class="sub">Expediente ' + esc(exp.referencia) + ' · Documento generado el ' + hoy + '</div>' +

      '<p>En ' + esc(exp.lugar_firma || global.GT_CONFIG.GESTORIA.ciudad) +
      ', a ' + hoy + ', <b>REUNIDOS</b> de una parte el vendedor y de otra el comprador que a ' +
      'continuación se identifican, ambos con capacidad legal suficiente para contratar y obligarse, ' +
      'convienen el presente contrato de compraventa.</p>' +

      '<h2>I · Partes contratantes</h2>' +
      '<table>' +
      '<tr><td class="k">Vendedor</td><td>' + esc(exp.vendedor_nombre) + '</td></tr>' +
      '<tr><td class="k">DNI / NIF</td><td>' + esc(exp.vendedor_nif) + '</td></tr>' +
      '<tr><td class="k">Domicilio</td><td>' + esc(exp.vendedor_direccion) + '</td></tr>' +
      '<tr><td class="k">Teléfono</td><td>' + esc(exp.vendedor_telefono) + '</td></tr>' +
      '</table>' +
      '<table>' +
      '<tr><td class="k">Comprador</td><td>' + esc(exp.comprador_nombre) + '</td></tr>' +
      '<tr><td class="k">DNI / NIF</td><td>' + esc(exp.comprador_nif) + '</td></tr>' +
      '<tr><td class="k">Domicilio</td><td>' + esc(exp.comprador_direccion) + '</td></tr>' +
      '<tr><td class="k">Teléfono</td><td>' + esc(exp.comprador_telefono) + '</td></tr>' +
      '</table>' +

      '<h2>II · Objeto del contrato</h2>' +
      '<p>El vendedor transmite al comprador la plena propiedad del vehículo que se describe:</p>' +
      '<table>' +
      '<tr><td class="k">Marca y modelo</td><td>' + esc(exp.marca) + ' ' + esc(exp.modelo) + '</td></tr>' +
      '<tr><td class="k">Matrícula</td><td>' + esc(exp.matricula) + '</td></tr>' +
      '<tr><td class="k">Fecha 1ª matriculación</td><td>' + fechaCorta(exp.fecha_matriculacion) + '</td></tr>' +
      '<tr><td class="k">Combustible</td><td>' + esc(exp.combustible) + '</td></tr>' +
      (exp.cilindrada ? '<tr><td class="k">Cilindrada</td><td>' + esc(exp.cilindrada) + ' c.c.</td></tr>' : '') +
      (exp.etiqueta_dgt ? '<tr><td class="k">Etiqueta ambiental DGT</td><td>' + esc(exp.etiqueta_dgt) + '</td></tr>' : '') +
      '</table>' +

      '<h2>III · Precio y forma de pago</h2>' +
      '<p>El precio total de la compraventa se fija en <b>' + eur(precio) + '</b>' +
      ', que el comprador abona al vendedor en este acto, sirviendo el presente documento como la más ' +
      'eficaz carta de pago por el importe indicado.</p>' +

      '<h2>IV · Cláusulas</h2>' +
      '<ol>' +
      '<li>El vendedor declara que el vehículo se encuentra libre de cargas, gravámenes, embargos y ' +
      'precintos, que está al corriente del Impuesto sobre Vehículos de Tracción Mecánica (IVTM) y ' +
      'que no pesa sobre él reserva de dominio alguna.</li>' +
      '<li>El comprador recibe el vehículo en el estado de uso y conservación en que se encuentra, ' +
      'que declara conocer y aceptar, habiéndolo examinado con anterioridad a este acto.</li>' +
      '<li>Desde la firma del presente contrato corren por cuenta del comprador cuantas ' +
      'responsabilidades, sanciones, impuestos y obligaciones se deriven de la propiedad, tenencia ' +
      'y circulación del vehículo.</li>' +
      '<li>El comprador se obliga a tramitar el cambio de titularidad ante la Jefatura Provincial de ' +
      'Tráfico en el plazo de <b>30 días naturales</b> desde la fecha de este contrato, así como a ' +
      'liquidar el Impuesto de Transmisiones Patrimoniales (ITP) ante la Hacienda autonómica ' +
      'correspondiente.</li>' +
      '<li>El vendedor se compromete a comunicar la transmisión a la Dirección General de Tráfico y a ' +
      'entregar al comprador el permiso de circulación, la ficha técnica y el justificante del último ' +
      'IVTM abonado.</li>' +
      '<li>Ambas partes se someten, para cuantas cuestiones se deriven de la interpretación o ' +
      'cumplimiento de este contrato, a los Juzgados y Tribunales del domicilio del comprador, con ' +
      'renuncia expresa a cualquier otro fuero que pudiera corresponderles.</li>' +
      '</ol>' +

      '<p>Y en prueba de conformidad, ambas partes firman el presente contrato por duplicado y a un ' +
      'solo efecto, en el lugar y fecha arriba indicados.</p>' +

      '<div class="firmas">' +
      '<div class="firma"><div class="linea">EL VENDEDOR<br><small>' + esc(exp.vendedor_nombre) + '</small></div></div>' +
      '<div class="firma"><div class="linea">EL COMPRADOR<br><small>' + esc(exp.comprador_nombre) + '</small></div></div>' +
      '</div>' +

      '<div class="aviso"><b>Aviso:</b> documento generado automáticamente por GestoTrafic a partir de ' +
      'los datos del expediente. Debe ser revisado y firmado por las partes. GestoTrafic no presenta ' +
      'el expediente ante la DGT ni ante la Agencia Tributaria: la gestoría lo presenta con el ' +
      'programa oficial de su colegio.</div>' +

      '<div class="pie">Expediente ' + esc(exp.referencia) + ' · GestoTrafic · Documento de DEMOSTRACIÓN<br>' +
      'Hecho por <span class="wm">WhiteMoon Agencia IA</span> · whitemoon.es</div>' +

      '</body></html>';
  }

  /** Abre el contrato en una pestaña nueva, listo para imprimir o guardar como PDF. */
  function abrirContrato(exp) {
    var html = construirHTML(exp);
    var w = global.open('', '_blank');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  }

  /** Descarga el contrato como fichero .html (respaldo si el navegador bloquea popups). */
  function descargarContrato(exp) {
    var blob = new Blob([construirHTML(exp)], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'contrato-compraventa-' + (exp.referencia || 'expediente') + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  global.GTContrato = {
    abrir: abrirContrato,
    descargar: descargarContrato,
    html: construirHTML
  };
})(window);
