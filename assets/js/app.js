/* ============================================================
   GestoTrafic · Aplicación (router + vistas)
   ============================================================ */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const sidebar = document.getElementById('sidebar');
  let session = null;

  /* ---------------- Utilidades ---------------- */

  const h = (v) => (v === null || v === undefined) ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const eur = (n) => (n === null || n === undefined || n === '' || isNaN(Number(n)))
    ? '—'
    : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(n));

  const fecha = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(+d) ? '—' : d.toLocaleDateString('es-ES');
  };

  const estadoInfo = (id) => window.GT_ESTADOS.find(e => e.id === id) || { label: id, color: '#8888a0' };

  const nombreCliente = (c) => {
    if (!c) return '— sin cliente —';
    return c.tipo === 'empresa'
      ? (c.razon_social || c.nombre)
      : [c.nombre, c.apellidos].filter(Boolean).join(' ');
  };

  function toast(msg, tipo) {
    const t = document.createElement('div');
    t.className = 'toast' + (tipo ? ' ' + tipo : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2900);
  }

  function loading(txt) {
    view.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div><p>${h(txt || 'Cargando…')}</p></div>`;
  }

  function errorView(e) {
    console.error(e);
    view.innerHTML = `<div class="empty">
      <p style="color:var(--danger)">No se pudieron cargar los datos.</p>
      <p class="t-muted" style="font-size:.8rem">${h(e && e.message ? e.message : e)}</p>
      <button class="btn btn-ghost" onclick="location.reload()">Reintentar</button>
    </div>`;
  }

  const footer = () => `<div class="wm-foot">GestoTrafic · demo comercial · Hecho por <b>WhiteMoon Agencia IA</b> · whitemoon.es</div>`;

  const avisoRegulado = () => `<div class="regul-note">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
    <div><b>GestoTrafic no conecta con la DGT ni con Hacienda.</b> El expediente queda <b>listo para presentar</b>: la gestoría lo presenta con el programa oficial de su colegio.</div>
  </div>`;

  /* ---------------- Modal ---------------- */

  function modal({ titulo, cuerpo, okTexto = 'Guardar', onOk, ancho }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" ${ancho ? `style="max-width:${ancho}px"` : ''} role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${h(titulo)}</h3><button class="x-btn" data-cerrar aria-label="Cerrar">×</button></div>
      <div class="modal-body">${cuerpo}</div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cerrar>Cancelar</button>
        <button class="btn" data-ok>${h(okTexto)}</button>
      </div>
    </div>`;
    document.body.appendChild(back);

    const cerrar = () => back.remove();
    back.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', cerrar));
    back.addEventListener('mousedown', e => { if (e.target === back) cerrar(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); }
    });

    const btnOk = back.querySelector('[data-ok]');
    btnOk.addEventListener('click', async () => {
      btnOk.disabled = true;
      const prev = btnOk.innerHTML;
      btnOk.innerHTML = '<span class="spinner"></span>';
      try {
        const ok = await onOk(back);
        if (ok !== false) cerrar();
      } catch (err) {
        toast(err.message || 'Error al guardar', 'err');
      } finally {
        btnOk.disabled = false;
        btnOk.innerHTML = prev;
      }
    });

    setTimeout(() => { const f = back.querySelector('input,select,textarea'); if (f) f.focus(); }, 40);
    return back;
  }

  const val = (root, name) => {
    const el = root.querySelector(`[name="${name}"]`);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    const v = el.value.trim();
    return v === '' ? null : v;
  };
  const num = (root, name) => {
    const v = val(root, name);
    return v === null ? null : Number(String(v).replace(',', '.'));
  };

  /* ============================================================
     VISTA · DASHBOARD
     ============================================================ */
  async function vistaDashboard() {
    loading('Cargando indicadores…');
    const [k, expedientes] = await Promise.all([GTApi.kpis(), GTApi.listarExpedientes()]);
    const recientes = expedientes.slice(0, 6);
    const maxEstado = Math.max(1, ...Object.values(k.porEstado));

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <h1>Hola, ${h(session.nombre.split(' ')[0])} 👋</h1>
          <p>Resumen de actividad de la gestoría</p>
        </div>
        <button class="btn" data-nuevo-exp>+ Nuevo expediente</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-lbl">Expedientes activos</div>
          <div class="kpi-num">${k.totalExpedientes}</div>
          <div class="kpi-sub">${k.porEstado.completado} completados</div>
        </div>
        <div class="kpi">
          <div class="kpi-lbl">Expedientes del mes</div>
          <div class="kpi-num">${k.expedientesMes}</div>
          <div class="kpi-sub">${new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div class="kpi">
          <div class="kpi-lbl">Clientes totales</div>
          <div class="kpi-num">${k.totalClientes}</div>
          <div class="kpi-sub">particulares y empresas</div>
        </div>
        <div class="kpi g">
          <div class="kpi-lbl">Impuestos calculados</div>
          <div class="kpi-num">${eur(k.impuestosMes)}</div>
          <div class="kpi-sub">ITP + tasas · este mes</div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-t">Expedientes por estado</div>
          <div class="estado-bars">
            ${window.GT_ESTADOS.map(e => `
              <div class="estado-bar-row">
                <span class="t-muted">${h(e.label)}</span>
                <div class="estado-bar-track">
                  <div class="estado-bar-fill" style="width:${(k.porEstado[e.id] / maxEstado * 100).toFixed(1)}%;background:${e.color}"></div>
                </div>
                <b>${k.porEstado[e.id]}</b>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-t">Últimos expedientes</div>
          ${recientes.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Referencia</th><th>Cliente</th><th>Vehículo</th><th>Estado</th><th>Impuestos</th></tr></thead>
            <tbody>${recientes.map(e => `
              <tr class="clickable" data-exp="${h(e.id)}">
                <td class="t-mono">${h(e.referencia)}</td>
                <td>${h(nombreCliente(e.cliente))}</td>
                <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}<br><span class="t-muted" style="font-size:.76rem">${h(e.matricula || '')}</span></td>
                <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
                <td class="t-num">${eur(e.total_impuestos)}</td>
              </tr>`).join('')}</tbody></table></div>`
          : `<div class="empty"><p>Todavía no hay expedientes. Crea el primero para ver el flujo completo.</p><button class="btn" data-nuevo-exp>+ Nuevo expediente</button></div>`}
        </div>

        ${avisoRegulado()}
      </div>
      ${footer()}`;

    view.querySelectorAll('[data-nuevo-exp]').forEach(b => b.addEventListener('click', () => (location.hash = '#/expedientes/nuevo')));
    view.querySelectorAll('[data-exp]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/expedientes/' + tr.dataset.exp)));
  }

  /* ============================================================
     VISTA · CLIENTES
     ============================================================ */
  async function vistaClientes() {
    loading('Cargando clientes…');
    const clientes = await GTApi.listarClientes();

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div><h1>Clientes</h1><p>${clientes.length} ficha${clientes.length === 1 ? '' : 's'} registrada${clientes.length === 1 ? '' : 's'}</p></div>
        <button class="btn" id="btn-nuevo-cliente">+ Nuevo cliente</button>
      </div>

      ${clientes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Tipo</th><th>NIF / CIF</th><th>Contacto</th><th>Alta</th></tr></thead>
        <tbody>${clientes.map(c => `
          <tr class="clickable" data-cli="${h(c.id)}">
            <td><b>${h(nombreCliente(c))}</b></td>
            <td><span class="badge badge-${h(c.tipo)}">${c.tipo === 'empresa' ? 'Empresa' : 'Particular'}</span></td>
            <td class="t-mono">${h(c.nif)}</td>
            <td>${h(c.telefono || '—')}<br><span class="t-muted" style="font-size:.76rem">${h(c.email || '')}</span></td>
            <td class="t-muted">${fecha(c.created_at)}</td>
          </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <p>Aún no hay clientes dados de alta.</p>
          <button class="btn" id="btn-nuevo-cliente-2">+ Dar de alta el primer cliente</button>
        </div>`}
      ${footer()}`;

    view.querySelectorAll('#btn-nuevo-cliente, #btn-nuevo-cliente-2').forEach(b => b.addEventListener('click', modalCliente));
    view.querySelectorAll('[data-cli]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/clientes/' + tr.dataset.cli)));
  }

  function modalCliente() {
    const cuerpo = `
      <div class="form-sec">Tipo de cliente</div>
      <div class="field">
        <label for="f-tipo">Particular o empresa</label>
        <select name="tipo" id="f-tipo">
          <option value="particular">Particular</option>
          <option value="empresa">Empresa</option>
        </select>
      </div>
      <div class="grid-2">
        <div class="field" data-solo-particular>
          <label>Nombre *</label><input name="nombre" placeholder="María" required>
        </div>
        <div class="field" data-solo-particular>
          <label>Apellidos</label><input name="apellidos" placeholder="García López">
        </div>
      </div>
      <div class="field hidden" data-solo-empresa>
        <label>Razón social *</label><input name="razon_social" placeholder="Transportes García S.L.">
      </div>
      <div class="field">
        <label>NIF / CIF *</label><input name="nif" placeholder="12345678Z" required>
      </div>

      <div class="form-sec">Contacto</div>
      <div class="grid-2">
        <div class="field"><label>Teléfono</label><input name="telefono" placeholder="600 000 000"></div>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="cliente@email.com"></div>
      </div>
      <div class="field"><label>Dirección</label><input name="direccion" placeholder="Calle Mieses 1, 3º"></div>
      <div class="grid-3">
        <div class="field"><label>C.P.</label><input name="cp" placeholder="28220"></div>
        <div class="field"><label>Ciudad</label><input name="ciudad" placeholder="Majadahonda"></div>
        <div class="field"><label>Provincia</label><input name="provincia" placeholder="Madrid"></div>
      </div>
      <div class="field"><label>Notas internas</label><textarea name="notas" placeholder="Observaciones del cliente…"></textarea></div>`;

    const back = modal({
      titulo: 'Nuevo cliente',
      cuerpo,
      okTexto: 'Crear cliente',
      onOk: async (root) => {
        const tipo = val(root, 'tipo');
        const nombre = tipo === 'empresa' ? val(root, 'razon_social') : val(root, 'nombre');
        if (!nombre) { toast(tipo === 'empresa' ? 'La razón social es obligatoria' : 'El nombre es obligatorio', 'err'); return false; }
        if (!val(root, 'nif')) { toast('El NIF / CIF es obligatorio', 'err'); return false; }

        await GTApi.crearCliente({
          tipo,
          nombre,
          apellidos: tipo === 'empresa' ? null : val(root, 'apellidos'),
          razon_social: tipo === 'empresa' ? val(root, 'razon_social') : null,
          nif: val(root, 'nif'),
          telefono: val(root, 'telefono'),
          email: val(root, 'email'),
          direccion: val(root, 'direccion'),
          cp: val(root, 'cp'),
          ciudad: val(root, 'ciudad'),
          provincia: val(root, 'provincia'),
          notas: val(root, 'notas')
        });
        toast('Cliente creado', 'ok');
        vistaClientes();
      }
    });

    const selTipo = back.querySelector('#f-tipo');
    selTipo.addEventListener('change', () => {
      const esEmpresa = selTipo.value === 'empresa';
      back.querySelectorAll('[data-solo-empresa]').forEach(el => el.classList.toggle('hidden', !esEmpresa));
      back.querySelectorAll('[data-solo-particular]').forEach(el => el.classList.toggle('hidden', esEmpresa));
    });
  }

  /* ============================================================
     VISTA · FICHA DE CLIENTE
     ============================================================ */
  async function vistaCliente(id) {
    loading('Cargando ficha…');
    const [c, expedientes] = await Promise.all([
      GTApi.obtenerCliente(id),
      GTApi.listarExpedientesDeCliente(id)
    ]);

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/clientes" class="t-muted" style="font-size:.8rem">← Clientes</a>
          <h1 style="margin-top:6px">${h(nombreCliente(c))}</h1>
          <p><span class="badge badge-${h(c.tipo)}">${c.tipo === 'empresa' ? 'Empresa' : 'Particular'}</span>
             <span class="t-mono" style="margin-left:8px">${h(c.nif)}</span></p>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost" id="btn-exp-cliente">+ Nuevo expediente</button>
          ${GTAuth.isAdmin() ? `<button class="btn btn-danger" id="btn-borrar-cli">Eliminar</button>` : ''}
        </div>
      </div>

      <div class="detail-grid">
        <div class="stack">
          <div class="card">
            <div class="card-t">Historial de trámites (${expedientes.length})</div>
            ${expedientes.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Referencia</th><th>Trámite</th><th>Vehículo</th><th>Estado</th><th>Impuestos</th></tr></thead>
              <tbody>${expedientes.map(e => `
                <tr class="clickable" data-exp="${h(e.id)}">
                  <td class="t-mono">${h(e.referencia)}</td>
                  <td>Transferencia<br><span class="t-muted" style="font-size:.76rem">${fecha(e.created_at)}</span></td>
                  <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}<br><span class="t-muted" style="font-size:.76rem">${h(e.matricula || '')}</span></td>
                  <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
                  <td class="t-num">${eur(e.total_impuestos)}</td>
                </tr>`).join('')}</tbody></table></div>`
            : `<div class="empty" style="padding:30px 16px"><p>Este cliente todavía no tiene trámites.</p></div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-t">Datos de contacto</div>
          <dl class="dl">
            <dt>Teléfono</dt><dd>${h(c.telefono || '—')}</dd>
            <dt>Email</dt><dd style="word-break:break-all">${h(c.email || '—')}</dd>
            <dt>Dirección</dt><dd>${h(c.direccion || '—')}</dd>
            <dt>Población</dt><dd>${h([c.cp, c.ciudad].filter(Boolean).join(' ') || '—')}</dd>
            <dt>Provincia</dt><dd>${h(c.provincia || '—')}</dd>
            <dt>Alta</dt><dd>${fecha(c.created_at)}</dd>
          </dl>
          ${c.notas ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-2)">
            <div class="card-t" style="margin-bottom:8px">Notas</div>
            <p class="t-muted" style="margin:0;font-size:.82rem">${h(c.notas)}</p></div>` : ''}
        </div>
      </div>
      ${footer()}`;

    view.querySelectorAll('[data-exp]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/expedientes/' + tr.dataset.exp)));
    view.querySelector('#btn-exp-cliente').addEventListener('click', () => (location.hash = '#/expedientes/nuevo?cliente=' + id));

    const btnDel = view.querySelector('#btn-borrar-cli');
    if (btnDel) btnDel.addEventListener('click', async () => {
      modal({
        titulo: 'Eliminar cliente',
        cuerpo: `<p>¿Seguro que quieres eliminar la ficha de <b>${h(nombreCliente(c))}</b>?</p>
                 <p class="t-muted" style="font-size:.82rem">Sus expedientes se conservarán, pero quedarán sin cliente asignado.</p>`,
        okTexto: 'Eliminar',
        onOk: async () => {
          await GTApi.borrarCliente(id);
          toast('Cliente eliminado', 'ok');
          location.hash = '#/clientes';
        }
      });
    });
  }

  /* ============================================================
     VISTA · LISTA DE EXPEDIENTES
     ============================================================ */
  async function vistaExpedientes() {
    loading('Cargando expedientes…');
    const expedientes = await GTApi.listarExpedientes();

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div><h1>Expedientes</h1><p>Transferencias de vehículo · ${expedientes.length} en total</p></div>
        <button class="btn" id="btn-nuevo-exp">+ Nuevo expediente</button>
      </div>

      ${expedientes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Referencia</th><th>Cliente</th><th>Vehículo</th><th>Matrícula</th><th>Estado</th><th>ITP</th><th>Total</th></tr></thead>
        <tbody>${expedientes.map(e => `
          <tr class="clickable" data-exp="${h(e.id)}">
            <td class="t-mono">${h(e.referencia)}</td>
            <td>${h(nombreCliente(e.cliente))}</td>
            <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}</td>
            <td class="t-mono">${h(e.matricula || '—')}</td>
            <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
            <td class="t-num">${eur(e.itp_importe)}</td>
            <td class="t-num"><b>${eur(e.total_impuestos)}</b></td>
          </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <p>Aún no hay expedientes abiertos.</p>
          <button class="btn" id="btn-nuevo-exp-2">+ Crear el primer expediente</button>
        </div>`}
      ${footer()}`;

    view.querySelectorAll('#btn-nuevo-exp, #btn-nuevo-exp-2').forEach(b => b.addEventListener('click', () => (location.hash = '#/expedientes/nuevo')));
    view.querySelectorAll('[data-exp]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/expedientes/' + tr.dataset.exp)));
  }

  /* ============================================================
     VISTA · NUEVO EXPEDIENTE
     ============================================================ */
  async function vistaNuevoExpediente(clientePre) {
    loading('Preparando formulario…');
    const clientes = await GTApi.listarClientes();

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/expedientes" class="t-muted" style="font-size:.8rem">← Expedientes</a>
          <h1 style="margin-top:6px">Nuevo expediente</h1>
          <p>Transferencia de vehículo · trámite estrella</p>
        </div>
      </div>

      <form id="form-exp" class="stack" style="max-width:900px">
        <div class="card">
          <div class="form-sec">Cliente</div>
          ${clientes.length ? `<div class="field">
            <label>Cliente del expediente *</label>
            <select name="cliente_id" required>
              <option value="">— Selecciona un cliente —</option>
              ${clientes.map(c => `<option value="${h(c.id)}" ${clientePre === c.id ? 'selected' : ''}>${h(nombreCliente(c))} · ${h(c.nif)}</option>`).join('')}
            </select>
          </div>`
          : `<div class="regul-note" style="margin-bottom:6px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
              <div>No hay clientes dados de alta. <a href="#/clientes">Crea primero un cliente</a> para asociarlo al expediente.</div>
            </div>`}

          <div class="form-sec">Datos del vehículo</div>
          <div class="grid-2">
            <div class="field"><label>Marca *</label><input name="marca" placeholder="Seat" required></div>
            <div class="field"><label>Modelo *</label><input name="modelo" placeholder="León 1.5 TSI" required></div>
          </div>
          <div class="grid-3">
            <div class="field"><label>Matrícula *</label><input name="matricula" placeholder="1234 ABC" required></div>
            <div class="field"><label>Fecha 1ª matriculación *</label><input name="fecha_matriculacion" type="date" required></div>
            <div class="field">
              <label>Combustible</label>
              <select name="combustible">${window.GT_COMBUSTIBLES.map(c => `<option>${h(c)}</option>`).join('')}</select>
            </div>
          </div>
          <div class="grid-3">
            <div class="field"><label>Cilindrada (c.c.)</label><input name="cilindrada" type="number" min="0" placeholder="1498"></div>
            <div class="field"><label>Potencia fiscal (CVf)</label><input name="cvf" type="number" step="0.01" min="0" placeholder="11.5"></div>
            <div class="field">
              <label>Etiqueta DGT</label>
              <select name="etiqueta_dgt">${window.GT_ETIQUETAS.map(e => `<option value="${h(e.id)}">${h(e.label)}</option>`).join('')}</select>
            </div>
          </div>

          <div class="form-sec">Vendedor</div>
          <div class="grid-2">
            <div class="field"><label>Nombre y apellidos</label><input name="vendedor_nombre" placeholder="Antonio Ruiz Pérez"></div>
            <div class="field"><label>DNI / NIF</label><input name="vendedor_nif" placeholder="11223344A"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Domicilio</label><input name="vendedor_direccion" placeholder="Av. de España 22, Madrid"></div>
            <div class="field"><label>Teléfono</label><input name="vendedor_telefono" placeholder="600 111 222"></div>
          </div>

          <div class="form-sec">Comprador</div>
          <label class="flex" style="font-size:.8rem;color:var(--muted);margin-bottom:12px;cursor:pointer">
            <input type="checkbox" id="copiar-cliente" style="width:auto"> Rellenar con los datos del cliente seleccionado
          </label>
          <div class="grid-2">
            <div class="field"><label>Nombre y apellidos</label><input name="comprador_nombre" placeholder="María García López"></div>
            <div class="field"><label>DNI / NIF</label><input name="comprador_nif" placeholder="12345678Z"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Domicilio</label><input name="comprador_direccion" placeholder="Calle Mieses 1, Majadahonda"></div>
            <div class="field"><label>Teléfono</label><input name="comprador_telefono" placeholder="600 333 444"></div>
          </div>

          <div class="form-sec">Fiscalidad</div>
          <div class="grid-3">
            <div class="field">
              <label>CCAA del comprador *</label>
              <select name="ccaa" required>${window.GT_CCAA.map(c => `<option ${c === 'Comunidad de Madrid' ? 'selected' : ''}>${h(c)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Valor BOE Anexo I (€)</label><input name="valor_boe" type="number" step="0.01" min="0" placeholder="21000"></div>
            <div class="field"><label>Precio de contrato (€)</label><input name="precio_contrato" type="number" step="0.01" min="0" placeholder="8500"></div>
          </div>

          <div class="field"><label>Notas del expediente</label><textarea name="notas" placeholder="Observaciones…"></textarea></div>
        </div>

        ${avisoRegulado()}

        <div class="flex">
          <button type="submit" class="btn" id="btn-crear">Crear expediente</button>
          <a href="#/expedientes" class="btn btn-ghost">Cancelar</a>
        </div>
      </form>
      ${footer()}`;

    const form = view.querySelector('#form-exp');

    const chk = view.querySelector('#copiar-cliente');
    chk.addEventListener('change', () => {
      if (!chk.checked) return;
      const sel = form.querySelector('[name="cliente_id"]');
      const c = clientes.find(x => x.id === (sel && sel.value));
      if (!c) { toast('Selecciona antes un cliente', 'err'); chk.checked = false; return; }
      form.querySelector('[name="comprador_nombre"]').value = nombreCliente(c);
      form.querySelector('[name="comprador_nif"]').value = c.nif || '';
      form.querySelector('[name="comprador_direccion"]').value = [c.direccion, c.ciudad].filter(Boolean).join(', ');
      form.querySelector('[name="comprador_telefono"]').value = c.telefono || '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = view.querySelector('#btn-crear');
      btn.disabled = true;
      const prev = btn.textContent;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const exp = await GTApi.crearExpediente({
          cliente_id: val(form, 'cliente_id'),
          tipo_tramite: 'transferencia',
          estado: 'nuevo',
          marca: val(form, 'marca'),
          modelo: val(form, 'modelo'),
          matricula: val(form, 'matricula'),
          fecha_matriculacion: val(form, 'fecha_matriculacion'),
          combustible: val(form, 'combustible'),
          cilindrada: num(form, 'cilindrada'),
          cvf: num(form, 'cvf'),
          etiqueta_dgt: val(form, 'etiqueta_dgt'),
          ccaa: val(form, 'ccaa'),
          valor_boe: num(form, 'valor_boe'),
          precio_contrato: num(form, 'precio_contrato'),
          vendedor_nombre: val(form, 'vendedor_nombre'),
          vendedor_nif: val(form, 'vendedor_nif'),
          vendedor_direccion: val(form, 'vendedor_direccion'),
          vendedor_telefono: val(form, 'vendedor_telefono'),
          comprador_nombre: val(form, 'comprador_nombre'),
          comprador_nif: val(form, 'comprador_nif'),
          comprador_direccion: val(form, 'comprador_direccion'),
          comprador_telefono: val(form, 'comprador_telefono'),
          notas: val(form, 'notas')
        });
        toast('Expediente ' + exp.referencia + ' creado', 'ok');
        location.hash = '#/expedientes/' + exp.id;
      } catch (err) {
        toast(err.message || 'No se pudo crear el expediente', 'err');
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  }

  /* ============================================================
     VISTA · DETALLE DE EXPEDIENTE
     ============================================================ */
  async function vistaExpediente(id) {
    loading('Cargando expediente…');
    const [exp, docs] = await Promise.all([GTApi.obtenerExpediente(id), GTApi.listarDocumentos(id)]);

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/expedientes" class="t-muted" style="font-size:.8rem">← Expedientes</a>
          <h1 style="margin-top:6px">${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || 'Expediente')}</h1>
          <p><span class="t-mono">${h(exp.referencia)}</span> · ${h(exp.matricula || 'sin matrícula')} · ${h(nombreCliente(exp.cliente))}</p>
        </div>
        <div class="row-actions">
          <select id="sel-estado" class="tab" style="padding:8px 13px">
            ${window.GT_ESTADOS.map(e => `<option value="${h(e.id)}" ${exp.estado === e.id ? 'selected' : ''}>${h(e.label)}</option>`).join('')}
          </select>
          ${GTAuth.isAdmin() ? `<button class="btn btn-danger btn-sm" id="btn-borrar-exp">Eliminar</button>` : ''}
        </div>
      </div>

      <div class="tabs" id="tabs">
        <button class="tab active" data-tab="itp">Calculadora ITP</button>
        <button class="tab" data-tab="datos">Datos del expediente</button>
        <button class="tab" data-tab="docs">Documentación</button>
        <button class="tab" data-tab="contrato">Contrato</button>
      </div>

      <div id="tab-content"></div>
      ${footer()}`;

    const cont = view.querySelector('#tab-content');
    const paneles = {
      itp: () => panelITP(exp, cont),
      datos: () => panelDatos(exp, cont),
      docs: () => panelDocs(exp, docs, cont),
      contrato: () => panelContrato(exp, docs, cont)
    };
    paneles.itp();

    view.querySelectorAll('#tabs .tab').forEach(t => t.addEventListener('click', () => {
      view.querySelectorAll('#tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      paneles[t.dataset.tab]();
    }));

    view.querySelector('#sel-estado').addEventListener('change', async (e) => {
      try {
        await GTApi.actualizarExpediente(id, { estado: e.target.value });
        exp.estado = e.target.value;
        toast('Estado actualizado: ' + estadoInfo(e.target.value).label, 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });

    const btnDel = view.querySelector('#btn-borrar-exp');
    if (btnDel) btnDel.addEventListener('click', () => modal({
      titulo: 'Eliminar expediente',
      cuerpo: `<p>¿Eliminar el expediente <b>${h(exp.referencia)}</b> y toda su documentación?</p>`,
      okTexto: 'Eliminar',
      onOk: async () => {
        await GTApi.borrarExpediente(id);
        toast('Expediente eliminado', 'ok');
        location.hash = '#/expedientes';
      }
    }));
  }

  /* ---------- Panel: Calculadora ITP ---------- */
  function panelITP(exp, cont) {
    cont.innerHTML = `
      <div class="detail-grid">
        <div class="itp-panel">
          <div class="flex" style="margin-bottom:4px">
            <div class="card-t" style="margin:0">Cálculo ITP · BOE 2026</div>
            <div class="spacer"></div>
            <span class="badge badge-completado" style="font-size:.62rem">Orden HAC/1501/2025</span>
          </div>
          <p class="t-muted" style="font-size:.79rem;margin:8px 0 16px">
            Valor venal por depreciación del Anexo IV, tipo autonómico, cuotas fijas y exenciones.
            Calculado en Supabase con el motor <span class="t-mono">gestotrafic-itp</span>.
          </p>

          <div class="grid-3">
            <div class="field">
              <label>Valor BOE Anexo I (€) *</label>
              <input name="valor_boe" type="number" step="0.01" min="0" value="${exp.valor_boe ?? ''}" placeholder="21000">
            </div>
            <div class="field">
              <label>Precio de contrato (€)</label>
              <input name="precio_contrato" type="number" step="0.01" min="0" value="${exp.precio_contrato ?? ''}" placeholder="8500">
            </div>
            <div class="field">
              <label>Fecha 1ª matriculación *</label>
              <input name="fecha_matriculacion" type="date" value="${exp.fecha_matriculacion ?? ''}">
            </div>
          </div>
          <div class="grid-3">
            <div class="field">
              <label>CCAA del comprador</label>
              <select name="ccaa">${window.GT_CCAA.map(c => `<option ${c === exp.ccaa ? 'selected' : ''}>${h(c)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Cilindrada (c.c.)</label>
              <input name="cilindrada" type="number" min="0" value="${exp.cilindrada ?? ''}">
            </div>
            <div class="field">
              <label>Potencia fiscal (CVf)</label>
              <input name="cvf" type="number" step="0.01" min="0" value="${exp.cvf ?? ''}">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Etiqueta DGT</label>
              <select name="etiqueta_dgt">${window.GT_ETIQUETAS.map(e => `<option value="${h(e.id)}" ${e.id === (exp.etiqueta_dgt || '') ? 'selected' : ''}>${h(e.label)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Uso especial (taxi / autoescuela / alquiler)</label>
              <select name="uso_especial">
                <option value="no" ${!exp.uso_especial ? 'selected' : ''}>No · base al 100%</option>
                <option value="si" ${exp.uso_especial ? 'selected' : ''}>Sí · reducción del 70%</option>
              </select>
            </div>
          </div>

          <button class="btn btn-full" id="btn-calcular" style="margin-top:6px">Calcular ITP y tasas</button>

          <div class="itp-out" id="itp-out">
            <div class="itp-cell"><div class="itp-cell-num" id="c-venal">${exp.valor_venal != null ? eur(exp.valor_venal) : '—'}</div><div class="itp-cell-lbl">Valor venal</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-itp">${exp.itp_importe != null ? eur(exp.itp_importe) : '—'}</div><div class="itp-cell-lbl">ITP</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-dgt">${exp.tasa_dgt != null ? eur(exp.tasa_dgt) : '—'}</div><div class="itp-cell-lbl">Tasa DGT</div></div>
            <div class="itp-cell total"><div class="itp-cell-num" id="c-total">${exp.total_impuestos != null ? eur(exp.total_impuestos) : '—'}</div><div class="itp-cell-lbl">Total</div></div>
          </div>

          <div class="itp-detail" id="itp-detail">${exp.calculo_json ? detalleTexto(exp.calculo_json) : 'Introduce el valor BOE del vehículo y pulsa <b>Calcular</b> para obtener el ITP, la tasa DGT y el valor venal.'}</div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-t">Vehículo</div>
            <dl class="dl">
              <dt>Marca / modelo</dt><dd>${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || '—')}</dd>
              <dt>Matrícula</dt><dd class="t-mono">${h(exp.matricula || '—')}</dd>
              <dt>1ª matriculación</dt><dd>${fecha(exp.fecha_matriculacion)}</dd>
              <dt>Combustible</dt><dd>${h(exp.combustible || '—')}</dd>
              <dt>Cilindrada</dt><dd>${exp.cilindrada ? h(exp.cilindrada) + ' c.c.' : '—'}</dd>
              <dt>Etiqueta DGT</dt><dd>${h(exp.etiqueta_dgt || '—')}</dd>
            </dl>
          </div>
          ${avisoRegulado()}
        </div>
      </div>`;

    cont.querySelector('#btn-calcular').addEventListener('click', async () => {
      const btn = cont.querySelector('#btn-calcular');
      const payload = {
        valor_boe: num(cont, 'valor_boe'),
        precio_contrato: num(cont, 'precio_contrato'),
        fecha_matriculacion: val(cont, 'fecha_matriculacion'),
        fecha_transmision: new Date().toISOString().slice(0, 10),
        ccaa: val(cont, 'ccaa'),
        cilindrada: num(cont, 'cilindrada'),
        cvf: num(cont, 'cvf'),
        etiqueta_dgt: val(cont, 'etiqueta_dgt'),
        uso_especial: val(cont, 'uso_especial') === 'si',
        tipo_vehiculo: 'coche'
      };

      if (!payload.valor_boe) { toast('Falta el valor BOE del vehículo', 'err'); return; }
      if (!payload.fecha_matriculacion) { toast('Falta la fecha de matriculación', 'err'); return; }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await GTApi.calcularITP(payload);

        cont.querySelector('#c-venal').textContent = eur(r.valor_venal);
        cont.querySelector('#c-itp').textContent = eur(r.itp);
        cont.querySelector('#c-dgt').textContent = eur(r.tasa_dgt);
        cont.querySelector('#c-total').textContent = eur(r.total_impuestos);
        cont.querySelector('#itp-detail').innerHTML = detalleTexto(r);

        await GTApi.actualizarExpediente(exp.id, {
          valor_boe: payload.valor_boe,
          precio_contrato: payload.precio_contrato,
          fecha_matriculacion: payload.fecha_matriculacion,
          ccaa: payload.ccaa,
          cilindrada: payload.cilindrada,
          cvf: payload.cvf,
          etiqueta_dgt: payload.etiqueta_dgt,
          uso_especial: payload.uso_especial,
          valor_venal: r.valor_venal,
          base_imponible: r.base_imponible,
          itp_importe: r.itp,
          tasa_dgt: r.tasa_dgt,
          total_impuestos: r.total_impuestos,
          calculo_json: r,
          calculado_at: new Date().toISOString()
        });

        Object.assign(exp, {
          valor_boe: payload.valor_boe, precio_contrato: payload.precio_contrato,
          valor_venal: r.valor_venal, itp_importe: r.itp, tasa_dgt: r.tasa_dgt,
          total_impuestos: r.total_impuestos, calculo_json: r
        });

        toast('ITP calculado y guardado', 'ok');
      } catch (err) {
        toast(err.message || 'Error al calcular', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Calcular ITP y tasas';
      }
    });
  }

  function detalleTexto(r) {
    const d = r.detalle || {};
    const tipo = typeof d.tipo_aplicable === 'number'
      ? (d.tipo_aplicable * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + '%'
      : h(d.tipo_aplicable || '—');

    return `Valor BOE <b>${eur(d.valor_boe)}</b> × depreciación <b>${((d.pct_depreciacion || 0) * 100).toFixed(0)}%</b>
      (${h(d.tramo || '')})${d.coef_uso_especial === 0.7 ? ' × <b>70%</b> uso especial' : ''}
      = valor venal <b>${eur(r.valor_venal)}</b>.<br>
      Base imponible <b>${eur(r.base_imponible)}</b>${d.base_desde_contrato ? ' (precio de contrato, superior al valor fiscal)' : ''}
      · ${h(d.ccaa || '')} · tipo <b>${tipo}</b> → ITP <b>${eur(r.itp)}</b>.<br>
      ${h(d.concepto_tasa_dgt || 'Tasa DGT')}: <b>${eur(r.tasa_dgt)}</b>. Total a liquidar: <b>${eur(r.total_impuestos)}</b>.
      ${d.nota ? '<br>' + h(d.nota) : ''}
      <br><span style="opacity:.7">Fuente: ${h(d.fuente || 'BOE 2026')} · antigüedad ${h(d.anios_uso)} años.</span>`;
  }

  /* ---------- Panel: Datos ---------- */
  function panelDatos(exp, cont) {
    cont.innerHTML = `
      <div class="detail-grid">
        <div class="stack">
          <div class="card">
            <div class="card-t">Vendedor</div>
            <dl class="dl">
              <dt>Nombre</dt><dd>${h(exp.vendedor_nombre || '—')}</dd>
              <dt>DNI / NIF</dt><dd class="t-mono">${h(exp.vendedor_nif || '—')}</dd>
              <dt>Domicilio</dt><dd>${h(exp.vendedor_direccion || '—')}</dd>
              <dt>Teléfono</dt><dd>${h(exp.vendedor_telefono || '—')}</dd>
            </dl>
          </div>
          <div class="card">
            <div class="card-t">Comprador</div>
            <dl class="dl">
              <dt>Nombre</dt><dd>${h(exp.comprador_nombre || '—')}</dd>
              <dt>DNI / NIF</dt><dd class="t-mono">${h(exp.comprador_nif || '—')}</dd>
              <dt>Domicilio</dt><dd>${h(exp.comprador_direccion || '—')}</dd>
              <dt>Teléfono</dt><dd>${h(exp.comprador_telefono || '—')}</dd>
            </dl>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-t">Expediente</div>
            <dl class="dl">
              <dt>Referencia</dt><dd class="t-mono">${h(exp.referencia)}</dd>
              <dt>Trámite</dt><dd>Transferencia</dd>
              <dt>Estado</dt><dd><span class="badge badge-${h(exp.estado)}">${h(estadoInfo(exp.estado).label)}</span></dd>
              <dt>Cliente</dt><dd>${h(nombreCliente(exp.cliente))}</dd>
              <dt>CCAA</dt><dd>${h(exp.ccaa || '—')}</dd>
              <dt>Apertura</dt><dd>${fecha(exp.created_at)}</dd>
            </dl>
            ${exp.notas ? `<div style="margin-top:15px;padding-top:13px;border-top:1px solid var(--border-2)">
              <div class="card-t" style="margin-bottom:7px">Notas</div>
              <p class="t-muted" style="margin:0;font-size:.82rem">${h(exp.notas)}</p></div>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Panel: Documentación ---------- */
  function panelDocs(exp, docs, cont) {
    const porTipo = {};
    docs.forEach(d => { porTipo[d.tipo] = d; });

    const obligatorios = window.GT_DOCS_TRANSFERENCIA.filter(d => d.obligatorio);
    const recibidos = obligatorios.filter(d => porTipo[d.tipo]).length;
    const pct = obligatorios.length ? (recibidos / obligatorios.length * 100) : 0;

    cont.innerHTML = `
      <div class="card" style="max-width:860px">
        <div class="flex">
          <div class="card-t" style="margin:0">Checklist documental · transferencia</div>
          <div class="spacer"></div>
          <b style="font-size:.84rem">${recibidos} / ${obligatorios.length} obligatorios</b>
        </div>
        <div class="checklist-bar"><div class="checklist-fill" style="width:${pct}%"></div></div>

        ${window.GT_DOCS_TRANSFERENCIA.map(def => {
          const doc = porTipo[def.tipo];
          return `<div class="doc-row ${doc ? 'ok' : ''}">
            <div class="doc-ico">
              ${doc
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`}
            </div>
            <div class="doc-info">
              <strong>${h(def.label)} ${def.obligatorio ? '' : '<span class="t-muted" style="font-weight:400;font-size:.74rem">· opcional</span>'}</strong>
              <small>${doc ? h(doc.nombre_archivo) + ' · ' + Math.round((doc.tamano || 0) / 1024) + ' KB' : 'Sin archivo'}</small>
            </div>
            <div class="doc-actions">
              <span class="badge badge-${doc ? 'recibido' : 'pendiente'}">${doc ? 'Recibido' : 'Pendiente'}</span>
              ${doc ? `<a class="btn btn-ghost btn-sm" href="${h(GTApi.urlDocumento(doc.storage_path))}" target="_blank" rel="noopener">Ver</a>
                       <button class="btn btn-danger btn-sm" data-del="${h(doc.id)}">Quitar</button>`
                    : `<label class="file-label">Subir<input type="file" accept="image/*,application/pdf" data-tipo="${h(def.tipo)}"></label>`}
            </div>
          </div>`;
        }).join('')}

        <p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
          Formatos admitidos: foto o escaneo (JPG, PNG) y PDF · máximo 10 MB por archivo.
          Se guardan en Supabase Storage, en el bucket aislado <span class="t-mono">gestotrafic-docs</span>.
        </p>
      </div>`;

    cont.querySelectorAll('input[type="file"]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB', 'err'); inp.value = ''; return; }

        const label = inp.closest('.file-label');
        label.innerHTML = '<span class="spinner"></span>';
        try {
          await GTApi.subirDocumento(exp.id, inp.dataset.tipo, file);
          const nuevos = await GTApi.listarDocumentos(exp.id);
          docs.length = 0; nuevos.forEach(d => docs.push(d));
          toast('Documento subido', 'ok');
          panelDocs(exp, docs, cont);
        } catch (err) {
          toast(err.message || 'No se pudo subir', 'err');
          panelDocs(exp, docs, cont);
        }
      });
    });

    cont.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const doc = docs.find(d => d.id === b.dataset.del);
        if (!doc) return;
        b.disabled = true;
        try {
          await GTApi.borrarDocumento(doc);
          const nuevos = await GTApi.listarDocumentos(exp.id);
          docs.length = 0; nuevos.forEach(d => docs.push(d));
          toast('Documento eliminado', 'ok');
          panelDocs(exp, docs, cont);
        } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      });
    });
  }

  /* ---------- Panel: Contrato ---------- */
  function panelContrato(exp, docs, cont) {
    const faltan = [];
    if (!exp.vendedor_nombre) faltan.push('nombre del vendedor');
    if (!exp.vendedor_nif) faltan.push('DNI del vendedor');
    if (!exp.comprador_nombre) faltan.push('nombre del comprador');
    if (!exp.comprador_nif) faltan.push('DNI del comprador');
    if (!exp.precio_contrato) faltan.push('precio de contrato');

    cont.innerHTML = `
      <div class="card" style="max-width:760px">
        <div class="card-t">Contrato de compraventa pre-rellenado</div>
        <p class="t-muted" style="font-size:.85rem;margin-top:0">
          Genera el contrato con los datos del expediente <span class="t-mono">${h(exp.referencia)}</span>,
          listo para imprimir o guardar como PDF desde el navegador.
        </p>

        <dl class="dl" style="margin:18px 0">
          <dt>Vehículo</dt><dd>${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || '—')}</dd>
          <dt>Matrícula</dt><dd class="t-mono">${h(exp.matricula || '—')}</dd>
          <dt>Vendedor</dt><dd>${h(exp.vendedor_nombre || '—')}</dd>
          <dt>Comprador</dt><dd>${h(exp.comprador_nombre || '—')}</dd>
          <dt>Precio</dt><dd>${eur(exp.precio_contrato)}</dd>
        </dl>

        ${faltan.length ? `<div class="regul-note" style="margin-bottom:16px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
          <div>El contrato se generará con huecos en blanco. Faltan: <b>${h(faltan.join(', '))}</b>.</div>
        </div>` : ''}

        <div class="row-actions">
          <button class="btn" id="btn-contrato">Generar contrato</button>
          <button class="btn btn-ghost" id="btn-contrato-dl">Descargar .html</button>
        </div>

        <p class="t-muted" style="font-size:.76rem;margin-bottom:0;margin-top:16px">
          En la ventana del contrato, usa <b>Imprimir → Guardar como PDF</b> para obtener el archivo firmable.
        </p>
      </div>`;

    cont.querySelector('#btn-contrato').addEventListener('click', () => {
      const ok = GTContrato.abrir(exp);
      if (!ok) { toast('El navegador bloqueó la ventana. Usa "Descargar .html"', 'err'); return; }
      toast('Contrato generado', 'ok');
    });
    cont.querySelector('#btn-contrato-dl').addEventListener('click', () => {
      GTContrato.descargar(exp);
      toast('Contrato descargado', 'ok');
    });
  }

  /* ============================================================
     VISTA · KANBAN
     ============================================================ */
  async function vistaKanban() {
    loading('Cargando tablero…');
    const expedientes = await GTApi.listarExpedientes();
    const tactil = window.matchMedia('(pointer: coarse)').matches;

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div><h1>Tablero de expedientes</h1><p>Arrastra las tarjetas para cambiar el estado del trámite</p></div>
        <button class="btn" id="btn-nuevo-exp">+ Nuevo expediente</button>
      </div>

      <div class="kanban" id="kanban">
        ${window.GT_ESTADOS.map(est => {
          const items = expedientes.filter(e => e.estado === est.id);
          return `<div class="kan-col" data-estado="${h(est.id)}">
            <div class="kan-col-head">
              <span style="color:${est.color}">${h(est.label)}</span>
              <span class="kan-count">${items.length}</span>
            </div>
            <div class="kan-list" data-lista="${h(est.id)}">
              ${items.map(e => tarjetaKanban(e, tactil)).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${footer()}`;

    view.querySelector('#btn-nuevo-exp').addEventListener('click', () => (location.hash = '#/expedientes/nuevo'));
    activarDragDrop(view.querySelector('#kanban'));
  }

  function tarjetaKanban(e, tactil) {
    return `<div class="kan-card" draggable="true" data-id="${h(e.id)}">
      <div class="kan-card-ref">${h(e.referencia)}</div>
      <div class="kan-card-title">${h([e.marca, e.modelo].filter(Boolean).join(' ') || 'Sin vehículo')}</div>
      <div class="kan-card-meta">${h(e.matricula || '—')} · ${h(nombreCliente(e.cliente))}</div>
      <div class="kan-card-foot">
        <span class="t-muted">${fecha(e.created_at)}</span>
        <b>${e.total_impuestos != null ? eur(e.total_impuestos) : '—'}</b>
      </div>
      ${tactil ? `<select class="tab" style="width:100%;margin-top:9px;padding:6px 9px;font-size:.74rem" data-mover="${h(e.id)}">
        ${window.GT_ESTADOS.map(s => `<option value="${h(s.id)}" ${s.id === e.estado ? 'selected' : ''}>${h(s.label)}</option>`).join('')}
      </select>` : ''}
    </div>`;
  }

  function activarDragDrop(kanban) {
    let arrastrando = null;

    kanban.querySelectorAll('.kan-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        arrastrando = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        arrastrando = null;
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-mover]')) return;
        location.hash = '#/expedientes/' + card.dataset.id;
      });
    });

    // Cambio de estado en pantallas táctiles (donde no hay drag & drop nativo)
    kanban.querySelectorAll('[data-mover]').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await GTApi.actualizarExpediente(sel.dataset.mover, { estado: sel.value });
          toast('Movido a: ' + estadoInfo(sel.value).label, 'ok');
          vistaKanban();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    kanban.querySelectorAll('.kan-col').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));

      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const nuevoEstado = col.dataset.estado;
        const card = arrastrando || kanban.querySelector(`.kan-card[data-id="${id}"]`);
        if (!card) return;

        const origen = card.closest('.kan-col');
        if (origen === col) return;

        // Movimiento optimista: la tarjeta se coloca ya, y se revierte si falla.
        col.querySelector('.kan-list').appendChild(card);
        recontar(kanban);

        try {
          await GTApi.actualizarExpediente(id, { estado: nuevoEstado });
          toast('Movido a: ' + estadoInfo(nuevoEstado).label, 'ok');
        } catch (err) {
          origen.querySelector('.kan-list').appendChild(card);
          recontar(kanban);
          toast(err.message || 'No se pudo mover el expediente', 'err');
        }
      });
    });
  }

  function recontar(kanban) {
    kanban.querySelectorAll('.kan-col').forEach(col => {
      col.querySelector('.kan-count').textContent = col.querySelectorAll('.kan-card').length;
    });
  }

  /* ============================================================
     Cabecera móvil + router
     ============================================================ */
  function cabecera() {
    return `<button class="menu-toggle" id="menu-toggle" aria-label="Abrir menú" style="margin-bottom:14px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>`;
  }

  function abrirMenu() {
    sidebar.classList.add('open');
    const back = document.createElement('div');
    back.className = 'sidebar-backdrop';
    back.addEventListener('click', () => { sidebar.classList.remove('open'); back.remove(); });
    document.body.appendChild(back);
  }

  async function router() {
    const hash = location.hash.replace(/^#/, '') || '/dashboard';
    const [ruta, query] = hash.split('?');
    const partes = ruta.split('/').filter(Boolean);
    const seccion = partes[0] || 'dashboard';

    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === seccion));
    sidebar.classList.remove('open');
    document.querySelectorAll('.sidebar-backdrop').forEach(b => b.remove());
    window.scrollTo(0, 0);

    try {
      if (seccion === 'clientes') {
        partes[1] ? await vistaCliente(partes[1]) : await vistaClientes();
      } else if (seccion === 'expedientes') {
        if (partes[1] === 'nuevo') {
          const pre = new URLSearchParams(query || '').get('cliente');
          await vistaNuevoExpediente(pre);
        } else if (partes[1]) {
          await vistaExpediente(partes[1]);
        } else {
          await vistaExpedientes();
        }
      } else if (seccion === 'kanban') {
        await vistaKanban();
      } else {
        await vistaDashboard();
      }
    } catch (e) {
      errorView(e);
    }

    const mt = document.getElementById('menu-toggle');
    if (mt) mt.addEventListener('click', abrirMenu);
  }

  /* ---------------- Arranque ---------------- */
  session = GTAuth.requireSession();
  if (session) {
    document.getElementById('user-avatar').textContent = session.iniciales;
    document.getElementById('user-nombre').textContent = session.nombre;
    document.getElementById('user-rol').textContent = session.rol === 'admin' ? 'Administrador' : 'Gestor';
    document.getElementById('logout').addEventListener('click', () => {
      GTAuth.logout();
      location.replace('index.html');
    });

    window.addEventListener('hashchange', router);
    router();
  }
})();
