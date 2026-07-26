/* ============================================================
   GestoTrafic · Aplicación (router + vistas)
   Los formularios, el checklist documental y las pestañas de cada
   expediente se generan a partir del catálogo GT_TRAMITES.
   ============================================================ */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const sidebar = document.getElementById('sidebar');
  const T = window.GTTramites;
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

  const ICO_IA = '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.4"/>';

  const svg = (path, cls) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${cls ? `class="${cls}"` : ''}>${path}</svg>`;

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
    ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
    <div><b>GestoTrafic no conecta con la DGT ni con Hacienda.</b> El expediente queda <b>listo para presentar</b>: la gestoría lo presenta con el programa oficial de su colegio.</div>
  </div>`;

  const avisoTramite = (tr) => tr.aviso ? `<div class="regul-note">
    ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
    <div>${tr.aviso}</div>
  </div>` : '';

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

  /* ============================================================
     Desplegable estilizado (gt-sel)
     ------------------------------------------------------------
     Un <select> nativo pinta la lista desplegada con los colores del
     sistema operativo: sobre fondo oscuro las opciones no seleccionadas
     quedan grises e ilegibles. Este componente pinta la lista con el
     sistema de diseño del CRM, mantiene contraste AA en todas las
     opciones y es navegable con teclado.
     ============================================================ */
  function gtSelect({ opciones, valor, onChange, etiqueta }) {
    const wrap = document.createElement('div');
    wrap.className = 'gt-sel';
    const actual = () => opciones.find(o => o.id === valor) || opciones[0];

    wrap.innerHTML = `
      <button type="button" class="gt-sel-btn" aria-haspopup="listbox" aria-expanded="false"
              ${etiqueta ? `aria-label="${h(etiqueta)}"` : ''}>
        <span class="gt-sel-dot"></span>
        <span class="gt-sel-val"></span>
        ${svg('<path d="m6 9 6 6 6-6"/>', 'gt-sel-chev')}
      </button>
      <ul class="gt-sel-list" role="listbox" hidden>
        ${opciones.map(o => `<li class="gt-sel-opt" role="option" tabindex="-1" data-v="${h(o.id)}">
          <span class="gt-sel-dot" style="background:${h(o.color || '#8888a0')}"></span>
          <span class="gt-sel-opt-txt">${h(o.label)}</span>
          ${svg('<path d="M20 6 9 17l-5-5"/>', 'gt-sel-check')}
        </li>`).join('')}
      </ul>`;

    const btn = wrap.querySelector('.gt-sel-btn');
    const lista = wrap.querySelector('.gt-sel-list');
    const opts = Array.prototype.slice.call(wrap.querySelectorAll('.gt-sel-opt'));

    function pintar() {
      const o = actual();
      wrap.querySelector('.gt-sel-val').textContent = o.label;
      btn.querySelector('.gt-sel-dot').style.background = o.color || '#8888a0';
      opts.forEach(el => {
        const sel = el.dataset.v === valor;
        el.classList.toggle('sel', sel);
        el.setAttribute('aria-selected', sel ? 'true' : 'false');
      });
    }

    function fuera(e) { if (!wrap.contains(e.target)) abrir(false); }

    function abrir(on) {
      lista.hidden = !on;
      wrap.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) {
        document.addEventListener('mousedown', fuera);
        (opts.find(o => o.dataset.v === valor) || opts[0]).focus();
      } else {
        document.removeEventListener('mousedown', fuera);
      }
    }

    async function elegir(v) {
      abrir(false);
      btn.focus();
      if (v === valor) return;
      const previo = valor;
      valor = v;
      pintar();
      try {
        await onChange(v);
      } catch (err) {
        valor = previo;
        pintar();
        toast(err.message || 'No se pudo cambiar el estado', 'err');
      }
    }

    btn.addEventListener('click', () => abrir(lista.hidden));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(true); }
    });

    opts.forEach((el, i) => {
      el.addEventListener('click', () => elegir(el.dataset.v));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown')       { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)].focus(); }
        else if (e.key === 'ArrowUp')    { e.preventDefault(); opts[Math.max(i - 1, 0)].focus(); }
        else if (e.key === 'Home')       { e.preventDefault(); opts[0].focus(); }
        else if (e.key === 'End')        { e.preventDefault(); opts[opts.length - 1].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(el.dataset.v); }
        else if (e.key === 'Escape')     { e.preventDefault(); abrir(false); btn.focus(); }
      });
    });

    pintar();
    return wrap;
  }

  /** Desplegable de estado del expediente, con los colores del catálogo. */
  const selectorEstado = (valor, onChange) => gtSelect({
    opciones: window.GT_ESTADOS,
    valor,
    onChange,
    etiqueta: 'Estado del expediente'
  });

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
     Renderizado de campos desde el catálogo
     ============================================================ */

  /* Clientes con tipo `empresa`. Se refresca al entrar en las vistas que
     necesitan elegir una empresa vendedora. */
  let empresas = [];

  async function cargarClientes() {
    const clientes = await GTApi.listarClientes();
    empresas = clientes.filter(c => c.tipo === 'empresa');
    return clientes;
  }

  /* Gestores. Solo el admin puede listarlos (lo impide el RLS), y solo él
     necesita la lista: es quien reasigna expedientes. */
  let gestores = [];

  async function cargarGestores() {
    if (!GTAuth.isAdmin()) { gestores = []; return gestores; }
    gestores = await GTApi.listarUsuarios();
    return gestores;
  }

  const nombreGestor = (e) =>
    (e && e.gestor && e.gestor.nombre) ? e.gestor.nombre : '— sin asignar —';

  /** Qué alcance tiene lo que se está viendo. Lo decide el RLS, no la interfaz. */
  const ambito = () => GTAuth.isAdmin()
    ? 'Todos los expedientes de la gestoría'
    : 'Tus expedientes asignados';

  function campoHTML(c, valor) {
    const id = 'f-' + c.n;
    const req = c.req ? 'required' : '';
    let control;

    if (c.t === 'empresa') {
      const ops = ['<option value="">— Selecciona la empresa vendedora —</option>'].concat(
        empresas.map(e => `<option value="${h(e.id)}" ${String(valor) === String(e.id) ? 'selected' : ''}>${h(nombreCliente(e))} · ${h(e.nif)}</option>`)
      ).join('');
      control = `<select name="${h(c.n)}" id="${id}">${ops}</select>`
        + (empresas.length ? '' : `<small class="field-hint">No hay clientes de tipo <b>empresa</b>. <a href="#/clientes">Da de alta el concesionario</a> para poder seleccionarlo.</small>`);

    } else if (c.t === 'select') {
      const ops = (c.op || []).map(o => {
        const v = (typeof o === 'string') ? o : o.v;
        const l = (typeof o === 'string') ? o : o.l;
        const sel = (valor !== null && valor !== undefined && String(valor) === String(v))
          || ((valor === null || valor === undefined) && c.def === v);
        return `<option value="${h(v)}" ${sel ? 'selected' : ''}>${h(l)}</option>`;
      }).join('');
      control = `<select name="${h(c.n)}" id="${id}" ${req}>${ops}</select>`;

    } else if (c.t === 'textarea') {
      control = `<textarea name="${h(c.n)}" id="${id}" ${c.ph ? `placeholder="${h(c.ph)}"` : ''} ${req}>${h(valor || '')}</textarea>`;

    } else {
      const tipo = c.t === 'number' ? 'number' : (c.t === 'date' ? 'date' : 'text');
      control = `<input type="${tipo}" name="${h(c.n)}" id="${id}"
        value="${h(valor === null || valor === undefined ? '' : valor)}"
        ${c.paso ? `step="${h(c.paso)}"` : ''} ${c.t === 'number' ? 'min="0"' : ''}
        ${c.ph ? `placeholder="${h(c.ph)}"` : ''} ${req}>`;
    }

    return `<div class="field ${c.full || c.t === 'textarea' ? 'full' : ''}"
      data-campo="${h(c.n)}"
      ${c.soloSi ? `data-solo-si="${h(c.soloSi.campo)}" data-solo-si-val="${h(c.soloSi.valor)}"` : ''}
      ${c.autoSi ? `data-auto-si="${h(c.autoSi)}"` : ''}>
      <label for="${id}" data-l="${h(c.l)}" ${c.lSi ? `data-l-si="${h(c.lSi)}"` : ''}>${h(c.l)}${c.req ? ' *' : ''}</label>${control}</div>`;
  }

  /** Aviso que acompaña a la sección de vendedor cuando vende una empresa. */
  const notaEmpresa = () => `<div class="empresa-note hidden" data-nota-empresa>
    ${svg('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>')}
    <div>Los datos del vendedor se <b>vuelcan de su ficha de cliente</b>: no se escriben a mano.
      El expediente pedirá <b>Factura de venta</b> en lugar de contrato de compraventa.</div>
  </div>`;

  /** `conCopiar` solo en el alta: es donde existe el selector de cliente. */
  function seccionesHTML(tr, exp, conCopiar) {
    return tr.secciones.map(s => {
      const conEmpresa = s.campos.some(c => c.t === 'empresa');
      return `
      <div class="form-sec">${h(s.t)}</div>
      ${(conCopiar && s.copiarCliente) ? `<label class="flex" style="font-size:.8rem;color:var(--muted);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" data-copiar="${h(s.t)}" style="width:auto"> Rellenar con los datos del cliente seleccionado
      </label>` : ''}
      ${conEmpresa ? notaEmpresa() : ''}
      <div class="form-grid">
        ${s.campos.map(c => campoHTML(c, exp ? T.leer(exp, c.n) : null)).join('')}
      </div>`;
    }).join('');
  }

  /** Separa los valores del formulario en columnas propias y en `datos` jsonb.
      `exp` conserva las claves de `datos` que no son campos del catálogo
      (por ejemplo `itp_exento`, que se marca desde la pestaña de ITP). */
  function recoger(root, tr, exp) {
    const fila = {}, datos = Object.assign({}, (exp && exp.datos) || {});
    T.campos(tr).forEach(c => {
      let v = c.t === 'number' ? num(root, c.n) : val(root, c.n);
      if (c.t === 'number' && (v === null || isNaN(v))) v = null;
      if (c.col) fila[c.n] = v; else datos[c.n] = v;
    });
    fila.datos = datos;
    return fila;
  }

  /* ------------------------------------------------------------
     Vendedor particular / empresa
     Si el vendedor es una empresa, el gestor la elige del listado de
     clientes y sus datos se vuelcan: no se reescriben a mano.
     ------------------------------------------------------------ */
  const CAMPOS_VENDEDOR = ['vendedor_nombre', 'vendedor_nif', 'vendedor_direccion', 'vendedor_telefono'];

  function activarVendedorEmpresa(root) {
    const selTipo = root.querySelector('[name="vendedor_tipo"]');
    if (!selTipo) return;                       // trámite sin vendedor configurable
    const selEmpresa = root.querySelector('[name="vendedor_empresa_id"]');

    const set = (n, v) => { const el = root.querySelector(`[name="${n}"]`); if (el) el.value = v || ''; };

    function volcar() {
      const c = empresas.find(e => e.id === (selEmpresa && selEmpresa.value));
      if (!c) return;
      set('vendedor_nombre', c.razon_social || c.nombre);
      set('vendedor_nif', c.nif);
      set('vendedor_direccion', [c.direccion, c.cp, c.ciudad].filter(Boolean).join(', '));
      set('vendedor_telefono', c.telefono);
    }

    function sincronizar(volcarAhora) {
      const esEmpresa = selTipo.value === 'empresa';

      root.querySelectorAll('[data-solo-si]').forEach(f => {
        const dep = root.querySelector(`[name="${f.dataset.soloSi}"]`);
        f.classList.toggle('hidden', !dep || dep.value !== f.dataset.soloSiVal);
      });

      root.querySelectorAll('[data-auto-si="empresa"]').forEach(f => {
        const input = f.querySelector('input');
        const lbl = f.querySelector('label');
        if (input) input.readOnly = esEmpresa;
        if (lbl && lbl.dataset.lSi) lbl.textContent = esEmpresa ? lbl.dataset.lSi : lbl.dataset.l;
        f.classList.toggle('is-auto', esEmpresa);
      });

      const nota = root.querySelector('[data-nota-empresa]');
      if (nota) nota.classList.toggle('hidden', !esEmpresa);

      if (esEmpresa && volcarAhora) volcar();
    }

    selTipo.addEventListener('change', () => sincronizar(true));
    if (selEmpresa) selEmpresa.addEventListener('change', volcar);
    sincronizar(false);                         // al pintar no se pisa lo ya guardado
  }

  /** Rellena los campos de "persona" de una sección con los datos del cliente. */
  function copiarCliente(form, seccion, cliente) {
    if (!cliente) return false;
    const nombre = nombreCliente(cliente);
    const dir = [cliente.direccion, cliente.ciudad].filter(Boolean).join(', ');
    const mapa = {
      nombre: ['titular_nombre', 'comprador_nombre', 'vendedor_nombre'],
      nif: ['titular_nif', 'comprador_nif', 'vendedor_nif'],
      direccion: ['titular_direccion', 'comprador_direccion', 'vendedor_direccion'],
      telefono: ['titular_telefono', 'comprador_telefono', 'vendedor_telefono']
    };
    const nombres = seccion.campos.map(c => c.n);
    const set = (n, v) => { const el = form.querySelector(`[name="${n}"]`); if (el) el.value = v || ''; };
    mapa.nombre.forEach(n => { if (nombres.includes(n)) set(n, nombre); });
    mapa.nif.forEach(n => { if (nombres.includes(n)) set(n, cliente.nif); });
    mapa.direccion.forEach(n => { if (nombres.includes(n)) set(n, dir); });
    mapa.telefono.forEach(n => { if (nombres.includes(n)) set(n, cliente.telefono); });
    return true;
  }

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
          <p>${ambito()}</p>
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
          <div class="kpi-lbl">ITP calculado</div>
          <div class="kpi-num">${eur(k.impuestosMes)}</div>
          <div class="kpi-sub">transferencias · este mes</div>
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
          <div class="card-t">Expedientes por tipo de trámite</div>
          <div class="estado-bars">
            ${window.GT_TRAMITES.map(tr => {
              const n = expedientes.filter(e => e.tipo_tramite === tr.id).length;
              const max = Math.max(1, ...window.GT_TRAMITES.map(t2 => expedientes.filter(e => e.tipo_tramite === t2.id).length));
              return `<div class="estado-bar-row">
                <span class="t-muted">${h(tr.corto)}</span>
                <div class="estado-bar-track">
                  <div class="estado-bar-fill" style="width:${(n / max * 100).toFixed(1)}%;background:var(--p)"></div>
                </div>
                <b>${n}</b>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-t">Últimos expedientes</div>
          ${recientes.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Referencia</th><th>Trámite</th><th>Cliente</th><th>Vehículo</th><th>Estado</th></tr></thead>
            <tbody>${recientes.map(e => `
              <tr class="clickable" data-exp="${h(e.id)}">
                <td class="t-mono">${h(e.referencia)}</td>
                <td><span class="badge badge-tramite">${h(T.tramite(e.tipo_tramite).corto)}</span></td>
                <td>${h(nombreCliente(e.cliente))}</td>
                <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}<br><span class="t-muted" style="font-size:.76rem">${h(e.matricula || '')}</span></td>
                <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
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
          ${svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>')}
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
      <div class="form-grid">
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
      <div class="form-grid">
        <div class="field"><label>Teléfono</label><input name="telefono" placeholder="600 000 000"></div>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="cliente@email.com"></div>
      </div>
      <div class="field"><label>Dirección</label><input name="direccion" placeholder="Calle Mieses 1, 3º"></div>
      <div class="form-grid">
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
              <thead><tr><th>Referencia</th><th>Trámite</th><th>Vehículo</th><th>Estado</th><th>Fecha</th></tr></thead>
              <tbody>${expedientes.map(e => `
                <tr class="clickable" data-exp="${h(e.id)}">
                  <td class="t-mono">${h(e.referencia)}</td>
                  <td><span class="badge badge-tramite">${h(T.tramite(e.tipo_tramite).corto)}</span></td>
                  <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}<br><span class="t-muted" style="font-size:.76rem">${h(e.matricula || '')}</span></td>
                  <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
                  <td class="t-muted">${fecha(e.created_at)}</td>
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
    if (btnDel) btnDel.addEventListener('click', () => {
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
     VISTA · LISTA DE EXPEDIENTES (con filtro por tipo)
     ============================================================ */
  let filtroTipo = 'todos';

  async function vistaExpedientes() {
    loading('Cargando expedientes…');
    const [todos] = await Promise.all([GTApi.listarExpedientes(), cargarGestores()]);
    const verGestor = GTAuth.isAdmin();

    function pintar() {
      const expedientes = filtroTipo === 'todos' ? todos : todos.filter(e => e.tipo_tramite === filtroTipo);
      const cont = view.querySelector('#lista-exp');

      cont.innerHTML = expedientes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Referencia</th><th>Trámite</th><th>Cliente</th>${verGestor ? '<th>Gestor</th>' : ''}<th>Vehículo</th><th>Matrícula</th><th>Estado</th><th>ITP</th></tr></thead>
        <tbody>${expedientes.map(e => `
          <tr class="clickable" data-exp="${h(e.id)}">
            <td class="t-mono">${h(e.referencia)}${ES_PROPUESTA_IA(e) ? ' <span class="badge badge-ia" title="Montado por Gest-IA · pendiente de validación">IA</span>' : ''}</td>
            <td><span class="badge badge-tramite">${h(T.tramite(e.tipo_tramite).corto)}</span></td>
            <td>${h(nombreCliente(e.cliente))}</td>
            ${verGestor ? `<td class="t-muted">${h(nombreGestor(e))}</td>` : ''}
            <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}</td>
            <td class="t-mono">${h(e.matricula || '—')}</td>
            <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
            <td class="t-num">${T.tramite(e.tipo_tramite).calculo !== 'itp'
              ? '<span class="t-muted">n/a</span>'
              : (T.esExentoITP(e) ? '<span class="badge badge-exento">Exento</span>' : eur(e.total_impuestos))}</td>
          </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">
            ${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}
            <p>${filtroTipo === 'todos' ? 'Aún no hay expedientes abiertos.' : 'No hay expedientes de este tipo de trámite.'}</p>
            <button class="btn" id="btn-nuevo-exp-2">+ Crear expediente</button>
          </div>`;

      cont.querySelectorAll('[data-exp]').forEach(tr => tr.addEventListener('click', () => (location.hash = '#/expedientes/' + tr.dataset.exp)));
      const b2 = cont.querySelector('#btn-nuevo-exp-2');
      if (b2) b2.addEventListener('click', () => (location.hash = '#/expedientes/nuevo'));

      view.querySelector('#cuenta-exp').textContent =
        `${expedientes.length} de ${todos.length} expediente${todos.length === 1 ? '' : 's'}`;
    }

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div><h1>Expedientes</h1><p id="cuenta-exp">—</p></div>
        <button class="btn" id="btn-nuevo-exp">+ Nuevo expediente</button>
      </div>

      <div class="filtro-bar">
        <span class="t-muted" style="font-size:.78rem">Filtrar por trámite</span>
        <select id="filtro-tipo">
          <option value="todos">Todos los trámites (${todos.length})</option>
          ${window.GT_TRAMITES.map(tr => {
            const n = todos.filter(e => e.tipo_tramite === tr.id).length;
            return `<option value="${h(tr.id)}" ${filtroTipo === tr.id ? 'selected' : ''}>${h(tr.nombre)} (${n})</option>`;
          }).join('')}
        </select>
      </div>

      <div id="lista-exp"></div>
      ${footer()}`;

    view.querySelector('#btn-nuevo-exp').addEventListener('click', () => (location.hash = '#/expedientes/nuevo'));
    view.querySelector('#filtro-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; pintar(); });
    pintar();
  }

  /* ============================================================
     VISTA · NUEVO EXPEDIENTE (paso 1: tipo · paso 2: formulario)
     ============================================================ */
  async function vistaNuevoExpediente(clientePre, tipoPre) {
    if (!tipoPre) return vistaElegirTipo(clientePre);

    const tr = T.tramite(tipoPre);
    loading('Preparando formulario…');
    const clientes = await cargarClientes();

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/expedientes/nuevo${clientePre ? '?cliente=' + h(clientePre) : ''}" class="t-muted" style="font-size:.8rem">← Cambiar tipo de trámite</a>
          <h1 style="margin-top:6px">${h(tr.nombre)}</h1>
          <p>${h(tr.descripcion)}</p>
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
              ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
              <div>No hay clientes dados de alta. <a href="#/clientes">Crea primero un cliente</a> para asociarlo al expediente.</div>
            </div>`}

          ${seccionesHTML(tr, null, true)}

          <div class="form-sec">Notas</div>
          <div class="field"><textarea name="notas" placeholder="Observaciones del expediente…"></textarea></div>
        </div>

        ${avisoTramite(tr)}
        ${avisoRegulado()}

        <div class="flex">
          <button type="submit" class="btn" id="btn-crear">Crear expediente</button>
          <a href="#/expedientes" class="btn btn-ghost">Cancelar</a>
        </div>
      </form>
      ${footer()}`;

    const form = view.querySelector('#form-exp');
    activarVendedorEmpresa(form);

    form.querySelectorAll('[data-copiar]').forEach(chk => {
      chk.addEventListener('change', () => {
        if (!chk.checked) return;
        const sel = form.querySelector('[name="cliente_id"]');
        const c = clientes.find(x => x.id === (sel && sel.value));
        if (!c) { toast('Selecciona antes un cliente', 'err'); chk.checked = false; return; }
        const seccion = tr.secciones.find(s => s.t === chk.dataset.copiar);
        copiarCliente(form, seccion, c);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = view.querySelector('#btn-crear');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const datos = recoger(form, tr);
        datos.cliente_id = val(form, 'cliente_id');
        datos.tipo_tramite = tr.id;
        datos.estado = 'nuevo';
        datos.notas = val(form, 'notas');

        const exp = await GTApi.crearExpediente(datos);
        toast('Expediente ' + exp.referencia + ' creado', 'ok');
        location.hash = '#/expedientes/' + exp.id;
      } catch (err) {
        toast(err.message || 'No se pudo crear el expediente', 'err');
        btn.disabled = false;
        btn.textContent = 'Crear expediente';
      }
    });
  }

  function vistaElegirTipo(clientePre) {
    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/expedientes" class="t-muted" style="font-size:.8rem">← Expedientes</a>
          <h1 style="margin-top:6px">Nuevo expediente</h1>
          <p>Elige el tipo de trámite. El formulario y el checklist se adaptan solos.</p>
        </div>
      </div>

      <div class="tipo-grid">
        ${window.GT_TRAMITES.map(tr => `
          <button type="button" class="tipo-card" data-tipo="${h(tr.id)}">
            <div class="tipo-card-ico">${svg(tr.icono)}</div>
            <div class="tipo-card-txt">
              <strong>${h(tr.nombre)}</strong>
              <small>${h(tr.descripcion)}</small>
              <div class="tipo-card-tags">
                <span class="tag">${T.docsDe(tr, {}).filter(d => d.obligatorio).length} docs</span>
                ${tr.calculo === 'itp' ? '<span class="tag calc">Calcula ITP</span>' : ''}
                ${tr.genera === 'contrato' ? '<span class="tag doc">Genera contrato</span>' : ''}
                ${tr.genera === 'comunicacion' ? '<span class="tag doc">Genera comunicación</span>' : ''}
              </div>
            </div>
          </button>`).join('')}
      </div>

      <div style="margin-top:20px">${avisoRegulado()}</div>
      ${footer()}`;

    view.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
      const q = ['tipo=' + b.dataset.tipo];
      if (clientePre) q.push('cliente=' + clientePre);
      location.hash = '#/expedientes/nuevo?' + q.join('&');
    }));
  }

  /* ============================================================
     VISTA · DETALLE DE EXPEDIENTE
     ============================================================ */
  async function vistaExpediente(id) {
    loading('Cargando expediente…');
    const [exp, docs] = await Promise.all([
      GTApi.obtenerExpediente(id),
      GTApi.listarDocumentos(id),
      cargarClientes(),                         // alimenta el selector de empresa vendedora
      cargarGestores()                          // solo devuelve algo si eres admin
    ]);
    const tr = T.tramite(exp.tipo_tramite);

    const pestanas = [];
    if (tr.calculo === 'itp') pestanas.push({ id: 'itp', label: 'Calculadora ITP' });
    pestanas.push({ id: 'datos', label: 'Datos del expediente' });
    pestanas.push({ id: 'docs', label: 'Documentación' });
    if (tr.genera === 'contrato') pestanas.push({ id: 'genera', label: 'Contrato' });
    if (tr.genera === 'comunicacion') pestanas.push({ id: 'genera', label: 'Comunicación' });

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/expedientes" class="t-muted" style="font-size:.8rem">← Expedientes</a>
          <h1 style="margin-top:6px">${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || tr.nombre)}</h1>
          <p>
            <span class="badge badge-tramite">${h(tr.nombre)}</span>
            <span class="t-mono" style="margin-left:8px">${h(exp.referencia)}</span>
            · ${h(exp.matricula || 'sin matrícula')} · ${h(nombreCliente(exp.cliente))}
          </p>
        </div>
        <div class="row-actions">
          <div id="slot-estado"></div>
          ${GTAuth.isAdmin() ? `<button class="btn btn-danger btn-sm" id="btn-borrar-exp">Eliminar</button>` : ''}
        </div>
      </div>

      ${bannerGestIA(exp)}

      <div class="tabs" id="tabs">
        ${pestanas.map((p, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${p.id}">${h(p.label)}</button>`).join('')}
      </div>

      <div id="tab-content"></div>
      ${footer()}`;

    activarBannerGestIA(exp, tr);

    const cont = view.querySelector('#tab-content');
    const paneles = {
      itp: () => panelITP(exp, cont),
      datos: () => panelDatos(exp, tr, cont),
      docs: () => panelDocs(exp, tr, docs, cont),
      genera: () => panelGenera(exp, tr, cont)
    };
    paneles[pestanas[0].id]();

    view.querySelectorAll('#tabs .tab').forEach(t => t.addEventListener('click', () => {
      view.querySelectorAll('#tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      paneles[t.dataset.tab]();
    }));

    view.querySelector('#slot-estado').appendChild(
      selectorEstado(exp.estado, async (nuevo) => {
        await GTApi.actualizarExpediente(id, { estado: nuevo });
        exp.estado = nuevo;
        toast('Estado actualizado: ' + estadoInfo(nuevo).label, 'ok');
      })
    );

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

  /* ---------- Gest-IA · aviso de validación pendiente ---------- */

  const ES_PROPUESTA_IA = (exp) => exp.ia_estado === 'pendiente_validacion';

  function bannerGestIA(exp) {
    const ia = exp.ia_extraccion || {};
    if (exp.ia_estado === 'validado') {
      return `<div class="ia-banner validado">
        ${svg('<path d="M20 6 9 17l-5-5"/>')}
        <div><b>Validado por ${h((exp.ia_validador && exp.ia_validador.nombre) || 'un gestor')}</b>
          el ${fecha(exp.ia_validado_at)}. Este expediente lo montó Gest-IA y ya está en el flujo normal.</div>
      </div>`;
    }
    if (!ES_PROPUESTA_IA(exp)) return '';

    const props = ia.propuestas || {};
    const dudosos = Object.keys(props).filter(k => props[k].confianza !== 'alta');
    const huecos = ia.huecos || [];

    return `<div class="ia-banner">
      <div class="ia-banner-cab">
        <div class="ia-banner-ico">${svg(ICO_IA)}</div>
        <div>
          <b>Pendiente de validación · propuesta de Gest-IA</b>
          <small>Cada dato de abajo es una <b>propuesta</b> leída de los documentos, no un dato confirmado.
            Revisa lo resaltado, corrige lo que haga falta y valida.</small>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="btn-validar-ia">Validar y crear</button>
      </div>
      <div class="ia-banner-kpis">
        <span class="ia-chip alta">${Object.keys(props).length - dudosos.length} campos con confianza alta</span>
        ${dudosos.length ? `<span class="ia-chip media">${dudosos.length} a revisar</span>` : ''}
        ${huecos.length ? `<span class="ia-chip baja">${huecos.length} obligatorio${huecos.length === 1 ? '' : 's'} sin leer</span>` : ''}
        ${exp.ia_modelo ? `<span class="t-muted" style="font-size:.72rem">leído con <span class="t-mono">${h(exp.ia_modelo)}</span></span>` : ''}
      </div>
      ${huecos.length ? `<div class="ia-huecos">
        ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
        <div>Gest-IA no pudo leer con seguridad: <b>${huecos.map(x => h(x.etiqueta)).join(', ')}</b>.
          Están en blanco a propósito — no se inventa un dato fiscal.</div>
      </div>` : ''}
    </div>`;
  }

  function activarBannerGestIA(exp, tr) {
    const btn = view.querySelector('#btn-validar-ia');
    if (!btn) return;

    btn.addEventListener('click', () => modal({
      titulo: 'Validar el expediente',
      cuerpo: `<p style="margin-top:0">Confirmas que has revisado los datos que propuso Gest-IA para
          <b>${h(exp.referencia)}</b> y que son correctos.</p>
        <p class="t-muted" style="font-size:.82rem">Queda registrado quién valida y cuándo. A partir de ahí
          el expediente entra en el flujo normal y deja de marcarse como propuesta.</p>
        <div class="field">
          <label for="f-estado-val">Estado al validar</label>
          <select name="estado_val" id="f-estado-val">
            ${window.GT_ESTADOS.map(e => `<option value="${h(e.id)}" ${e.id === 'documentacion' ? 'selected' : ''}>${h(e.label)}</option>`).join('')}
          </select>
        </div>`,
      okTexto: 'Validar y crear',
      onOk: async (root) => {
        const cambios = {
          ia_estado: 'validado',
          ia_validado_por: session.id,
          ia_validado_at: new Date().toISOString(),
          estado: val(root, 'estado_val') || exp.estado
        };
        await GTApi.actualizarExpediente(exp.id, cambios);
        Object.assign(exp, cambios);
        toast('Expediente validado por ' + session.nombre, 'ok');
        vistaExpediente(exp.id);
      }
    }));
  }

  /** Marca en el formulario los campos que vienen de Gest-IA. */
  function decorarPropuestasIA(form, exp) {
    if (!ES_PROPUESTA_IA(exp)) return;
    const ia = exp.ia_extraccion || {};
    const props = ia.propuestas || {};
    const huecos = {};
    (ia.huecos || []).forEach(x => { huecos[x.campo] = true; });

    form.querySelectorAll('.field[data-campo]').forEach(f => {
      const campo = f.dataset.campo;
      const p = props[campo];
      const lbl = f.querySelector('label');
      if (!lbl) return;

      if (p && p.valor !== null) {
        f.classList.add('ia-campo', 'ia-' + p.confianza);
        lbl.insertAdjacentHTML('beforeend',
          `<span class="ia-sello ${h(p.confianza)}" title="${h('Leído de: ' + p.origen + (p.nota ? ' · ' + p.nota : ''))}">IA ${h(p.confianza)}</span>`);
      } else if (huecos[campo] || (p && p.valor === null)) {
        f.classList.add('ia-campo', 'ia-hueco');
        lbl.insertAdjacentHTML('beforeend',
          `<span class="ia-sello hueco" title="${h((p && p.nota) || 'Gest-IA no pudo leer este dato')}">no leído</span>`);
      }
    });
  }

  /* ---------- Panel: Calculadora ITP (solo transferencia) ---------- */
  function panelITP(exp, cont) {
    const vendeEmpresa = T.esVendedorEmpresa(exp);
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

          <div class="form-grid">
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

          <label class="gt-toggle">
            <input type="checkbox" id="chk-exento" ${T.esExentoITP(exp) ? 'checked' : ''}>
            <span class="gt-toggle-track"><span class="gt-toggle-knob"></span></span>
            <span class="gt-toggle-txt">
              <b>Operación con factura (exenta de ITP)</b>
              <small>Venta de empresa documentada con factura sujeta a IVA. <b>Lo confirma el gestor</b>: nunca se marca solo. La tasa DGT se sigue liquidando.</small>
            </span>
          </label>
          ${vendeEmpresa ? `<div class="empresa-note" style="margin-bottom:14px">
            ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
            <div>El vendedor de este expediente es una <b>empresa</b>. Si emite factura con IVA, la transmisión suele quedar <b>exenta de ITP</b>: revísalo y márcalo arriba si procede.</div>
          </div>` : ''}

          <button class="btn btn-full" id="btn-calcular" style="margin-top:6px">Calcular ITP y tasas</button>

          <div class="itp-out" id="itp-out">
            <div class="itp-cell"><div class="itp-cell-num" id="c-venal">—</div><div class="itp-cell-lbl">Valor venal</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-itp">—</div><div class="itp-cell-lbl">ITP</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-dgt">—</div><div class="itp-cell-lbl">Tasa DGT</div></div>
            <div class="itp-cell total"><div class="itp-cell-num" id="c-total">—</div><div class="itp-cell-lbl">Total</div></div>
          </div>

          <div class="itp-detail" id="itp-detail"></div>
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

    /* Celdas y detalle se pintan siempre desde `exp`, para que el cálculo y
       la exención compartan una única fuente de verdad. */
    function pintarResultado() {
      const exento = T.esExentoITP(exp);
      cont.querySelector('#c-venal').textContent = exp.valor_venal != null ? eur(exp.valor_venal) : '—';
      cont.querySelector('#c-dgt').textContent   = exp.tasa_dgt != null ? eur(exp.tasa_dgt) : '—';
      cont.querySelector('#c-total').textContent = exp.total_impuestos != null ? eur(exp.total_impuestos) : '—';

      const celda = cont.querySelector('#c-itp');
      celda.innerHTML = exento
        ? '<span class="itp-exento">Exento</span>'
        : h(exp.itp_importe != null ? eur(exp.itp_importe) : '—');
      celda.closest('.itp-cell').classList.toggle('exento', exento);

      const base = exp.calculo_json
        ? detalleTexto(exp.calculo_json)
        : 'Introduce el valor BOE del vehículo y pulsa <b>Calcular</b> para obtener el ITP, la tasa DGT y el valor venal.';

      cont.querySelector('#itp-detail').innerHTML = exento
        ? `<div class="itp-exento-nota"><b>Operación exenta de ITP</b>, confirmada por el gestor:
             venta con factura de empresa sujeta a IVA. El ITP del expediente queda en <b>0,00 €</b>
             y el total se reduce a la tasa DGT.</div>` + base
        : base;
    }
    pintarResultado();

    cont.querySelector('#chk-exento').addEventListener('change', async (ev) => {
      const chk = ev.target;
      const exento = chk.checked;
      const calc = exp.calculo_json || {};
      const datos = Object.assign({}, exp.datos || {}, { itp_exento: exento });

      // Al retirar la exención se recupera el importe que devolvió el motor.
      const cambios = exento
        ? { datos, itp_importe: 0, total_impuestos: exp.tasa_dgt != null ? Number(exp.tasa_dgt) : null }
        : { datos, itp_importe: calc.itp ?? null, total_impuestos: calc.total_impuestos ?? null };

      chk.disabled = true;
      try {
        await GTApi.actualizarExpediente(exp.id, cambios);
        Object.assign(exp, cambios);
        pintarResultado();
        toast(exento ? 'Expediente marcado como exento de ITP' : 'Exención de ITP retirada', 'ok');
      } catch (err) {
        chk.checked = !exento;
        toast(err.message || 'No se pudo guardar la exención', 'err');
      } finally {
        chk.disabled = false;
      }
    });

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

        /* La exención la decide el gestor, no el motor: si está marcada se
           respeta y solo queda la tasa DGT. `calculo_json` guarda siempre el
           resultado íntegro del motor para poder auditarlo y revertirla. */
        const exento = T.esExentoITP(exp);
        const itpFinal = exento ? 0 : r.itp;
        const totalFinal = exento ? r.tasa_dgt : r.total_impuestos;

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
          itp_importe: itpFinal,
          tasa_dgt: r.tasa_dgt,
          total_impuestos: totalFinal,
          calculo_json: r,
          calculado_at: new Date().toISOString()
        });

        Object.assign(exp, {
          valor_boe: payload.valor_boe, precio_contrato: payload.precio_contrato,
          valor_venal: r.valor_venal, itp_importe: itpFinal, tasa_dgt: r.tasa_dgt,
          total_impuestos: totalFinal, calculo_json: r
        });

        pintarResultado();
        toast(exento ? 'Cálculo guardado · expediente exento de ITP' : 'ITP calculado y guardado', 'ok');
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

  /* ---------- Panel: Datos (formulario editable generado por catálogo) ---------- */
  function panelDatos(exp, tr, cont) {
    cont.innerHTML = `
      <div class="detail-grid">
        <form class="card" id="form-datos" style="align-self:start">
          <div class="flex" style="margin-bottom:2px">
            <div class="card-t" style="margin:0">Datos de ${h(tr.corto.toLowerCase())}</div>
            <div class="spacer"></div>
            <button type="submit" class="btn btn-sm" id="btn-guardar">Guardar cambios</button>
          </div>
          ${seccionesHTML(tr, exp)}
          <div class="form-sec">Notas</div>
          <div class="field"><textarea name="notas" placeholder="Observaciones…">${h(exp.notas || '')}</textarea></div>
        </form>

        <div class="stack">
          <div class="card">
            <div class="card-t">Expediente</div>
            <dl class="dl">
              <dt>Referencia</dt><dd class="t-mono">${h(exp.referencia)}</dd>
              <dt>Trámite</dt><dd>${h(tr.nombre)}</dd>
              <dt>Estado</dt><dd><span class="badge badge-${h(exp.estado)}">${h(estadoInfo(exp.estado).label)}</span></dd>
              <dt>Cliente</dt><dd>${h(nombreCliente(exp.cliente))}</dd>
              <dt>Gestor</dt><dd>${h(nombreGestor(exp))}</dd>
              <dt>Apertura</dt><dd>${fecha(exp.created_at)}</dd>
              <dt>Cálculo fiscal</dt><dd>${tr.calculo === 'itp'
                ? (T.esExentoITP(exp) ? '<span class="badge badge-exento">ITP exento</span>' : 'ITP (automático)')
                : 'No aplica'}</dd>
              ${tr.calculo === 'itp' ? `<dt>Vendedor</dt><dd>${T.esVendedorEmpresa(exp) ? 'Empresa / concesionario' : 'Particular'}</dd>` : ''}
            </dl>
          </div>
          ${GTAuth.isAdmin() ? `<div class="card">
            <div class="card-t">Reasignar expediente</div>
            <p class="t-muted" style="font-size:.79rem;margin:0 0 12px">
              Cambia el gestor responsable. Solo un administrador puede hacerlo:
              el RLS se lo niega a un gestor.
            </p>
            <div class="field" style="margin:0">
              <label for="f-gestor">Gestor asignado</label>
              <select id="f-gestor">
                <option value="">— sin asignar —</option>
                ${gestores.map(g => `<option value="${h(g.id)}" ${exp.gestor_id === g.id ? 'selected' : ''}>${h(g.nombre)} · ${h(g.usuario)}${g.activo ? '' : ' (desactivado)'}</option>`).join('')}
              </select>
            </div>
          </div>` : ''}
          ${avisoTramite(tr)}
          ${avisoRegulado()}
        </div>
      </div>`;

    const form = cont.querySelector('#form-datos');
    activarVendedorEmpresa(form);
    decorarPropuestasIA(form, exp);

    const selGestor = cont.querySelector('#f-gestor');
    if (selGestor) selGestor.addEventListener('change', async () => {
      const previo = exp.gestor_id;
      selGestor.disabled = true;
      try {
        await GTApi.reasignarExpediente(exp.id, selGestor.value || null);
        exp.gestor_id = selGestor.value || null;
        exp.gestor = gestores.find(g => g.id === exp.gestor_id) || null;
        toast('Expediente reasignado a ' + (exp.gestor ? exp.gestor.nombre : 'nadie'), 'ok');
        panelDatos(exp, tr, cont);
      } catch (err) {
        selGestor.value = previo || '';
        toast(err.message || 'No se pudo reasignar', 'err');
      } finally {
        selGestor.disabled = false;
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = cont.querySelector('#btn-guardar');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const cambios = recoger(form, tr, exp);
        cambios.notas = val(form, 'notas');
        await GTApi.actualizarExpediente(exp.id, cambios);
        Object.assign(exp, cambios);
        toast('Datos guardados', 'ok');
        panelDatos(exp, tr, cont);              // refleja tipo de vendedor y exención
      } catch (err) {
        toast(err.message || 'No se pudieron guardar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar cambios';
      }
    });
  }

  /* ---------- Panel: Documentación ---------- */
  async function panelDocs(exp, tr, docs, cont) {
    const porTipo = {};
    docs.forEach(d => { porTipo[d.tipo] = d; });

    // El bucket es privado: los enlaces se firman al pintar y caducan en 1 h.
    const enlaces = await GTApi.urlsDocumentos(docs);

    const aplicables = T.docsDe(tr, exp);
    const obligatorios = aplicables.filter(d => d.obligatorio);
    const recibidos = obligatorios.filter(d => porTipo[d.tipo]).length;
    const pct = obligatorios.length ? (recibidos / obligatorios.length * 100) : 100;

    cont.innerHTML = `
      <div class="card" style="max-width:860px">
        <div class="flex">
          <div class="card-t" style="margin:0">Checklist documental · ${h(tr.corto.toLowerCase())}</div>
          <div class="spacer"></div>
          <b style="font-size:.84rem">${recibidos} / ${obligatorios.length} obligatorios</b>
        </div>
        <div class="checklist-bar"><div class="checklist-fill" style="width:${pct}%"></div></div>

        ${aplicables.map(def => {
          const doc = porTipo[def.tipo];
          return `<div class="doc-row ${doc ? 'ok' : ''}">
            <div class="doc-ico">
              ${doc
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
                : svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}
            </div>
            <div class="doc-info">
              <strong>${h(def.label)} ${def.obligatorio ? '' : '<span class="t-muted" style="font-weight:400;font-size:.74rem">· opcional</span>'}</strong>
              <small>${doc ? h(doc.nombre_archivo) + ' · ' + Math.round((doc.tamano || 0) / 1024) + ' KB' : 'Sin archivo'}</small>
            </div>
            <div class="doc-actions">
              <span class="badge badge-${doc ? 'recibido' : 'pendiente'}">${doc ? 'Recibido' : 'Pendiente'}</span>
              ${doc ? `${enlaces[doc.id] ? `<a class="btn btn-ghost btn-sm" href="${h(enlaces[doc.id])}" target="_blank" rel="noopener">Ver</a>` : ''}
                       <button class="btn btn-danger btn-sm" data-del="${h(doc.id)}">Quitar</button>`
                    : `<label class="file-label">Subir<input type="file" accept="image/*,application/pdf" data-tipo="${h(def.tipo)}"></label>`}
            </div>
          </div>`;
        }).join('')}

        <p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
          Formatos admitidos: foto o escaneo (JPG, PNG) y PDF · máximo 10 MB por archivo.
          Se guardan en el bucket <b>privado</b> <span class="t-mono">gestotrafic-docs</span>: cada enlace
          se firma al abrirlo y caduca en 1 hora. Solo el gestor del expediente (o un administrador)
          puede firmarlo.
        </p>
      </div>`;

    cont.querySelectorAll('input[type="file"]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB', 'err'); inp.value = ''; return; }

        inp.closest('.file-label').innerHTML = '<span class="spinner"></span>';
        try {
          await GTApi.subirDocumento(exp.id, inp.dataset.tipo, file);
          const nuevos = await GTApi.listarDocumentos(exp.id);
          docs.length = 0; nuevos.forEach(d => docs.push(d));
          toast('Documento subido', 'ok');
        } catch (err) {
          toast(err.message || 'No se pudo subir', 'err');
        }
        panelDocs(exp, tr, docs, cont);
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
          panelDocs(exp, tr, docs, cont);
        } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      });
    });
  }

  /* ---------- Panel: documento generado ---------- */
  function panelGenera(exp, tr, cont) {
    const esContrato = tr.genera === 'contrato';
    const titulo = esContrato ? 'Contrato de compraventa pre-rellenado' : 'Comunicación de venta pre-rellenada';

    const faltan = [];
    if (esContrato) {
      if (!exp.vendedor_nombre) faltan.push('nombre del vendedor');
      if (!exp.vendedor_nif) faltan.push('DNI del vendedor');
      if (!exp.comprador_nombre) faltan.push('nombre del comprador');
      if (!exp.comprador_nif) faltan.push('DNI del comprador');
      if (!exp.precio_contrato) faltan.push('precio de contrato');
    } else {
      if (!exp.vendedor_nombre) faltan.push('nombre del vendedor');
      if (!exp.comprador_nombre) faltan.push('nombre del comprador');
      if (!exp.matricula) faltan.push('matrícula');
      if (!T.leer(exp, 'fecha_venta')) faltan.push('fecha de venta');
    }

    cont.innerHTML = `
      <div class="card" style="max-width:760px">
        <div class="card-t">${h(titulo)}</div>
        <p class="t-muted" style="font-size:.85rem;margin-top:0">
          Genera el documento con los datos del expediente <span class="t-mono">${h(exp.referencia)}</span>,
          listo para imprimir o guardar como PDF desde el navegador.
        </p>

        <dl class="dl" style="margin:18px 0">
          <dt>Vehículo</dt><dd>${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || '—')}</dd>
          <dt>Matrícula</dt><dd class="t-mono">${h(exp.matricula || '—')}</dd>
          <dt>Vendedor</dt><dd>${h(exp.vendedor_nombre || '—')}</dd>
          <dt>Comprador</dt><dd>${h(exp.comprador_nombre || '—')}</dd>
          ${esContrato
            ? `<dt>Precio</dt><dd>${eur(exp.precio_contrato)}</dd>`
            : `<dt>Fecha de venta</dt><dd>${fecha(T.leer(exp, 'fecha_venta'))}</dd>`}
        </dl>

        ${(esContrato && T.esVendedorEmpresa(exp)) ? `<div class="regul-note" style="margin-bottom:16px">
          ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
          <div>El vendedor es una <b>empresa</b>: la venta se documenta con <b>su factura</b>, no con un
            contrato de compraventa entre particulares. Adjunta la factura en <b>Documentación</b>.</div>
        </div>` : ''}

        ${faltan.length ? `<div class="regul-note" style="margin-bottom:16px">
          ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
          <div>El documento se generará con huecos en blanco. Faltan: <b>${h(faltan.join(', '))}</b>.</div>
        </div>` : ''}

        <div class="row-actions">
          <button class="btn" id="btn-generar">Generar ${esContrato ? 'contrato' : 'comunicación'}</button>
          <button class="btn btn-ghost" id="btn-generar-dl">Descargar .html</button>
        </div>

        <p class="t-muted" style="font-size:.76rem;margin-bottom:0;margin-top:16px">
          En la ventana del documento, usa <b>Imprimir → Guardar como PDF</b> para obtener el archivo firmable.
        </p>
      </div>`;

    cont.querySelector('#btn-generar').addEventListener('click', () => {
      const ok = esContrato ? GTContrato.abrir(exp) : GTContrato.abrirComunicacion(exp);
      if (!ok) { toast('El navegador bloqueó la ventana. Usa "Descargar .html"', 'err'); return; }
      toast('Documento generado', 'ok');
    });
    cont.querySelector('#btn-generar-dl').addEventListener('click', () => {
      esContrato ? GTContrato.descargar(exp) : GTContrato.descargarComunicacion(exp);
      toast('Documento descargado', 'ok');
    });
  }

  /* ============================================================
     VISTA · GEST-IA · alta por documentos
     ============================================================ */
  async function vistaGestIA(tipoPre) {
    if (!tipoPre) return vistaGestIAElegirTipo();

    const tr = T.tramite(tipoPre);
    loading('Preparando Gest-IA…');
    const clientes = await cargarClientes();
    const docs = T.docsDe(tr, {}).filter(d => d.tipo !== 'otros');

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <a href="#/gest-ia" class="t-muted" style="font-size:.8rem">← Cambiar tipo de trámite</a>
          <h1 style="margin-top:6px">${svg(ICO_IA, 'h1-ico')} Gest-IA · ${h(tr.nombre)}</h1>
          <p>Sube los documentos y Gest-IA monta el expediente pre-rellenado.</p>
        </div>
      </div>

      <div class="stack" style="max-width:900px">
        <div class="card">
          <div class="form-sec">Cliente (opcional)</div>
          <div class="field">
            <label for="f-cliente-ia">Cliente del expediente</label>
            <select id="f-cliente-ia" name="cliente_id">
              <option value="">— Lo asigno después —</option>
              ${clientes.map(c => `<option value="${h(c.id)}">${h(nombreCliente(c))} · ${h(c.nif)}</option>`).join('')}
            </select>
          </div>

          ${tr.calculo === 'itp' ? `
            <div class="form-sec">Fiscalidad</div>
            <div class="empresa-note">
              ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
              <div>El <b>valor BOE</b> no está en ningún documento: sale de la tabla de precios medios
                del Anexo I. Lo aporta el gestor. Con él, Gest-IA calcula el ITP en cuanto termina de leer.</div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="f-boe-ia">Valor BOE Anexo I (€)</label>
                <input type="number" step="0.01" min="0" id="f-boe-ia" name="valor_boe" placeholder="21000">
              </div>
              <div class="field">
                <label for="f-ccaa-ia">CCAA del comprador</label>
                <select id="f-ccaa-ia" name="ccaa">
                  ${window.GT_CCAA.map(c => `<option ${c === 'Comunidad de Madrid' ? 'selected' : ''}>${h(c)}</option>`).join('')}
                </select>
              </div>
            </div>` : ''}

          <div class="form-sec">Documentos del trámite</div>
          <p class="t-muted" style="font-size:.79rem;margin:0 0 14px">
            Sube los que tengas. Gest-IA lee foto o escaneo (JPG, PNG) y PDF, máximo 10 MB por archivo.
            Los que falten los rellena el gestor a mano.
          </p>

          <div id="ia-docs">
            ${docs.map(d => `
              <div class="doc-row" data-doc="${h(d.tipo)}">
                <div class="doc-ico">${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}</div>
                <div class="doc-info">
                  <strong>${h(d.label)} ${d.obligatorio ? '' : '<span class="t-muted" style="font-weight:400;font-size:.74rem">· opcional</span>'}</strong>
                  <small data-nombre>Sin archivo</small>
                </div>
                <div class="doc-actions">
                  <label class="file-label">Elegir<input type="file" accept="image/*,application/pdf" data-tipo="${h(d.tipo)}"></label>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="regul-note">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div><b>Gest-IA propone, el gestor dispone.</b> El expediente nace en
            <b>pendiente de validación</b>: nada avanza hasta que revises los datos y los confirmes.
            Los campos que la IA no haya leído con claridad quedan vacíos y resaltados.</div>
        </div>

        <div class="flex">
          <button class="btn" id="btn-ia" disabled>${svg(ICO_IA)} Analizar con Gest-IA</button>
          <a href="#/expedientes" class="btn btn-ghost">Cancelar</a>
          <div class="spacer"></div>
          <span class="t-muted" style="font-size:.78rem" id="ia-cuenta">0 documentos</span>
        </div>
      </div>
      ${footer()}`;

    /* Los archivos se retienen en memoria: el expediente aún no existe y sin
       expediente el bucket rechaza la subida (la política comprueba propiedad). */
    const elegidos = {};
    const btn = view.querySelector('#btn-ia');
    const cuenta = view.querySelector('#ia-cuenta');

    const refrescar = () => {
      const n = Object.keys(elegidos).length;
      cuenta.textContent = n + ' documento' + (n === 1 ? '' : 's');
      btn.disabled = n === 0;
    };

    view.querySelectorAll('#ia-docs input[type="file"]').forEach(inp => {
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        const fila = inp.closest('.doc-row');
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB', 'err'); inp.value = ''; return; }
        elegidos[inp.dataset.tipo] = f;
        fila.classList.add('ok');
        fila.querySelector('[data-nombre]').textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' KB';
        refrescar();
      });
    });

    btn.addEventListener('click', () => lanzarGestIA(tr, elegidos, {
      cliente_id: val(view, 'cliente_id'),
      valor_boe: view.querySelector('#f-boe-ia') ? num(view, 'valor_boe') : null,
      ccaa: view.querySelector('#f-ccaa-ia') ? val(view, 'ccaa') : null
    }));
  }

  function vistaGestIAElegirTipo() {
    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <h1>${svg(ICO_IA, 'h1-ico')} Alta con Gest-IA</h1>
          <p>Elige el trámite, sube sus documentos y la IA monta el expediente. Tú lo validas.</p>
        </div>
      </div>

      <div class="tipo-grid">
        ${window.GT_TRAMITES.map(tr => `
          <button type="button" class="tipo-card" data-tipo="${h(tr.id)}">
            <div class="tipo-card-ico">${svg(tr.icono)}</div>
            <div class="tipo-card-txt">
              <strong>${h(tr.nombre)}</strong>
              <small>${h(tr.descripcion)}</small>
              <div class="tipo-card-tags">
                <span class="tag">${T.docsDe(tr, {}).filter(d => d.obligatorio).length} docs</span>
                ${tr.calculo === 'itp' ? '<span class="tag calc">Calcula ITP</span>' : ''}
              </div>
            </div>
          </button>`).join('')}
      </div>

      <div style="margin-top:20px">${avisoRegulado()}</div>
      ${footer()}`;

    view.querySelectorAll('[data-tipo]').forEach(b =>
      b.addEventListener('click', () => (location.hash = '#/gest-ia?tipo=' + b.dataset.tipo)));
  }

  /** Crear expediente → subir → leer con IA → volcar propuestas → calcular ITP. */
  async function lanzarGestIA(tr, archivos, extra) {
    const tipos = Object.keys(archivos);
    const pasos = [
      'Creando el expediente…',
      'Subiendo ' + tipos.length + ' documento' + (tipos.length === 1 ? '' : 's') + '…',
      'Gest-IA está leyendo los documentos…',
      'Montando el expediente…'
    ];

    view.innerHTML = `${cabecera()}
      <div class="ia-progreso">
        <div class="ia-progreso-ico">${svg(ICO_IA)}</div>
        <h2>Gest-IA está trabajando</h2>
        <p id="ia-paso">${h(pasos[0])}</p>
        <div class="checklist-bar"><div class="checklist-fill" id="ia-barra" style="width:8%"></div></div>
        <small class="t-muted">Leer varios documentos puede tardar cerca de un minuto.</small>
      </div>`;

    const paso = (i) => {
      view.querySelector('#ia-paso').textContent = pasos[i];
      view.querySelector('#ia-barra').style.width = ((i + 1) / pasos.length * 100) + '%';
    };

    let exp = null;
    try {
      // 1 · El expediente primero: sin él, la política del bucket rechaza la subida.
      // El valor BOE y la CCAA no salen de ningún documento: los aporta el
      // gestor en el paso anterior, así que entran ya con el expediente.
      exp = await GTApi.crearExpediente({
        tipo_tramite: tr.id,
        estado: 'documentacion',
        cliente_id: extra.cliente_id || null,
        valor_boe: extra.valor_boe || null,
        ccaa: extra.ccaa || null,
        ia_estado: 'pendiente_validacion',
        datos: {}
      });

      paso(1);
      const subidos = [];
      for (const tipo of tipos) {
        const archivo = await GTApi.subirArchivo(exp.id, tipo, archivos[tipo]);
        await GTApi.registrarDocumento(exp.id, tipo, archivo);
        subidos.push({ tipo: tipo, storage_path: archivo.path });
      }

      paso(2);
      const lectura = await GTApi.analizarDocumentos(exp.id, subidos);

      paso(3);
      const props = GTGestIA.propuestas(tr, lectura.documentos);
      const cambios = GTGestIA.aExpediente(tr, props, {});
      // Lo que ya aportó el gestor no cuenta como hueco de la IA.
      const yaPuestos = { valor_boe: extra.valor_boe, ccaa: extra.ccaa };
      cambios.ia_extraccion = {
        propuestas: props,
        documentos: lectura.documentos,
        huecos: GTGestIA.huecos(tr, props).filter(x => !yaPuestos[x.campo]),
        analizado_at: new Date().toISOString()
      };
      cambios.ia_modelo = lectura.modelo;
      await GTApi.actualizarExpediente(exp.id, cambios);

      // 4 · ITP, si el trámite lo lleva y hay con qué calcularlo.
      if (tr.calculo === 'itp' && extra.valor_boe && cambios.fecha_matriculacion) {
        try {
          const r = await GTApi.calcularITP({
            valor_boe: extra.valor_boe,
            precio_contrato: cambios.precio_contrato || null,
            fecha_matriculacion: cambios.fecha_matriculacion,
            fecha_transmision: new Date().toISOString().slice(0, 10),
            ccaa: extra.ccaa || 'Comunidad de Madrid',
            cilindrada: cambios.cilindrada || null,
            cvf: cambios.cvf || null,
            etiqueta_dgt: cambios.etiqueta_dgt || '',
            uso_especial: false,
            tipo_vehiculo: 'coche'
          });
          await GTApi.actualizarExpediente(exp.id, {
            valor_venal: r.valor_venal, base_imponible: r.base_imponible,
            itp_importe: r.itp, tasa_dgt: r.tasa_dgt, total_impuestos: r.total_impuestos,
            calculo_json: r, calculado_at: new Date().toISOString()
          });
        } catch (e) {
          console.warn('Gest-IA: no se pudo calcular el ITP', e);
        }
      }

      toast('Gest-IA montó ' + exp.referencia + ' · pendiente de validación', 'ok');
      location.hash = '#/expedientes/' + exp.id;

    } catch (err) {
      view.innerHTML = `${cabecera()}
        <div class="empty">
          <p style="color:var(--danger)">Gest-IA no pudo completar el alta.</p>
          <p class="t-muted" style="font-size:.82rem">${h(err.message || err)}</p>
          ${exp ? `<p class="t-muted" style="font-size:.82rem">El expediente <b>${h(exp.referencia)}</b> se creó
            con los documentos que sí subieron: puedes completarlo a mano.</p>
            <a class="btn" href="#/expedientes/${h(exp.id)}">Abrir el expediente</a>`
          : '<a class="btn btn-ghost" href="#/gest-ia">Volver a intentarlo</a>'}
        </div>`;
    }
  }

  /* ============================================================
     VISTA · GESTORES (solo admin)
     ============================================================ */
  async function vistaGestores() {
    if (!GTAuth.isAdmin()) { location.hash = '#/dashboard'; return; }

    loading('Cargando gestores…');
    const [usuarios, expedientes] = await Promise.all([
      GTApi.listarUsuarios(),
      GTApi.listarExpedientes()
    ]);

    const carga = {};
    expedientes.forEach(e => { if (e.gestor_id) carga[e.gestor_id] = (carga[e.gestor_id] || 0) + 1; });

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <h1>Gestores</h1>
          <p>${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'} · cada gestor solo ve sus expedientes</p>
        </div>
        <button class="btn" id="btn-nuevo-gestor">+ Nuevo gestor</button>
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Expedientes</th><th>Estado</th><th></th></tr></thead>
        <tbody>${usuarios.map(u => `
          <tr>
            <td><b>${h(u.nombre)}</b></td>
            <td class="t-mono">${h(u.usuario)}</td>
            <td><span class="badge badge-${u.rol === 'admin' ? 'admin' : 'gestor'}">${u.rol === 'admin' ? 'Administrador' : 'Gestor'}</span></td>
            <td class="t-num">${carga[u.id] || 0}</td>
            <td><span class="badge badge-${u.activo ? 'recibido' : 'pendiente'}">${u.activo ? 'Activo' : 'Desactivado'}</span></td>
            <td>
              <div class="row-actions" style="justify-content:flex-end">
                <button class="btn btn-ghost btn-sm" data-clave="${h(u.id)}" data-nombre="${h(u.nombre)}">Contraseña</button>
                ${u.id === session.id
                  ? '<span class="t-muted" style="font-size:.74rem;padding:0 6px">tu cuenta</span>'
                  : `<button class="btn ${u.activo ? 'btn-danger' : ''} btn-sm" data-activo="${h(u.id)}" data-valor="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}
              </div>
            </td>
          </tr>`).join('')}</tbody></table></div>

      <div class="regul-note" style="margin-top:18px">
        ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
        <div>El aislamiento entre gestores lo impone <b>el servidor</b> (RLS sobre
          <span class="t-mono">gestotrafic_expedientes</span>), no la interfaz: un gestor no puede
          leer ni modificar expedientes de otro aunque manipule el navegador. Las contraseñas se
          guardan con <b>bcrypt</b> y nunca salen de la base de datos.</div>
      </div>
      ${footer()}`;

    view.querySelector('#btn-nuevo-gestor').addEventListener('click', modalNuevoGestor);

    view.querySelectorAll('[data-activo]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await GTApi.cambiarActivo(b.dataset.activo, b.dataset.valor === '1');
        toast(b.dataset.valor === '1' ? 'Gestor activado' : 'Gestor desactivado', 'ok');
        vistaGestores();
      } catch (err) { toast(err.message, 'err'); b.disabled = false; }
    }));

    view.querySelectorAll('[data-clave]').forEach(b => b.addEventListener('click', () => {
      modal({
        titulo: 'Cambiar contraseña',
        cuerpo: `<p class="t-muted" style="margin-top:0;font-size:.85rem">Nueva contraseña para <b>${h(b.dataset.nombre)}</b>.</p>
          <div class="field"><label>Contraseña *</label><input name="password" type="password" placeholder="Mínimo 4 caracteres" required></div>`,
        okTexto: 'Cambiar',
        onOk: async (root) => {
          const pw = val(root, 'password');
          if (!pw || pw.length < 4) { toast('La contraseña es demasiado corta', 'err'); return false; }
          await GTApi.cambiarClave(b.dataset.clave, pw);
          toast('Contraseña actualizada', 'ok');
        }
      });
    }));
  }

  function modalNuevoGestor() {
    modal({
      titulo: 'Nuevo gestor',
      cuerpo: `
        <div class="form-grid">
          <div class="field"><label>Nombre y apellidos *</label><input name="nombre" placeholder="Elena Ruiz Vidal" required></div>
          <div class="field"><label>Usuario de acceso *</label><input name="usuario" placeholder="elena" required></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Contraseña *</label><input name="password" type="password" placeholder="Mínimo 4 caracteres" required></div>
          <div class="field">
            <label for="f-rol-gestor">Rol</label>
            <select name="rol" id="f-rol-gestor">
              <option value="gestor">Gestor · solo sus expedientes</option>
              <option value="admin">Administrador · ve todos</option>
            </select>
          </div>
        </div>
        <div class="empresa-note" style="margin:14px 0 0">
          ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
          <div>La contraseña se cifra con <b>bcrypt</b> en el servidor. Ni se guarda en claro
            ni vuelve nunca al navegador.</div>
        </div>`,
      okTexto: 'Crear gestor',
      onOk: async (root) => {
        const nombre = val(root, 'nombre');
        const usuario = val(root, 'usuario');
        const password = val(root, 'password');
        if (!nombre) { toast('El nombre es obligatorio', 'err'); return false; }
        if (!usuario) { toast('El usuario es obligatorio', 'err'); return false; }
        if (!password || password.length < 4) { toast('La contraseña es demasiado corta', 'err'); return false; }

        await GTApi.crearGestor({ nombre, usuario, password, rol: val(root, 'rol') });
        toast('Gestor creado: ' + usuario, 'ok');
        vistaGestores();
      }
    });
  }

  /* ============================================================
     VISTA · KANBAN
     ============================================================ */
  async function vistaKanban() {
    loading('Cargando tablero…');
    const todos = await GTApi.listarExpedientes();
    const tactil = window.matchMedia('(pointer: coarse)').matches;
    const expedientes = filtroTipo === 'todos' ? todos : todos.filter(e => e.tipo_tramite === filtroTipo);

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div><h1>Tablero de expedientes</h1><p>${ambito()} · arrastra las tarjetas para cambiar el estado</p></div>
        <button class="btn" id="btn-nuevo-exp">+ Nuevo expediente</button>
      </div>

      <div class="filtro-bar">
        <span class="t-muted" style="font-size:.78rem">Filtrar por trámite</span>
        <select id="filtro-tipo">
          <option value="todos">Todos los trámites (${todos.length})</option>
          ${window.GT_TRAMITES.map(tr => {
            const n = todos.filter(e => e.tipo_tramite === tr.id).length;
            return `<option value="${h(tr.id)}" ${filtroTipo === tr.id ? 'selected' : ''}>${h(tr.nombre)} (${n})</option>`;
          }).join('')}
        </select>
      </div>

      <div class="kan-kpis" id="kan-kpis" aria-label="Expedientes por estado">
        ${window.GT_ESTADOS.map(est => `
          <div class="kan-kpi" style="--c:${est.color}">
            <span class="kan-kpi-lbl">${h(est.label)}</span>
            <b class="kan-kpi-num" data-kpi="${h(est.id)}">${expedientes.filter(e => e.estado === est.id).length}</b>
          </div>`).join('')}
      </div>

      <div class="kanban" id="kanban">
        ${window.GT_ESTADOS.map(est => {
          const items = expedientes.filter(e => e.estado === est.id);
          return `<div class="kan-col" data-estado="${h(est.id)}">
            <div class="kan-col-head">
              <span style="color:${est.color}">${h(est.label)}</span>
              <span class="kan-count" style="--c:${est.color}">${items.length}</span>
            </div>
            <div class="kan-list" data-lista="${h(est.id)}">
              ${items.map(e => tarjetaKanban(e, tactil)).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${footer()}`;

    view.querySelector('#btn-nuevo-exp').addEventListener('click', () => (location.hash = '#/expedientes/nuevo'));
    view.querySelector('#filtro-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; vistaKanban(); });
    activarDragDrop(view.querySelector('#kanban'));
  }

  function tarjetaKanban(e, tactil) {
    const tr = T.tramite(e.tipo_tramite);
    return `<div class="kan-card ${ES_PROPUESTA_IA(e) ? 'ia-pendiente' : ''}" draggable="true" data-id="${h(e.id)}">
      <div class="kan-card-ref">${h(e.referencia)}${ES_PROPUESTA_IA(e) ? ' <span class="badge badge-ia">IA</span>' : ''}</div>
      <div class="kan-card-title">${h([e.marca, e.modelo].filter(Boolean).join(' ') || tr.nombre)}</div>
      <div class="kan-card-meta">${h(e.matricula || '—')} · ${h(nombreCliente(e.cliente))}</div>
      <div class="kan-card-foot">
        <span class="badge badge-tramite" style="font-size:.62rem">${h(tr.corto)}</span>
        ${tr.calculo === 'itp' && T.esExentoITP(e)
          ? '<span class="badge badge-exento" style="font-size:.62rem">Exento</span>'
          : (tr.calculo === 'itp' && e.total_impuestos != null
              ? `<b>${eur(e.total_impuestos)}</b>`
              : `<span class="t-muted">${fecha(e.created_at)}</span>`)}
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

  /** Mantiene en sincronía el contador de cada columna y la tira de KPIs. */
  function recontar(kanban) {
    kanban.querySelectorAll('.kan-col').forEach(col => {
      const n = col.querySelectorAll('.kan-card').length;
      col.querySelector('.kan-count').textContent = n;
      const kpi = document.querySelector(`.kan-kpi-num[data-kpi="${col.dataset.estado}"]`);
      if (kpi) kpi.textContent = n;
    });
  }

  /* ============================================================
     Cabecera móvil + router
     ============================================================ */
  function cabecera() {
    return `<button class="menu-toggle" id="menu-toggle" aria-label="Abrir menú" style="margin-bottom:14px">
      ${svg('<path d="M3 6h18M3 12h18M3 18h18"/>')}
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
    const params = new URLSearchParams(query || '');

    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === seccion));
    sidebar.classList.remove('open');
    document.querySelectorAll('.sidebar-backdrop').forEach(b => b.remove());
    window.scrollTo(0, 0);

    try {
      if (seccion === 'clientes') {
        partes[1] ? await vistaCliente(partes[1]) : await vistaClientes();
      } else if (seccion === 'expedientes') {
        if (partes[1] === 'nuevo') {
          await vistaNuevoExpediente(params.get('cliente'), params.get('tipo'));
        } else if (partes[1]) {
          await vistaExpediente(partes[1]);
        } else {
          await vistaExpedientes();
        }
      } else if (seccion === 'kanban') {
        await vistaKanban();
      } else if (seccion === 'gest-ia') {
        await vistaGestIA(params.get('tipo'));
      } else if (seccion === 'gestores') {
        await vistaGestores();
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
  (async function arrancar() {
    session = GTAuth.requireSession();
    if (!session) return;

    document.getElementById('user-avatar').textContent = session.iniciales;
    document.getElementById('user-nombre').textContent = session.nombre;
    document.getElementById('user-rol').textContent = session.rol === 'admin' ? 'Administrador' : 'Gestor';
    document.getElementById('logout').addEventListener('click', () => {
      GTAuth.logout();
      location.replace('index.html');
    });

    // "Gestores" solo existe para el admin. Ocultarlo es cosmético: la
    // vista se corta sola y el RLS no deja tocar usuarios a un gestor.
    if (GTAuth.isAdmin()) document.getElementById('nav-gestores').classList.remove('hidden');

    // Sin esperar a que la sesión entre en el cliente, la primera consulta
    // saldría como anon y el RLS la devolvería vacía.
    try {
      await GTApi.listo;
    } catch (e) {
      GTAuth.logout();
      location.replace('index.html');
      return;
    }

    window.addEventListener('hashchange', router);
    router();
  })();
})();
