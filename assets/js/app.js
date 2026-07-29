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

  /* `peligro` pinta de rojo el botón de confirmar. En un diálogo destructivo,
     que el botón de aceptar sea idéntico al de guardar un cambio cualquiera
     es media confirmación de menos. */
  function modal({ titulo, cuerpo, okTexto = 'Guardar', onOk, ancho, peligro }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" ${ancho ? `style="max-width:${ancho}px"` : ''} role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${h(titulo)}</h3><button class="x-btn" data-cerrar aria-label="Cerrar">×</button></div>
      <div class="modal-body">${cuerpo}</div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cerrar>Cancelar</button>
        <button class="btn ${peligro ? 'btn-danger' : ''}" data-ok>${h(okTexto)}</button>
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
     necesitan elegir una empresa vendedora.

     `fichas` es la lista COMPLETA. La exportación a OEGAM la necesita: el
     municipio, el CP y la provincia de cada parte están en columnas propias
     de la ficha del cliente, y del domicilio en texto libre del expediente
     no se deducen. Se cruza por NIF exacto, nunca por parecido de nombre. */
  let empresas = [];
  let fichas = [];

  async function cargarClientes() {
    const clientes = await GTApi.listarClientes();
    fichas = clientes;
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
      ${c.soloSi ? `data-solo-si="${h(c.soloSi.campo)}" data-solo-si-val="${h(c.soloSi.valor)}"
        ${c.soloSi.no ? 'data-solo-si-no="1"' : ''}` : ''}
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

      /* Un campo OCULTO no se guarda: se vacía. Si el gestor rellena el sexo
         y la fecha de nacimiento de un particular y luego marca esa parte
         como empresa, esos campos desaparecen del formulario —una razón
         social no tiene ni lo uno ni lo otro—, pero su valor seguiría en el
         DOM y acabaría en el XML colgando de una empresa. */
      const campo = root.querySelector(`[data-campo="${c.n}"]`);
      if (campo && campo.classList.contains('hidden')) v = null;

      if (c.col) fila[c.n] = v; else datos[c.n] = v;
    });
    fila.datos = datos;
    return fila;
  }

  /* ------------------------------------------------------------
     Partes particular / empresa (vendedor y comprador)
     El tipo de cada parte cambia dos cosas en el formulario: la etiqueta
     de sus campos de identidad (DNI / NIF → CIF) y, en el vendedor, que
     sus datos se vuelquen de la ficha de cliente en vez de escribirse a
     mano. La tercera —qué documento pide el checklist— la resuelve el
     catálogo con los `si` de cada documento.
     ------------------------------------------------------------ */

  /** `vendedor_nif` → `vendedor`. */
  const parteDeCampo = (n) => (n.indexOf('_') === -1 ? null : n.slice(0, n.indexOf('_')));

  /* ------------------------------------------------------------
     Visibilidad condicional (`soloSi`)
     ------------------------------------------------------------
     Vive aparte de las partes vendedor/comprador a propósito. Antes iba
     dentro de su sincronización, y eso ataba TODO campo condicional al
     selector de tipo de parte: un `soloSi` que dependiera de otra cosa
     —el cambio de servicio depende de su propio toggle— no se
     actualizaba nunca, se quedaba oculto y, como un campo oculto no se
     guarda, se borraba al guardar.
     ------------------------------------------------------------ */

  /** Muestra u oculta cada campo condicional según su dependencia. */
  function pintarVisibilidad(root) {
    /* `data-solo-si-no` invierte la condición: el campo se ve mientras el
       otro NO valga eso. Es lo que oculta sexo, nacimiento y caducidad
       cuando la parte es una empresa. Sin dependencia a la vista se
       muestra el campo: es lo que hace la pestaña de exportación, que no
       tiene el selector de tipo de parte y los enseña todos. */
    root.querySelectorAll('[data-solo-si]').forEach(f => {
      const dep = root.querySelector(`[name="${f.dataset.soloSi}"]`);
      const igual = !!dep && dep.value === f.dataset.soloSiVal;
      f.classList.toggle('hidden', f.dataset.soloSiNo ? igual : !igual);
    });
  }

  /** Engancha la visibilidad a TODO campo del que dependa alguien. */
  function activarVisibilidad(root) {
    const deps = new Set();
    root.querySelectorAll('[data-solo-si]').forEach(f => deps.add(f.dataset.soloSi));
    deps.forEach(nombre => {
      const el = root.querySelector(`[name="${nombre}"]`);
      if (el) el.addEventListener('change', () => pintarVisibilidad(root));
    });
    pintarVisibilidad(root);       // al pintar no se pisa lo ya guardado
  }

  function activarTipoParte(root) {
    /* La visibilidad condicional va PRIMERO y por su cuenta: hay campos con
       `soloSi` que no dependen de una parte —el cambio de servicio depende
       de su propio toggle—, y atarla al selector de vendedor/comprador
       dejaba esos ocultos para siempre. Ocultos y, desde que un campo
       oculto no se guarda, borrados al guardar. */
    activarVisibilidad(root);

    const selTipo = {};
    T.PARTES.forEach(p => {
      const sel = root.querySelector(`[name="${p}_tipo"]`);
      if (sel) selTipo[p] = sel;
    });
    if (!Object.keys(selTipo).length) return;   // trámite sin partes configurables

    const selEmpresa = root.querySelector('[name="vendedor_empresa_id"]');
    const esEmpresa = (parte) => !!selTipo[parte] && selTipo[parte].value === 'empresa';

    const set = (n, v) => { const el = root.querySelector(`[name="${n}"]`); if (el) el.value = v || ''; };

    /* Solo el vendedor se vuelca: es la única parte con selector de empresa
       del CRM. El comprador se escribe o se copia del cliente. */
    function volcar() {
      const c = empresas.find(e => e.id === (selEmpresa && selEmpresa.value));
      if (!c) return;
      set('vendedor_nombre', c.razon_social || c.nombre);
      set('vendedor_nif', c.nif);
      set('vendedor_direccion', [c.direccion, c.cp, c.ciudad].filter(Boolean).join(', '));
      set('vendedor_telefono', c.telefono);
    }

    function sincronizar(volcarAhora) {
      pintarVisibilidad(root);

      // Cada campo sigue al tipo de SU parte, no al del vendedor.
      root.querySelectorAll('[data-campo]').forEach(f => {
        const parte = parteDeCampo(f.dataset.campo || '');
        if (!parte || !selTipo[parte]) return;
        const empresa = esEmpresa(parte);

        const lbl = f.querySelector('label');
        if (lbl && lbl.dataset.lSi) {
          lbl.textContent = (empresa ? lbl.dataset.lSi : lbl.dataset.l)
            + (f.querySelector('[required]') ? ' *' : '');
        }

        // Bloquear solo lo que rellena la aplicación: lo demás se escribe.
        if (f.dataset.autoSi === 'empresa') {
          const input = f.querySelector('input');
          if (input) input.readOnly = empresa;
          f.classList.toggle('is-auto', empresa);
        }
      });

      const nota = root.querySelector('[data-nota-empresa]');
      if (nota) nota.classList.toggle('hidden', !esEmpresa('vendedor'));

      if (volcarAhora && esEmpresa('vendedor')) volcar();
    }

    Object.keys(selTipo).forEach(p =>
      selTipo[p].addEventListener('change', () => sincronizar(true)));
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
  let termino = '';          // término de búsqueda vigente en la vista

  /* Misma normalización que `gestotrafic_normalizar_busqueda` en el servidor.
     Aquí solo decide cuándo merece la pena consultar; quien busca de verdad
     —y quien aplica el RLS— es el servidor. */
  const normalizarBusqueda = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function vistaExpedientes(q) {
    // `#/expedientes?q=4821NBH` deja la búsqueda enlazable y compartible.
    if (q !== undefined && q !== null) termino = q;
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

      <div class="buscador-exp">
        ${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 'lupa')}
        <input id="busca-exp" type="search" autocomplete="off" value="${h(termino)}"
               placeholder="Buscar por matrícula o DNI/NIF…  ·  4821 NBH · 71640935D">
        <button class="btn-limpiar hidden" id="limpia-busca" title="Limpiar búsqueda"
                aria-label="Limpiar búsqueda">${svg('<path d="M18 6L6 18M6 6l12 12"/>')}</button>
      </div>

      <div class="filtro-bar" data-filtro-bar>
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

    /* ---- Búsqueda por matrícula o documento ----
       La consulta la resuelve el servidor (`gestotrafic_buscar_expedientes`),
       que normaliza el término y deja el filtrado por gestor al RLS. Aquí no
       se filtra nada: si se buscara en la lista ya cargada, solo se
       encontraría lo que cupo en la primera página. */
    const input   = view.querySelector('#busca-exp');
    const limpiar = view.querySelector('#limpia-busca');
    const barra   = view.querySelector('[data-filtro-bar]');
    let peticion  = 0;
    let tecleo    = null;

    async function buscar(q) {
      termino = q;
      limpiar.classList.toggle('hidden', !q);
      barra.classList.toggle('hidden', !!q);

      if (!q) return pintar();
      if (normalizarBusqueda(q).length < 3) {
        view.querySelector('#lista-exp').innerHTML =
          `<div class="empty"><p class="t-muted">Escribe al menos 3 caracteres.</p></div>`;
        view.querySelector('#cuenta-exp').textContent = 'buscando…';
        return;
      }

      const mio = ++peticion;
      try {
        const res = await GTApi.buscarExpedientes(q);
        if (mio !== peticion) return;      // llegó una respuesta más nueva
        pintarBusqueda(res, q);
      } catch (err) {
        if (mio !== peticion) return;
        view.querySelector('#lista-exp').innerHTML =
          `<div class="empty"><p style="color:var(--danger)">${h(err.message || 'No se pudo buscar')}</p></div>`;
      }
    }

    function pintarBusqueda(res, q) {
      const cont = view.querySelector('#lista-exp');
      view.querySelector('#cuenta-exp').textContent =
        `${res.length} resultado${res.length === 1 ? '' : 's'} para «${q}»`;

      cont.innerHTML = res.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Referencia</th><th>Matrícula</th><th>Cliente</th><th>Trámite</th><th>Vehículo</th><th>Estado</th><th>Coincide en</th></tr></thead>
        <tbody>${res.map(e => `
          <tr class="clickable" data-exp="${h(e.id)}">
            <td class="t-mono">${h(e.referencia)}</td>
            <td class="t-mono"><b>${h(e.matricula || '—')}</b></td>
            <td>${h(e.cliente || '— sin cliente —')}</td>
            <td><span class="badge badge-tramite">${h(T.tramite(e.tipo_tramite).corto)}</span></td>
            <td>${h([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}</td>
            <td><span class="badge badge-${h(e.estado)}">${h(estadoInfo(e.estado).label)}</span></td>
            <td class="t-muted" style="font-size:.76rem">${e.coincide_en === 'matricula' ? 'matrícula' : 'documento'}</td>
          </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">
            ${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}
            <p>Ningún expediente <b>tuyo</b> con «${h(q)}».</p>
            <p class="t-muted" style="font-size:.82rem">Se busca por matrícula y por DNI/NIF/CIF.
              Da igual cómo escribas los espacios o los guiones.</p>
          </div>`;

      cont.querySelectorAll('[data-exp]').forEach(tr =>
        tr.addEventListener('click', () => (location.hash = '#/expedientes/' + tr.dataset.exp)));
    }

    input.addEventListener('input', () => {
      clearTimeout(tecleo);
      tecleo = setTimeout(() => buscar(input.value.trim()), 300);
    });
    limpiar.addEventListener('click', () => { input.value = ''; buscar(''); input.focus(); });

    if (termino) buscar(termino); else pintar();
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
    activarTipoParte(form);

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

  /* ------------------------------------------------------------
     El ITP calculado, fijo en la ficha
     ------------------------------------------------------------
     El importe se guarda desde que se calcula (columnas `valor_venal`,
     `itp_importe`, `tasa_dgt`, `total_impuestos` + el `calculo_json` íntegro
     del motor). Lo que faltaba era verlo sin entrar en la calculadora: un
     expediente en tramitación tiene que enseñar lo que se liquida.

     ⛔ ANTI-INVENCIÓN · la prueba de que hay cálculo es `calculo_json`, que es
     la respuesta literal del motor. NO vale mirar `itp_importe`: el toggle de
     exención lo pone a 0 sin haber calculado nada, y un «0,00 €» con pinta de
     cifra buena es justo lo que no puede aparecer en una ficha. Sin cálculo se
     dice que falta calcularlo, que es un hueco que se ve. */
  const itpCalculado = (exp) => !!(exp && exp.calculo_json);

  /* ---------- Cambio de servicio · el aviso, fijo en la ficha ----------
     Va fuera de las pestañas y encima de todo porque decide si el
     expediente se puede tramitar: enterarse al pulsar «tramitación» es
     tarde, y enterarse en la ventanilla de la DGT, peor. */
  function fichaServicio(exp, tr) {
    if (!tr || tr.exporta !== 'oegam') return '';
    const r = GTServicio.evaluar(exp);
    if (!r.cambia) return '';                 // sin cambio no hay nada que decir

    const ico = r.bloqueado
      ? '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
      : '<path d="M20 6 9 17l-5-5"/>';

    return `<div class="srv-aviso ${r.bloqueado ? 'bloqueado' : 'ok'}">
      ${svg(ico)}
      <div>
        <b>${r.bloqueado ? 'Tramitación bloqueada · cambio de clasificación en la ITV' : 'Cambio de servicio registrado'}</b>
        <p>${h(r.aviso || '')}</p>
        ${r.bloqueado ? `<p class="srv-salida">Se desbloquea cuando la <b>ficha técnica</b>
          muestre el código de destino —Gest-IA lo lee al subirla, o lo escribes en
          <b>Datos del expediente</b>— o cuando marques ahí que la ITV ya lo ha hecho.</p>` : ''}
      </div>
    </div>`;
  }

  /** La tira de importes de la ficha, o el aviso de que falta calcular. */
  function fichaITP(exp, tr) {
    if (!tr || tr.calculo !== 'itp') return '';

    if (!itpCalculado(exp)) {
      return `<div class="itp-ficha vacia">
        ${svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>')}
        <div><b>ITP sin calcular.</b> El expediente no lleva importe todavía:
          calcúlalo en <b>Calculadora ITP</b>. No se rellena a ojo.</div>
      </div>`;
    }

    const exento = T.esExentoITP(exp);
    const celda = (valor, etiqueta, clase) => `
      <div class="itp-cell ${clase || ''}">
        <div class="itp-cell-num">${valor}</div>
        <div class="itp-cell-lbl">${h(etiqueta)}</div>
      </div>`;

    return `<div class="itp-ficha">
      <div class="itp-out" style="margin:0">
        ${celda(exp.valor_venal != null ? eur(exp.valor_venal) : '—', 'Valor venal')}
        ${celda(exento ? '<span class="itp-exento">Exento</span>'
          : (exp.itp_importe != null ? eur(exp.itp_importe) : '—'), 'ITP', exento ? 'exento' : '')}
        ${celda(exp.tasa_dgt != null ? eur(exp.tasa_dgt) : '—', 'Tasa DGT')}
        ${celda(exp.total_impuestos != null ? eur(exp.total_impuestos) : '—', 'Total', 'total')}
      </div>
      <p class="itp-ficha-pie">
        Calculado con el motor <span class="t-mono">gestotrafic-itp</span>
        ${exp.calculado_at ? '· ' + h(fecha(exp.calculado_at)) : ''}
        ${exento ? '· <b>exención confirmada por el gestor</b>: el ITP queda en 0 y solo se liquida la tasa DGT' : ''}
        · el mismo importe va al expediente completo.
      </p>
    </div>`;
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
    /* Junto al ITP, pero aparte: lo que se liquida a Hacienda y lo que se le
       cobra al cliente son cuentas distintas y mezclarlas es lo que acaba
       metiendo la tasa DGT en la base del IVA. */
    if (tr.calculo === 'itp') pestanas.push({ id: 'honorarios', label: 'Honorarios y total' });
    pestanas.push({ id: 'datos', label: 'Datos del expediente' });
    pestanas.push({ id: 'docs', label: 'Documentación' });
    if (tr.genera === 'contrato') pestanas.push({ id: 'genera', label: 'Contrato' });
    if (tr.genera === 'comunicacion') pestanas.push({ id: 'genera', label: 'Comunicación' });
    if (tr.exporta === 'oegam') pestanas.push({ id: 'oegam', label: 'Exportar a OEGAM' });

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
          ${puedeBorrar(exp) ? `<button class="btn btn-danger btn-sm" id="btn-borrar-exp">Eliminar</button>` : ''}
        </div>
      </div>

      ${bannerGestIA(exp)}

      <div id="slot-servicio">${fichaServicio(exp, tr)}</div>

      <div id="slot-itp">${fichaITP(exp, tr)}</div>

      <div class="tabs" id="tabs">
        ${pestanas.map((p, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${p.id}">${h(p.label)}</button>`).join('')}
      </div>

      <div id="tab-content"></div>
      ${footer()}`;

    activarBannerGestIA(exp, tr);

    /* La tira vive fuera de las pestañas, así que hay que repintarla cuando el
       cálculo cambia: al calcular y al marcar o retirar la exención. */
    const pintarFichaITP = () => {
      const slot = view.querySelector('#slot-itp');
      if (slot) slot.innerHTML = fichaITP(exp, tr);
    };

    const pintarFichaServicio = () => {
      const slot = view.querySelector('#slot-servicio');
      if (slot) slot.innerHTML = fichaServicio(exp, tr);
    };

    const cont = view.querySelector('#tab-content');
    const paneles = {
      itp: () => panelITP(exp, cont, pintarFichaITP),
      honorarios: () => panelHonorarios(exp, cont, pintarFichaITP),
      datos: () => panelDatos(exp, tr, cont, pintarFichaServicio),
      docs: () => panelDocs(exp, tr, docs, cont),
      genera: () => panelGenera(exp, tr, docs, cont),
      oegam: () => panelOegam(exp, tr, cont)
    };
    paneles[pestanas[0].id]();

    view.querySelectorAll('#tabs .tab').forEach(t => t.addEventListener('click', () => {
      view.querySelectorAll('#tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      paneles[t.dataset.tab]();
    }));

    view.querySelector('#slot-estado').appendChild(
      selectorEstado(exp.estado, async (nuevo) => {
        /* El bloqueo por cambio de clasificación se aplica AQUÍ, que es la
           puerta por la que el expediente entra en tramitación. Lanzar hace
           que el desplegable vuelva al estado anterior y enseñe el motivo:
           un expediente presentado con la ficha técnica todavía en el código
           viejo lo devuelve la DGT. */
        const paso = GTServicio.puedeIrA(exp, nuevo);
        if (!paso.puede) throw new Error(paso.aviso);

        await GTApi.actualizarExpediente(id, { estado: nuevo });
        exp.estado = nuevo;
        toast('Estado actualizado: ' + estadoInfo(nuevo).label, 'ok');

        /* Al pasar a tramitación es cuando el expediente tiene que estar
           completo, así que es cuando se genera el contrato si falta. */
        if (nuevo === 'tramitacion') {
          const hecho = await asegurarContrato(exp, tr, docs);
          if (hecho) {
            toast('Contrato de compraventa generado y guardado en el expediente', 'ok');
            paneles[view.querySelector('#tabs .tab.active').dataset.tab]();
          }
        }
      })
    );

    const btnDel = view.querySelector('#btn-borrar-exp');
    if (btnDel) btnDel.addEventListener('click', () => confirmarBorrado(exp, docs));
  }

  /* ---------- Contrato de compraventa · generado y guardado ----------
     Un expediente que entra en tramitación sin contrato es un expediente
     que se para. Como el CRM ya tiene todo lo que el contrato necesita, se
     genera con los datos del expediente y se guarda en su checklist.

     ANTI-INVENCIÓN: el generador no rellena huecos. Un dato que el
     expediente no tiene sale como una línea de guiones en el documento, que
     es lo que ve el gestor al revisarlo. Este contrato es un BORRADOR con
     fecha: lo firman las partes, no el CRM.

     Solo aplica cuando vende un particular. Si vende una empresa, el negocio
     se documenta con SU factura y el checklist pide esa, no un contrato de
     compraventa que nadie va a firmar. */
  async function asegurarContrato(exp, tr, docs) {
    if (tr.genera !== 'contrato' || T.esVendedorEmpresa(exp)) return false;
    if (docs.some(d => d.tipo === 'contrato')) return false;

    /* La fecha del contrato es la de la operación si ya se conoce y, si no,
       la de hoy: es la fecha que lleva el documento que se acaba de crear, no
       una fecha supuesta. Se guarda con él para que no se recalcule en cada
       visita — de aquí sale FECHA_CONTRATO del XML de OEGAM. */
    if (!T.leer(exp, 'fecha_venta')) {
      const datos = Object.assign({}, exp.datos || {}, {
        fecha_venta: new Date().toISOString().slice(0, 10)
      });
      await GTApi.actualizarExpediente(exp.id, { datos });
      exp.datos = datos;
    }

    await GTApi.subirDocumento(exp.id, 'contrato', GTContrato.archivo(exp), 'completo');

    const nuevos = await GTApi.listarDocumentos(exp.id);
    docs.length = 0; nuevos.forEach(d => docs.push(d));
    return true;
  }

  /** ¿Puede este usuario borrar este expediente? Admin, cualquiera; gestor,
      los suyos. Mismo criterio que el RLS y que la Edge Function, que es
      quien manda: esto solo decide si se enseña el botón. */
  const puedeBorrar = (exp) =>
    GTAuth.isAdmin() || (session && exp.gestor_id === session.id);

  /* Borrar es irreversible y no hay papelera: el diálogo dice exactamente qué
     se lleva por delante —cuántos documentos y cuántos archivos— en vez de un
     "¿estás seguro?" que no informa de nada. */
  function confirmarBorrado(exp, docs) {
    const n = docs.length;
    const porTipo = archivosPorTipo(docs);
    const lista = Object.keys(porTipo).map(t => {
      const etiqueta = (t === 'expediente_completo')
        ? 'Copias generadas para el Colegio'
        : t.replace(/_/g, ' ');
      return `<li>${h(etiqueta)} · ${porTipo[t].length} archivo${porTipo[t].length === 1 ? '' : 's'}</li>`;
    }).join('');

    modal({
      titulo: 'Eliminar expediente',
      okTexto: 'Eliminar definitivamente',
      peligro: true,
      cuerpo: `
        <p style="margin-top:0">Se va a eliminar el expediente
          <b>${h(exp.referencia)}</b>${exp.matricula ? ' · ' + h(exp.matricula) : ''}
          ${exp.cliente ? ' · ' + h(nombreCliente(exp.cliente)) : ''}.</p>

        ${n ? `<p style="margin-bottom:6px">Con él se borran <b>${n} documento${n === 1 ? '' : 's'}</b>
            y sus archivos del bucket:</p>
          <ul style="margin:0 0 12px;padding-left:20px;font-size:.84rem;color:var(--muted)">${lista}</ul>`
          : '<p>No tiene ningún documento adjunto.</p>'}

        <div class="regul-note" style="margin:0">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div><b>Esto no se puede deshacer.</b> No hay papelera: los archivos se
            borran del bucket y el expediente desaparece del listado y del Kanban.</div>
        </div>`,
      onOk: async () => {
        const r = await GTApi.borrarExpedienteCompleto(exp.id);
        toast(`${r.referencia} eliminado · ${r.objetos_borrados} archivo${r.objetos_borrados === 1 ? '' : 's'}`
          + ` y ${r.filas_borradas} documento${r.filas_borradas === 1 ? '' : 's'}`, 'ok');
        // El listado se vuelve a pedir al entrar, así que basta con navegar.
        location.hash = '#/expedientes';
      }
    });
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
    const caras = ia.avisos_caras || [];
    const pendientesITP = ia.pendientes_itp || [];

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
        ${caras.length ? `<span class="ia-chip baja">${caras.length} documento${caras.length === 1 ? '' : 's'} a medias</span>` : ''}
        ${exp.itp_importe != null && !pendientesITP.length
          ? `<span class="ia-chip alta">ITP propuesto · ${h(eur(exp.itp_importe))}</span>` : ''}
        ${exp.ia_modelo ? `<span class="t-muted" style="font-size:.72rem">leído con <span class="t-mono">${h(exp.ia_modelo)}</span></span>` : ''}
      </div>

      ${pendientesITP.length ? `<div class="ia-huecos">
        ${svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>')}
        <div>El ITP <b>no se ha calculado</b> porque falta ${h(pendientesITP.join('; falta '))}.
          Complétalo en la pestaña <b>Calculadora ITP</b> — Gest-IA no calcula a medias
          ni rellena un dato fiscal por aproximación.</div>
      </div>` : ''}
      ${caras.length ? `<div class="ia-huecos">
        ${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}
        <div>Falta una cara: <b>${caras.map(c => h(c.texto)).join(' · ')}</b>.
          Los datos de esa cara —el <b>domicilio</b> está en el reverso del DNI— quedan en blanco.
          Súbela en <b>Documentación</b> y vuelve a leer.</div>
      </div>` : ''}
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

  /* ============================================================
     Buscador del Anexo I · marca → modelo → versión
     ------------------------------------------------------------
     Lo usan el panel ITP del expediente y la calculadora suelta.
     Está aquí y no duplicado en cada uno porque la regla que
     implementa es delicada: el BOE no descompone el modelo —
     publica una sola cadena «Modelo-Tipo» por fila—, así que
     `modelo` es solo un agrupador para no listar 61.634 opciones
     de golpe. La identidad fiscal es la VERSIÓN, y la elige una
     persona: mientras no lo haga, el valor base sigue siendo un
     campo manual.

     El catálogo se pide por RPC (`gestotrafic_precios_*`), que
     solo tienen `execute` para `authenticated` y devuelven listas
     agregadas. La tabla entera no baja nunca al navegador.
     ============================================================ */

  function htmlBuscadorBoe(oculto) {
    return `
      <div class="boe-buscador${oculto ? ' hidden' : ''}" data-buscador-boe>
        <div class="boe-buscador-t">
          Precio medio del Anexo I
          <span class="boe-sello" data-contador-boe>cargando…</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="f-boe-marca">Marca</label>
            <select id="f-boe-marca"><option value="">Cargando…</option></select>
          </div>
          <div class="field">
            <label for="f-boe-modelo">Modelo</label>
            <select id="f-boe-modelo" disabled><option value="">Elige marca</option></select>
          </div>
        </div>
        <div class="field">
          <label for="f-boe-version">Versión <span class="t-muted" style="font-weight:400">· la elige el gestor</span></label>
          <select id="f-boe-version" disabled><option value="">Elige modelo</option></select>
        </div>
        <div class="boe-ficha" data-boe-ficha></div>
      </div>`;
  }

  /**
   * @param o.raiz       elemento que contiene el HTML de htmlBuscadorBoe()
   * @param o.tipoBoe    () => 'turismo' | 'autocaravana'
   * @param o.fechaMat   () => 'AAAA-MM-DD' | null · solo marca las versiones
   *                     fuera de periodo, no las esconde
   * @param o.sugerencia { marca, modelo } de Gest-IA, o null
   * @param o.onCambio   (fila|null) cada vez que cambia la versión elegida
   */
  function crearBuscadorBoe(o) {
    const cont      = o.raiz;
    const selMarca  = cont.querySelector('#f-boe-marca');
    const selModelo = cont.querySelector('#f-boe-modelo');
    const selVer    = cont.querySelector('#f-boe-version');
    const fichaBoe  = cont.querySelector('[data-boe-ficha]');
    const contador  = cont.querySelector('[data-contador-boe]');

    let versiones = [];
    let catalogoCargado = null;   // tipo del BOE cuyas marcas ya están pedidas
    let elegida = null;

    const norm = (s) => (s || '').toString().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

    function opciones(sel, lista, textoVacio) {
      sel.innerHTML = `<option value="">${h(textoVacio)}</option>` + lista;
      sel.disabled = false;
    }

    function avisar() { if (o.onCambio) o.onCambio(elegida); }

    async function cargarMarcas() {
      const tipo = o.tipoBoe();
      if (catalogoCargado === tipo) return;
      catalogoCargado = tipo;
      // Al cambiar de turismo a autocaravana (o al revés) el catálogo entero
      // es otro: se limpia lo elegido para no mezclar filas de los dos.
      elegida = null;
      versiones = [];
      selModelo.innerHTML = '<option value="">Elige marca</option>';
      selModelo.disabled = true;
      selVer.innerHTML = '<option value="">Elige modelo</option>';
      selVer.disabled = true;
      fichaBoe.innerHTML = '';
      selMarca.innerHTML = '<option value="">Cargando…</option>';
      avisar();
      try {
        const marcas = await GTApi.preciosMarcas(tipo);
        if (catalogoCargado !== tipo) return;   // cambió de tipo mientras cargaba
        opciones(selMarca, marcas.map(m =>
          `<option value="${h(m.marca)}">${h(m.marca)} (${m.filas})</option>`).join(''),
          '— elige marca —');
        contador.textContent =
          marcas.reduce((n, m) => n + Number(m.filas), 0).toLocaleString('es-ES') + ' versiones';
        proponer(marcas);
      } catch (err) {
        catalogoCargado = null;
        selMarca.innerHTML = '<option value="">No se pudo cargar el Anexo I</option>';
        toast(err.message || 'No se pudo cargar el catálogo del Anexo I', 'err');
      }
    }

    /* Gest-IA propone; no decide. Se preseleccionan marca y modelo —que solo
       sirven para navegar— y la versión se deja SIN elegir: es la que fija el
       precio, así que la confirma una persona. */
    function proponer(marcas) {
      const sug = o.sugerencia && o.sugerencia();
      if (!sug || !sug.marca) return;
      const m = marcas.find(x => norm(x.marca) === norm(sug.marca));
      if (!m) return;
      selMarca.value = m.marca;
      cargarModelos(sug.modelo);
    }

    async function cargarModelos(modeloSugerido) {
      elegida = null;
      selVer.innerHTML = '<option value="">Elige modelo</option>';
      selVer.disabled = true;
      fichaBoe.innerHTML = '';
      if (!selMarca.value) {
        selModelo.innerHTML = '<option value="">Elige marca</option>';
        selModelo.disabled = true;
        return avisar();
      }
      selModelo.innerHTML = '<option value="">Cargando…</option>';
      selModelo.disabled = true;
      try {
        const modelos = await GTApi.preciosModelos(selMarca.value, o.tipoBoe());
        opciones(selModelo, modelos.map(x =>
          `<option value="${h(x.modelo)}">${h(x.modelo)} (${x.filas})</option>`).join(''),
          '— elige modelo —');

        // El agrupador es el primer token del Modelo-Tipo del BOE, así que se
        // compara contra el primer token de lo que leyó Gest-IA.
        if (modeloSugerido) {
          const primero = norm(modeloSugerido).split(' ')[0];
          const m = modelos.find(x => norm(x.modelo) === primero);
          if (m) { selModelo.value = m.modelo; await cargarVersiones(modeloSugerido); }
        }
      } catch (err) {
        selModelo.innerHTML = '<option value="">Error al cargar</option>';
        toast(err.message || 'No se pudieron cargar los modelos', 'err');
      }
      avisar();
    }

    async function cargarVersiones(versionSugerida) {
      elegida = null;
      fichaBoe.innerHTML = '';
      if (!selModelo.value) {
        selVer.innerHTML = '<option value="">Elige modelo</option>';
        selVer.disabled = true;
        return avisar();
      }
      selVer.innerHTML = '<option value="">Cargando…</option>';
      selVer.disabled = true;
      try {
        versiones = await GTApi.preciosVersiones(
          selMarca.value, selModelo.value, o.fechaMat() || null, o.tipoBoe());

        const propuesta = versionSugerida ? mejorCandidata(versiones, versionSugerida) : null;
        opciones(selVer, versiones.map(v => {
          const ficha = [v.periodo_desde ? v.periodo_desde + (v.periodo_hasta ? '-' + v.periodo_hasta : '→') : null,
                         v.cilindrada ? v.cilindrada + 'cc' : null,
                         v.combustible, v.potencia_kw ? v.potencia_kw + 'kW' : null].filter(Boolean).join(' · ');
          const sello = (propuesta && propuesta.v.id === v.id) ? ' ★ propuesta IA' : '';
          return `<option value="${h(v.id)}">${h(v.denominacion)} — ${h(ficha)} — ${eur(v.valor_base_euros)}`
               + `${v.en_periodo ? '' : ' [fuera del año]'}${sello}</option>`;
        }).join(''), `— elige versión (${versiones.length}) —`);

        pintarAvisoPropuesta(propuesta, versionSugerida);
      } catch (err) {
        selVer.innerHTML = '<option value="">Error al cargar</option>';
        toast(err.message || 'No se pudieron cargar las versiones', 'err');
      }
      avisar();
    }

    /* Puntúa por palabras compartidas con lo que leyó Gest-IA. Solo se usa
       para SUGERIR una opción: no rellena el valor base, y si el mejor
       candidato empata con otro se descarta la sugerencia. */
    function mejorCandidata(lista, texto) {
      const busca = norm(texto).split(' ').filter(Boolean);
      if (!busca.length) return null;
      const puntuadas = lista.map(v => {
        const tokens = norm(v.denominacion).split(' ').filter(Boolean);
        const comunes = busca.filter(t => tokens.includes(t)).length;
        return { v, score: comunes / busca.length, enPeriodo: v.en_periodo };
      }).filter(x => x.score > 0)
        .sort((a, b) => (b.enPeriodo - a.enPeriodo) || (b.score - a.score));

      if (!puntuadas.length) return null;
      const mejor = puntuadas[0];
      const segunda = puntuadas[1];
      // Empate o parecido flojo: no se sugiere nada y decide el gestor.
      if (mejor.score < 0.6) return null;
      if (segunda && segunda.score === mejor.score && segunda.enPeriodo === mejor.enPeriodo) return null;
      return mejor;
    }

    function pintarAvisoPropuesta(propuesta, versionSugerida) {
      if (!versionSugerida) return;
      fichaBoe.innerHTML = propuesta
        ? `<div class="boe-propuesta">
             ${svg('<path d="M12 2l2.4 6.9H22l-6 4.3 2.3 6.8-6.3-4.4-6.3 4.4L8 13.2l-6-4.3h7.6z"/>')}
             <div>Gest-IA propone <b>${h(propuesta.v.denominacion)}</b>
               (${eur(propuesta.v.valor_base_euros)}) a partir de «${h(versionSugerida)}».
               <b>Confírmala en el desplegable</b> o elige otra: el valor base no se
               rellena hasta que la elijas.</div>
           </div>`
        : `<div class="boe-propuesta sin-match">
             ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
             <div>Gest-IA leyó «${h(versionSugerida)}» pero <b>no hay una versión
               claramente equivalente</b> en el Anexo I. Elige la correcta a mano
               comparándola con la ficha técnica, o introduce el valor base
               directamente.</div>
           </div>`;
    }

    function pintarFichaElegida(v) {
      fichaBoe.innerHTML = `<div class="boe-propuesta elegida">
          ${svg('<path d="M20 6L9 17l-5-5"/>')}
          <div><b>${h(v.denominacion)}</b> · ${h(v.periodo_desde || '?')}${v.periodo_hasta ? '-' + h(v.periodo_hasta) : '→'}
            ${v.cilindrada ? ' · ' + h(v.cilindrada) + ' c.c.' : ''}
            ${v.num_cilindros ? ' · ' + h(v.num_cilindros) + ' cil.' : ''}
            ${v.combustible ? ' · ' + h(v.combustible) : ''}
            ${v.potencia_kw ? ' · ' + h(v.potencia_kw) + ' kW' : ''}
            ${v.potencia_cv ? ' (' + h(v.potencia_cv) + ' cv)' : ''}
            ${v.cvf ? ' · ' + h(v.cvf) + ' CVf' : ''}
            → valor base <b>${eur(v.valor_base_euros)}</b>
            ${v.en_periodo ? '' : '<br><b>Ojo:</b> esta versión no corresponde al año de matriculación indicado.'}
          </div>
        </div>`;
    }

    selMarca.addEventListener('change', () => cargarModelos(null));
    selModelo.addEventListener('change', () => cargarVersiones(null));
    selVer.addEventListener('change', () => {
      elegida = versiones.find(x => x.id === selVer.value) || null;
      if (elegida) pintarFichaElegida(elegida); else fichaBoe.innerHTML = '';
      avisar();
    });

    return {
      /** Carga el catálogo del tipo actual (no hace nada si ya está). */
      sincronizar: cargarMarcas,
      /** Fila del Anexo I elegida por el gestor, o null. */
      elegida: () => elegida,
      /** Marca y modelo seleccionados. Solo se usan como respaldo cuando no
          hay fila fijada: con fila, el motor busca por id. */
      marca: () => selMarca.value,
      modelo: () => selModelo.value
    };
  }

  /* ---------- Panel: Calculadora ITP (solo transferencia) ---------- */
  function panelITP(exp, cont, onCambio) {
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
              <label for="f-tipo-veh">Tipo de vehículo</label>
              <select name="tipo_vehiculo" id="f-tipo-veh">
                ${window.GT_TIPOS_VEHICULO.map(t => `<option value="${h(t.id)}" ${(T.leer(exp, 'tipo_vehiculo') || 'coche') === t.id ? 'selected' : ''}>${h(t.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field hidden" data-solo-kw>
              <label>Potencia (kW)</label>
              <input name="potencia_kw" type="number" step="0.01" min="0" value="${T.leer(exp, 'potencia_kw') ?? ''}" placeholder="11">
            </div>
            <div class="field" data-campo-boe>
              <label>Valor BOE Anexo I (€) *<span class="boe-sello hidden" data-sello-boe></span></label>
              <input name="valor_boe" type="number" step="0.01" min="0" value="${exp.valor_boe ?? ''}" placeholder="21000">
            </div>
          </div>

          <!-- Solo turismos y autocaravanas: el resto se tarifa por tramo. -->
          ${htmlBuscadorBoe(true)}

          <div class="form-grid">
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

      // La ficha enseña los mismos importes: se repinta de la misma fuente.
      if (onCambio) onCambio();
    }
    pintarResultado();

    cont.querySelector('#chk-exento').addEventListener('change', async (ev) => {
      const chk = ev.target;
      const exento = chk.checked;
      const calc = exp.calculo_json || {};

      // Al retirar la exención se recupera el importe que devolvió el motor.
      const cambios = exento
        ? { itp_importe: 0, total_impuestos: exp.tasa_dgt != null ? Number(exp.tasa_dgt) : null }
        : { itp_importe: calc.itp ?? null, total_impuestos: calc.total_impuestos ?? null };

      /* La exención cambia el ITP, y el ITP es una de las cuatro cifras del
         total al cliente: se recalcula con el ITP nuevo ya puesto. */
      cambios.datos = GTHonorarios.conTotal(
        Object.assign({}, exp, cambios),
        Object.assign({}, exp.datos || {}, { itp_exento: exento }));

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

    /* Valor base automático: para todo lo que no sea turismo, el Anexo I
       tarifa por tramo de cilindrada (o de kW), así que el motor lo busca
       solo en gestotrafic_precios_medios y el campo manual sobra. El
       turismo sigue pidiéndolo a mano hasta que tengamos su lista. */
    const selTipo = cont.querySelector('#f-tipo-veh');
    const campoBoe = cont.querySelector('[data-campo-boe]');
    const inputBoe = campoBoe.querySelector('input');
    const selloBoe = cont.querySelector('[data-sello-boe]');
    const campoKw = cont.querySelector('[data-solo-kw]');

    let valorBaseId = null;   // fila del Anexo I fijada por el gestor

    /* Buscador del Anexo I. El componente vive fuera del panel porque lo
       comparte con la calculadora suelta del menu. Aqui solo se conecta:
       al elegir version se rellena el campo del valor base y se resincroniza
       el panel; al deshacerla, el campo vuelve a ser manual. */
    const buscador = crearBuscadorBoe({
      raiz: cont.querySelector('[data-buscador-boe]'),
      tipoBoe: () => {
        const def = window.GT_TIPOS_VEHICULO.find(t => t.id === selTipo.value);
        return (def && def.boe) || 'turismo';
      },
      fechaMat: () => val(cont, 'fecha_matriculacion'),
      sugerencia: () => ({ marca: exp.marca, modelo: exp.modelo }),
      onCambio: (fila) => {
        valorBaseId = fila ? fila.id : null;
        if (fila) inputBoe.value = fila.valor_base_euros;
        sincronizarTipo();
      }
    });
    const cajaBuscador = cont.querySelector('[data-buscador-boe]');

    function sincronizarTipo() {
      const def = window.GT_TIPOS_VEHICULO.find(t => t.id === selTipo.value) || window.GT_TIPOS_VEHICULO[0];
      const porModelo = def.por === 'marca_modelo';
      campoKw.classList.toggle('hidden', def.por !== 'kw');
      cajaBuscador.classList.toggle('hidden', !porModelo);

      // El campo se bloquea cuando el valor lo pone la tabla: por tramo
      // (motos, quads, buggys) o por la versión que ha elegido el gestor.
      const desdeTabla = def.auto || (porModelo && valorBaseId);
      inputBoe.readOnly = !!desdeTabla;
      campoBoe.classList.toggle('boe-auto', !!desdeTabla);
      selloBoe.classList.toggle('hidden', !desdeTabla);

      if (def.auto) {
        selloBoe.textContent = 'automático';
        inputBoe.placeholder = def.por === 'kw' ? 'lo calcula por kW' : 'lo calcula por cilindrada';
      } else if (porModelo && valorBaseId) {
        selloBoe.textContent = 'Anexo I · versión elegida';
      } else {
        inputBoe.placeholder = porModelo ? 'elige la versión o escríbelo' : '21000';
      }

      if (porModelo) buscador.sincronizar();
    }
    selTipo.addEventListener('change', () => { valorBaseId = null; sincronizarTipo(); });
    sincronizarTipo();

    cont.querySelector('#btn-calcular').addEventListener('click', async () => {
      const btn = cont.querySelector('#btn-calcular');
      const tipoVeh = val(cont, 'tipo_vehiculo') || 'coche';
      const def = window.GT_TIPOS_VEHICULO.find(t => t.id === tipoVeh) || {};
      const autoBase = def.auto;
      // En turismo el valor sale de la tabla solo si el gestor fijó una versión.
      const desdeTabla = autoBase || (def.por === 'marca_modelo' && valorBaseId);
      const payload = {
        // Con valor base de tabla NO se manda el manual: si se mandara, el
        // motor lo respetaría y la tabla no llegaría a consultarse.
        valor_boe: desdeTabla ? null : num(cont, 'valor_boe'),
        // Fija la fila exacta del Anexo I. Manda sobre marca/modelo/versión:
        // es la que el gestor ha visto y confirmado con su precio.
        valor_base_id: valorBaseId || null,
        tipo_vehiculo: tipoVeh,
        potencia_kw: num(cont, 'potencia_kw'),
        marca: buscador.marca() || exp.marca || null,
        modelo: buscador.modelo() || exp.modelo || null,
        precio_contrato: num(cont, 'precio_contrato'),
        fecha_matriculacion: val(cont, 'fecha_matriculacion'),
        fecha_transmision: new Date().toISOString().slice(0, 10),
        ccaa: val(cont, 'ccaa'),
        cilindrada: num(cont, 'cilindrada'),
        cvf: num(cont, 'cvf'),
        etiqueta_dgt: val(cont, 'etiqueta_dgt'),
        uso_especial: val(cont, 'uso_especial') === 'si'
      };

      if (!payload.fecha_matriculacion) { toast('Falta la fecha de matriculación', 'err'); return; }
      if (!desdeTabla && !payload.valor_boe) {
        toast('Elige la versión en el Anexo I o escribe el valor base', 'err'); return;
      }
      if (autoBase && !payload.cilindrada && !payload.potencia_kw) {
        toast('Para buscar el valor base falta la cilindrada (o los kW en eléctricas)', 'err'); return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await GTApi.calcularITP(payload);

        /* Con valor base automático, el valor lo resuelve el motor: se lee de
           su respuesta y se refleja en el campo, que sigue en solo lectura. */
        const valorBoeUsado = r.detalle ? r.detalle.valor_boe : payload.valor_boe;
        if (desdeTabla) {
          inputBoe.value = valorBoeUsado;
          const filaBoe = r.detalle && r.detalle.valor_base_fila;
          if (filaBoe && filaBoe.tramo_etiqueta) selloBoe.textContent = filaBoe.tramo_etiqueta;
          else if (filaBoe && filaBoe.denominacion) selloBoe.textContent = 'Anexo I · ' + filaBoe.denominacion;
        }

        /* La exención la decide el gestor, no el motor: si está marcada se
           respeta y solo queda la tasa DGT. `calculo_json` guarda siempre el
           resultado íntegro del motor para poder auditarlo y revertirla. */
        const exento = T.esExentoITP(exp);
        const itpFinal = exento ? 0 : r.itp;
        const totalFinal = exento ? r.tasa_dgt : r.total_impuestos;

        const calculadoAt = new Date().toISOString();

        /* El ITP y la tasa acaban de cambiar, y son dos de las cuatro cifras
           del total al cliente: se recalcula con las nuevas ya puestas. Sin
           esto, un expediente con honorarios se quedaría con el total de
           antes de recalcular y nadie lo notaría. */
        const datosVeh = GTHonorarios.conTotal(
          Object.assign({}, exp, {
            itp_importe: itpFinal, tasa_dgt: r.tasa_dgt, calculo_json: r
          }),
          Object.assign({}, exp.datos || {}, {
            tipo_vehiculo: tipoVeh,
            potencia_kw: payload.potencia_kw
          }));

        await GTApi.actualizarExpediente(exp.id, {
          datos: datosVeh,
          valor_boe: valorBoeUsado,
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
          calculado_at: calculadoAt
        });

        /* El expediente en memoria tiene que quedar EXACTAMENTE como el
           guardado: de él se pintan la ficha, el XML de OEGAM y el expediente
           completo sin volver a consultar. Si aquí faltara un campo, la
           pantalla enseñaría una cifra y la base de datos otra. */
        Object.assign(exp, {
          datos: datosVeh,
          valor_boe: valorBoeUsado, precio_contrato: payload.precio_contrato,
          fecha_matriculacion: payload.fecha_matriculacion, ccaa: payload.ccaa,
          cilindrada: payload.cilindrada, cvf: payload.cvf,
          etiqueta_dgt: payload.etiqueta_dgt, uso_especial: payload.uso_especial,
          valor_venal: r.valor_venal, base_imponible: r.base_imponible,
          itp_importe: itpFinal, tasa_dgt: r.tasa_dgt,
          total_impuestos: totalFinal, calculo_json: r, calculado_at: calculadoAt
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

  /* ---------- Panel: honorarios de la gestoría y total al cliente ----------
     Lo que se liquida a Hacienda y lo que se le COBRA al cliente son cosas
     distintas, y esta pestaña es la segunda. El desglose enseña por qué el
     IVA solo toca una de las tres líneas, porque es la pregunta que hace
     cualquiera que mire una factura de gestoría por primera vez.

     La cuenta no está aquí: vive en assets/js/honorarios.js, con la regla
     del IVA en una sola multiplicación y su propio verificador. Este panel
     solo la pinta. */
  function panelHonorarios(exp, cont, onCambio) {
    const r = GTHonorarios.calcular(exp);

    /* Una línea del desglose. `nota` es la columna que dice por qué esa
       línea lleva IVA o no: es el dato que se pierde en cuanto alguien
       copia el total a otro sitio. */
    const linea = (concepto, nota, importe, clase) => `
      <tr class="${clase || ''}">
        <td>${concepto}</td>
        <td class="hon-nota">${nota}</td>
        <td class="t-num">${importe === null ? '<span class="t-muted">—</span>' : h(eur(importe))}</td>
      </tr>`;

    const sinIva = '<span class="hon-sin-iva">sin IVA</span>';

    cont.innerHTML = `
      <div class="detail-grid">
        <div class="card" style="align-self:start">
          <div class="card-t">Honorarios de la gestoría</div>
          <p class="t-muted" style="font-size:.79rem;margin:0 0 16px">
            Lo que cobra la gestoría por tramitar el expediente. Es lo único
            de la factura que lleva <b>IVA</b>.
          </p>

          <form id="form-honorarios">
            <div class="form-grid">
              <div class="field">
                <label for="f-honorarios">Honorarios (base, €)</label>
                <input type="number" step="0.01" min="0" name="honorarios" id="f-honorarios"
                  value="${r.honorarios === null ? '' : h(r.honorarios)}" placeholder="100">
              </div>
              <div class="field">
                <label for="f-iva">Tipo de IVA (%)</label>
                <input type="number" step="0.01" min="0" max="100" name="honorarios_iva_tipo" id="f-iva"
                  value="${h(r.ivaTipo)}" placeholder="${h(GTHonorarios.IVA_DEFECTO)}">
                <small class="field-hint">El general es el
                  <b>${h(GTHonorarios.IVA_DEFECTO)}%</b>. Se puede cambiar para un caso
                  concreto; solo afecta a los honorarios.</small>
              </div>
            </div>
            <div class="row-actions">
              <button type="submit" class="btn btn-sm" id="btn-honorarios">Guardar honorarios</button>
              ${r.hayHonorarios
                ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-honorarios-quitar">Quitar honorarios</button>'
                : ''}
            </div>
          </form>

          <div class="form-sec" style="margin-top:22px">Total a cobrar al cliente</div>

          <table class="hon-tabla">
            <tbody>
              ${linea('ITP de la transmisión',
                r.exentoItp && r.hayCalculoItp
                  ? '<b>exento</b> · confirmado por el gestor'
                  : 'impuesto · ' + sinIva,
                r.itp)}
              ${linea('Tasa DGT', 'suplido · ' + sinIva, r.tasaDgt)}
              ${linea('Honorarios de la gestoría', 'base del IVA', r.honorarios)}
              ${linea(`IVA ${h(r.ivaTipo)}% sobre honorarios`,
                r.hayHonorarios
                  ? `${h(eur(r.honorarios))} × ${h(r.ivaTipo)}%`
                  : 'se calcula sobre los honorarios',
                r.iva, 'hon-iva')}
            </tbody>
            <tfoot>
              ${linea('<b>TOTAL a cobrar</b>',
                r.faltan.length
                  ? 'faltan ' + h(r.faltan.join(' y '))
                  : 'ITP + tasa DGT + honorarios + IVA',
                r.total, 'hon-total')}
            </tfoot>
          </table>

          <div class="hon-regla">
            ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
            <div><b>El IVA es solo de los honorarios.</b>
              El <b>ITP</b> es un impuesto y la <b>tasa DGT</b> es un
              <b>suplido</b> —la gestoría lo adelanta en nombre del cliente y se
              lo repercute tal cual—, así que ninguno de los dos entra en la base
              del IVA. Sumarlos ahí le cobraría al cliente un dinero que no debe.</div>
          </div>

          ${r.hayHonorarios ? `<p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
            Honorarios <b>${h(eur(r.honorarios))}</b> + IVA <b>${h(eur(r.iva))}</b>
            = <b>${h(eur(r.honorariosConIva))}</b> con IVA.
          </p>` : ''}
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-t">De dónde sale cada cifra</div>
            <dl class="dl">
              <dt>ITP y tasa DGT</dt>
              <dd>${r.hayCalculoItp
                ? 'Del cálculo guardado, motor <span class="t-mono">gestotrafic-itp</span>. Aquí no se recalculan.'
                : '<b>Sin calcular.</b> Hazlo en <b>Calculadora ITP</b>: hasta entonces el total solo suma lo que hay.'}</dd>
              <dt>Honorarios</dt>
              <dd>${r.hayHonorarios
                ? 'Los ha puesto el gestor. No hay tarifa automática.'
                : '<b>Sin fijar.</b> Los pone el gestor: no se estiman.'}</dd>
              <dt>Factura</dt>
              <dd>Este desglose es para el <b>cliente</b> (presupuesto o factura).
                <b>No va al XML de OEGAM</b>: ese formato no tiene campo de importe.</dd>
            </dl>
          </div>
          ${avisoRegulado()}
        </div>
      </div>`;

    async function guardar(datosNuevos, mensaje) {
      const btn = cont.querySelector('#btn-honorarios');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Guardando…';
      try {
        /* El total se recalcula SIEMPRE al escribir, y por el mismo sitio por
           el que lo hace el cálculo del ITP: así no puede quedarse una cifra
           antigua guardada que contradiga a las otras cuatro. */
        const datos = GTHonorarios.conTotal(exp, datosNuevos);
        await GTApi.actualizarExpediente(exp.id, { datos });
        exp.datos = datos;
        toast(mensaje, 'ok');
        panelHonorarios(exp, cont, onCambio);
        if (onCambio) onCambio();
      } catch (err) {
        toast(err.message || 'No se pudieron guardar los honorarios', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar honorarios';
      }
    }

    cont.querySelector('#form-honorarios').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const base = num(cont, 'honorarios');
      const tipo = num(cont, 'honorarios_iva_tipo');

      if (base !== null && base < 0) { toast('Los honorarios no pueden ser negativos', 'err'); return; }
      if (tipo !== null && (tipo < 0 || tipo > 100)) { toast('El tipo de IVA va entre 0 y 100', 'err'); return; }

      const datos = Object.assign({}, exp.datos || {});
      // Sin honorarios no se guarda un 0: un cero es una tarifa, un hueco no.
      if (base === null) delete datos.honorarios; else datos.honorarios = base;
      datos.honorarios_iva_tipo = tipo === null ? GTHonorarios.IVA_DEFECTO : tipo;

      guardar(datos, base === null ? 'Honorarios vaciados' : 'Honorarios guardados');
    });

    const btnQuitar = cont.querySelector('#btn-honorarios-quitar');
    if (btnQuitar) btnQuitar.addEventListener('click', () => {
      const datos = Object.assign({}, exp.datos || {});
      delete datos.honorarios;
      guardar(datos, 'Honorarios retirados del expediente');
    });
  }

  function detalleTexto(r) {
    const d = r.detalle || {};
    const tipo = typeof d.tipo_aplicable === 'number'
      ? (d.tipo_aplicable * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + '%'
      : h(d.tipo_aplicable || '—');

    // Qué fila del Anexo I dio el valor base: el tramo (motos, quads, buggys)
    // o la versión concreta que eligió el gestor (turismos).
    const fila = d.valor_base_fila || {};
    const detalleFila = fila.tramo_etiqueta || fila.denominacion || '';
    const fuenteBase = d.valor_base_origen === 'tabla_boe'
      ? ` <span class="boe-sello">Anexo I${detalleFila ? ' · ' + h(detalleFila) : ' automático'}</span>`
      : '';

    return `Valor BOE <b>${eur(d.valor_boe)}</b>${fuenteBase} × depreciación <b>${((d.pct_depreciacion || 0) * 100).toFixed(0)}%</b>
      (${h(d.tramo || '')})${d.coef_uso_especial === 0.7 ? ' × <b>70%</b> uso especial' : ''}
      = valor venal <b>${eur(r.valor_venal)}</b>.<br>
      Base imponible <b>${eur(r.base_imponible)}</b>${d.base_desde_contrato ? ' (precio de contrato, superior al valor fiscal)' : ''}
      · ${h(d.ccaa || '')} · tipo <b>${tipo}</b> → ITP <b>${eur(r.itp)}</b>.<br>
      ${h(d.concepto_tasa_dgt || 'Tasa DGT')}: <b>${eur(r.tasa_dgt)}</b>. Total a liquidar: <b>${eur(r.total_impuestos)}</b>.
      ${d.nota ? '<br>' + h(d.nota) : ''}
      <br><span style="opacity:.7">Fuente: ${h(d.fuente || 'BOE 2026')} · antigüedad ${h(d.anios_uso)} años.</span>`;
  }

  /* ---------- Panel: Datos (formulario editable generado por catálogo) ---------- */
  function panelDatos(exp, tr, cont, onCambio) {
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
              ${tr.calculo === 'itp' ? `<dt>Vendedor</dt><dd>${T.esVendedorEmpresa(exp) ? 'Empresa / concesionario' : 'Particular'}</dd>
              <dt>Comprador</dt><dd>${T.esCompradorEmpresa(exp) ? 'Empresa / concesionario' : 'Particular'}</dd>` : ''}
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
    activarTipoParte(form);
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
        panelDatos(exp, tr, cont, onCambio);    // refleja tipo de vendedor y exención
        /* El cambio de servicio y el código de clasificación se editan en
           este formulario, así que el aviso de la ficha —que decide si se
           puede tramitar— tiene que repintarse con lo recién guardado. */
        if (onCambio) onCambio();
      } catch (err) {
        toast(err.message || 'No se pudieron guardar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar cambios';
      }
    });
  }

  /* ---------- Panel: Documentación ---------- */

  /** Archivos subidos de cada tipo, con la cara que ocupa cada uno. Un tipo
      puede tener varias filas: el anverso y el reverso de un DNI. */
  function archivosPorTipo(docs) {
    const porTipo = {};
    (docs || []).forEach(d => {
      const cara = GTApi.caraDocumento(d);
      (porTipo[d.tipo] = porTipo[d.tipo] || []).push(Object.assign({ cara: cara }, d));
    });
    return porTipo;
  }

  /** «anverso ✓ · reverso pendiente», para ver de un vistazo qué falta. */
  function resumenCaras(def, archivos) {
    if (!T.admiteVariasCaras(def)) return '';
    const est = T.estadoCaras(def, archivos);
    if (est.conArchivoCompleto) return 'documento completo en un archivo';
    if (!archivos.length) return '';
    return def.caras
      .map(c => c.id.replace('_', ' ') + (est.presentes.indexOf(c.id) !== -1 ? ' ✓' : ' pendiente'))
      .join(' · ');
  }

  async function panelDocs(exp, tr, docs, cont) {
    const porTipo = archivosPorTipo(docs);

    // El bucket es privado: los enlaces se firman al pintar y caducan en 1 h.
    const enlaces = await GTApi.urlsDocumentos(docs);

    const aplicables = T.docsDe(tr, exp);
    const obligatorios = aplicables.filter(d => d.obligatorio);
    const recibidos = obligatorios.filter(d => (porTipo[d.tipo] || []).length).length;
    const pct = obligatorios.length ? (recibidos / obligatorios.length * 100) : 100;

    const KB = (n) => Math.round((n || 0) / 1024) + ' KB';

    cont.innerHTML = `
      <div class="card" style="max-width:860px">
        <div class="flex">
          <div class="card-t" style="margin:0">Checklist documental · ${h(tr.corto.toLowerCase())}</div>
          <div class="spacer"></div>
          <b style="font-size:.84rem">${recibidos} / ${obligatorios.length} obligatorios</b>
        </div>
        <div class="checklist-bar"><div class="checklist-fill" style="width:${pct}%"></div></div>

        ${aplicables.map(def => {
          const archivos = porTipo[def.tipo] || [];
          const varias = T.admiteVariasCaras(def);
          const est = T.estadoCaras(def, archivos);
          const hay = archivos.length > 0;
          const incompleto = varias && hay && !est.completo;
          const resumen = resumenCaras(def, archivos);

          const linea = (doc) => `<div class="doc-cara">
            <span class="doc-cara-l">${h(T.etiquetaCara(def, doc.cara))}</span>
            <span class="doc-cara-n">${h(doc.nombre_archivo)} · ${KB(doc.tamano)}</span>
            ${enlaces[doc.id] ? `<a class="btn btn-ghost btn-sm" href="${h(enlaces[doc.id])}" target="_blank" rel="noopener">Ver</a>` : ''}
            <button class="btn btn-danger btn-sm" data-del="${h(doc.id)}">Quitar</button>
          </div>`;

          /* Los botones de subida son uno por cara pendiente más el de
             documento completo: quien tenga el DNI en un PDF no debería
             tener que partirlo en dos. */
          const subir = (cara, texto) => `<label class="file-label">${h(texto)}<input type="file"
            accept="image/*,application/pdf" data-tipo="${h(def.tipo)}" data-cara="${h(cara)}"></label>`;

          return `<div class="doc-row ${hay ? 'ok' : ''} ${varias ? 'doc-row-caras' : ''}">
            <div class="doc-ico">
              ${hay
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
                : svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}
            </div>
            <div class="doc-info">
              <strong>${h(def.label)} ${def.obligatorio ? '' : '<span class="t-muted" style="font-weight:400;font-size:.74rem">· opcional</span>'}</strong>
              ${varias
                ? `<small>${hay ? h(resumen) : 'Sin archivo · admite las dos caras o un archivo con todo'}</small>
                   ${archivos.map(linea).join('')}
                   <div class="doc-subidas">
                     ${est.conArchivoCompleto ? '' : est.faltan.map(c => subir(c, 'Subir ' + T.etiquetaCara(def, c))).join('')}
                     ${subir('completo', hay ? 'Sustituir por el completo' : 'Subir documento completo')}
                   </div>`
                : `<small>${hay ? h(archivos[0].nombre_archivo) + ' · ' + KB(archivos[0].tamano) : 'Sin archivo'}</small>`}
            </div>
            <div class="doc-actions">
              <span class="badge badge-${hay ? (incompleto ? 'pendiente' : 'recibido') : 'pendiente'}">${hay ? (incompleto ? 'Incompleto' : 'Recibido') : 'Pendiente'}</span>
              ${varias ? '' : (hay
                ? `${enlaces[archivos[0].id] ? `<a class="btn btn-ghost btn-sm" href="${h(enlaces[archivos[0].id])}" target="_blank" rel="noopener">Ver</a>` : ''}
                   <button class="btn btn-danger btn-sm" data-del="${h(archivos[0].id)}">Quitar</button>`
                : subir('completo', 'Subir'))}
            </div>
          </div>`;
        }).join('')}

        ${(porTipo.expediente_completo || []).length ? `
          <div class="form-sec" style="margin-top:20px">Copias generadas para el Colegio</div>
          <p class="t-muted" style="font-size:.76rem;margin:0 0 10px">
            Registro de lo que se ha enviado. No forman parte del checklist: son el expediente
            entero empaquetado, no un documento aportado por el cliente.
          </p>
          ${porTipo.expediente_completo.map(d => `<div class="doc-row ok">
            <div class="doc-ico">${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}</div>
            <div class="doc-info">
              <strong>${h(d.nombre_archivo)}</strong>
              <small>${h((d.mime || '').indexOf('pdf') !== -1 ? 'PDF' : 'HTML')} · ${KB(d.tamano)} · generado el ${fecha(d.created_at)}</small>
            </div>
            <div class="doc-actions">
              ${enlaces[d.id] ? `<a class="btn btn-ghost btn-sm" href="${h(enlaces[d.id])}" target="_blank" rel="noopener">Ver</a>` : ''}
              <button class="btn btn-danger btn-sm" data-del="${h(d.id)}">Quitar</button>
            </div>
          </div>`).join('')}` : ''}

        <p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
          Formatos admitidos: foto o escaneo (JPG, PNG) y PDF · máximo 10 MB por archivo.
          El <b>DNI</b>, el permiso y la ficha técnica admiten <b>varias caras</b>: se leen juntas como
          un solo documento. Se guardan en el bucket <b>privado</b>
          <span class="t-mono">gestotrafic-docs</span>: cada enlace se firma al abrirlo y caduca en
          1 hora. Solo el gestor del expediente (o un administrador) puede firmarlo.
        </p>
      </div>

      ${htmlExpedienteCompleto(tr, exp, aplicables, porTipo)}`;

    activarExpedienteCompleto(exp, tr, docs, cont);

    cont.querySelectorAll('input[type="file"]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB', 'err'); inp.value = ''; return; }

        inp.closest('.file-label').innerHTML = '<span class="spinner"></span>';
        try {
          await GTApi.subirDocumento(exp.id, inp.dataset.tipo, file, inp.dataset.cara);
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

  /* ---------- Expediente completo · HTML para el Colegio + PDF ---------- */

  /** Entrega un blob como archivo descargado, con su nombre y su tipo. */
  function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /* Los documentos van en el ORDEN del catálogo, que es el del expediente que
     se presenta: identidad, vehículo, negocio, representación y lo demás. Ese
     orden se envía a la Edge Function tal cual, para no tener dos listas que
     mantener sincronizadas. */
  const seccionesDe = (tr, exp) => T.docsDe(tr, exp)
    .filter(d => d.tipo !== 'expediente_completo')
    .map(d => ({ tipo: d.tipo, label: d.label, obligatorio: !!d.obligatorio }));

  function htmlExpedienteCompleto(tr, exp, aplicables, porTipo) {
    const secciones = aplicables.filter(d => d.tipo !== 'expediente_completo');
    const faltan = secciones.filter(d => !(porTipo[d.tipo] || []).length);
    const faltanObl = faltan.filter(d => d.obligatorio);
    const colegio = window.GT_COLEGIO();

    return `
      <div class="card" style="max-width:860px;margin-top:16px">
        <div class="card-t">Expediente completo para el Colegio</div>
        <p class="t-muted" style="font-size:.79rem;margin:0 0 14px">
          Reúne toda la documentación en <b>un solo documento</b>, en el orden del trámite:
          portada con los datos del expediente e índice, y detrás cada documento aportado.
          Sale en <b>HTML</b> —autocontenido, para el acceso de expedientes del Colegio— y en
          <b>PDF</b> para archivo o envío.
        </p>

        <div class="empresa-note" style="margin-bottom:14px">
          ${svg('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>')}
          <div>${colegio.nombre
            ? `Irá a nombre de <b>${h(colegio.nombre)}</b>${window.GT_CONFIG.GESTORIA.num_colegiado
                ? ' · colegiado nº ' + h(window.GT_CONFIG.GESTORIA.num_colegiado) : ''}.`
            : `<b>No hay Colegio configurado para ${h(colegio.provincia || 'esta provincia')}.</b>
               La portada lo dirá tal cual en vez de poner uno cualquiera: complétalo en
               <span class="t-mono">GT_COLEGIOS</span> (assets/js/config.js).`}</div>
        </div>

        ${faltan.length ? `<div class="regul-note" style="margin-bottom:14px">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div>Faltan ${faltan.length} documento${faltan.length === 1 ? '' : 's'}${faltanObl.length
            ? `, ${faltanObl.length} de ellos <b>obligatorio${faltanObl.length === 1 ? '' : 's'}</b>` : ''}:
            <b>${h(faltan.map(d => d.label).join(', '))}</b>.
            Se puede generar igual — constan como <b>pendientes</b> en el índice y no se inventa
            ninguna página por ellos.</div>
        </div>` : ''}

        <label class="flex" style="font-size:.8rem;color:var(--muted);margin-bottom:14px;cursor:pointer">
          <input type="checkbox" id="chk-guardar-exp" style="width:auto">
          Guardar una copia en el expediente (queda registro de lo que se envió)
        </label>

        <div class="row-actions">
          <button class="btn" data-generar="html">Generar y descargar HTML</button>
          <button class="btn btn-ghost" data-generar="pdf">Generar y descargar PDF</button>
        </div>

        <div id="exp-completo-salida"></div>

        <p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
          Se genera <b>en el servidor</b>: los documentos se leen del bucket privado con la clave de
          servicio y el archivo baja en la propia respuesta. <b>Sin guardar copia no se escribe nada</b>
          en el bucket. Marcando la casilla sí queda archivado, y esa copia se recupera con un enlace
          firmado que caduca en 1 hora.
        </p>
      </div>`;
  }

  function activarExpedienteCompleto(exp, tr, docs, cont) {
    const botones = cont.querySelectorAll('[data-generar]');
    if (!botones.length) return;
    const salida = cont.querySelector('#exp-completo-salida');

    botones.forEach(btn => {
      const formato = btn.dataset.generar;
      const etiqueta = btn.textContent;

      btn.addEventListener('click', async () => {
        const guardar = !!cont.querySelector('#chk-guardar-exp').checked;
        botones.forEach(b => { b.disabled = true; });
        btn.innerHTML = '<span class="spinner"></span> Reuniendo la documentación…';
        salida.innerHTML = '';

        try {
          /* El archivo llega en el cuerpo de la respuesta y se entrega tal
             cual: no hay enlace intermedio ni copia en el bucket que alguien
             tenga que ir a borrar luego. */
          const r = await GTApi.generarExpediente(exp.id, {
            formato: formato,
            tramite: tr.nombre,
            secciones: seccionesDe(tr, exp),
            gestoria: window.GT_CONFIG.GESTORIA,
            colegio: window.GT_COLEGIO(),
            guardar: guardar
          });

          descargarBlob(r.blob, r.nombre);

          const s = r.resumen || {};
          const incluidos = s.incluidos || [];
          const faltan = s.faltan || [];
          salida.innerHTML = `
            <div class="doc-row ok" style="margin-top:14px">
              <div class="doc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
              <div class="doc-info">
                <strong>${h(r.nombre)} · descargado</strong>
                <small>${incluidos.length} documento${incluidos.length === 1 ? '' : 's'} incluido${incluidos.length === 1 ? '' : 's'}${faltan.length
                  ? ` · ${faltan.length} pendiente${faltan.length === 1 ? '' : 's'} en el índice` : ''} ·
                  ${Math.round((r.blob.size || 0) / 1024)} KB</small>
              </div>
              <div class="doc-actions">
                <span class="badge badge-${s.guardado ? 'recibido' : 'pendiente'}">${s.guardado
                  ? 'Copia archivada' : 'Sin archivar'}</span>
              </div>
            </div>
            <p class="t-muted" style="font-size:.74rem;margin:8px 0 0">
              ${s.guardado
                ? 'La copia queda en el expediente, abajo en <b>Copias generadas</b>.'
                : 'No se ha guardado copia: el archivo no existe en ningún sitio salvo en tu descarga.'}
            </p>`;

          toast('Expediente completo descargado', 'ok');

          // Con copia guardada aparece una fila nueva: hay que repintar.
          if (s.guardado) {
            const nuevos = await GTApi.listarDocumentos(exp.id);
            docs.length = 0; nuevos.forEach(d => docs.push(d));
            panelDocs(exp, tr, docs, cont);
            return;
          }
        } catch (err) {
          toast(err.message || 'No se pudo generar', 'err');
        }

        botones.forEach(b => { b.disabled = false; });
        btn.textContent = etiqueta;
      });
    });
  }

  /* ---------- Panel: documento generado ---------- */
  function panelGenera(exp, tr, docs, cont) {
    const esContrato = tr.genera === 'contrato';
    const yaGuardado = esContrato && docs.some(d => d.tipo === 'contrato');
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
          ${esContrato && !T.esVendedorEmpresa(exp)
            ? `<button class="btn btn-ghost" id="btn-generar-guardar" ${yaGuardado ? 'disabled' : ''}>${yaGuardado
                ? 'Ya guardado en el expediente' : 'Guardar en el expediente'}</button>`
            : ''}
        </div>

        ${esContrato && !T.esVendedorEmpresa(exp) && !yaGuardado ? `
        <p class="t-muted" style="font-size:.76rem;margin:14px 0 0">
          Al pasar el expediente a <b>tramitación</b> esto se hace solo: si no hay contrato,
          se genera con los datos de arriba y se guarda en <b>Documentación</b>. La fecha que
          lleve el contrato es la que va al XML de OEGAM como <span class="t-mono">FECHA_CONTRATO</span>.
        </p>` : ''}

        <p class="t-muted" style="font-size:.76rem;margin-bottom:0;margin-top:16px">
          En la ventana del documento, usa <b>Imprimir → Guardar como PDF</b> para obtener el archivo firmable.
          El contrato es un <b>borrador</b>: lo revisan y lo firman las partes.
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

    const btnGuardar = cont.querySelector('#btn-generar-guardar');
    if (btnGuardar) btnGuardar.addEventListener('click', async () => {
      btnGuardar.disabled = true;
      btnGuardar.innerHTML = '<span class="spinner"></span> Guardando…';
      try {
        const hecho = await asegurarContrato(exp, tr, docs);
        toast(hecho ? 'Contrato guardado en el expediente' : 'El expediente ya tenía contrato', 'ok');
        panelGenera(exp, tr, docs, cont);
      } catch (err) {
        toast(err.message || 'No se pudo guardar el contrato', 'err');
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Guardar en el expediente';
      }
    });
  }

  /* ---------- Panel: exportar a OEGAM (XML del Colegio de Madrid) ----------
     El XML se arma ENTERO en el navegador: todos los datos que necesita ya
     están en el expediente cargado, así que no hay Edge Function, no se
     escribe en el bucket y no queda ningún huérfano que alguien tenga que
     ir a borrar. El archivo solo existe en la descarga del gestor. */
  /* Los campos de persona y domicilio que pide OEGAM salen del catálogo
     (`GTTramites.camposPersona`), que es EL MISMO que pinta el formulario del
     trámite. Declararlos una vez es lo que garantiza que el alta manual y el
     alta con Gest-IA rellenen exactamente lo mismo.

     Esta pestaña sigue existiendo porque es donde el informe dice qué falta:
     aquí se corrige lo que Gest-IA leyó mal con el XML delante. Lo que ya no
     hace es ser el ÚNICO sitio donde se pueden escribir. */

  function panelOegam(exp, tr, cont) {
    const r = GTOegam.construir(exp, { clientes: fichas });
    const exento = T.esExentoITP(exp);

    const filas = (lista) => lista.map(x => `
      <li><span class="t-mono">${h(x.tag)}</span> · ${h(x.motivo || x.etiqueta || '')}</li>`).join('');

    /* Un bloque de campos por parte. `camposPersona` los devuelve ya con el
       prefijo de la parte, que es exactamente la clave con la que viven en
       `datos` y con la que los guarda el formulario del trámite. */
    const bloquePersona = (prefijo, titulo) => `
      <div class="form-sec">${h(titulo)}</div>
      <div class="form-grid">
        ${T.camposPersona(prefijo).map(c => campoHTML(c, T.leer(exp, c.n))).join('')}
      </div>`;

    cont.innerHTML = `
      <div class="card" style="max-width:880px">
        <div class="card-t">Exportar a OEGAM · XML para el programa del Colegio</div>
        <p class="t-muted" style="font-size:.8rem;margin-top:0">
          Genera el fichero <b>FORMATO_GA</b> que se importa en el programa del
          <b>Colegio de Gestores de Madrid</b>, con los datos del expediente
          <span class="t-mono">${h(exp.referencia)}</span>. Es para <b>no reteclear</b>:
          el gestor revisa el XML, completa lo que falte y lo importa él.
        </p>

        <dl class="dl" style="margin:18px 0">
          <dt>Adquiriente</dt><dd>${h(exp.comprador_nombre || '—')}
            ${T.esCompradorEmpresa(exp) ? '<span class="badge badge-tramite">Empresa</span>' : ''}</dd>
          <dt>Transmitente</dt><dd>${h(exp.vendedor_nombre || '—')}
            ${T.esVendedorEmpresa(exp) ? '<span class="badge badge-tramite">Empresa</span>' : ''}</dd>
          <dt>Vehículo</dt><dd>${h([exp.marca, exp.modelo].filter(Boolean).join(' ') || '—')}
            · <span class="t-mono">${h(exp.matricula || 'sin matrícula')}</span></dd>
          <dt>Bastidor</dt><dd class="t-mono">${h(T.leer(exp, 'bastidor') || '—')}</dd>
          <dt>Fecha de contrato</dt><dd>${fecha(T.leer(exp, 'fecha_venta'))}</dd>
          <dt>ITP</dt><dd>MODELO_ITP <span class="t-mono">620</span> ·
            EXENTO_ITP <span class="t-mono">${exento ? 'SI' : 'NO'}</span>
            <small class="t-muted">(${exento
              ? 'lo marcó el gestor en la pestaña de ITP'
              : 'sin exención confirmada'})</small></dd>
          <dt>Importe liquidado</dt><dd>${itpCalculado(exp)
            ? `ITP <b>${exento ? 'exento' : eur(exp.itp_importe)}</b>
               · tasa DGT <b>${eur(exp.tasa_dgt)}</b>
               · total <b>${eur(exp.total_impuestos)}</b>`
            : '<span class="t-muted">pendiente de calcular en la pestaña de ITP</span>'}</dd>
        </dl>

        <p class="t-muted" style="font-size:.76rem;margin:-6px 0 18px">
          Ese importe <b>no viaja en el XML</b>, y no es un olvido:
          <span class="t-mono">FORMATO_GA</span> no tiene ningún campo de importe
          —solo <span class="t-mono">MODELO_ITP</span>,
          <span class="t-mono">EXENTO_ITP</span> y
          <span class="t-mono">NO_SUJETO_ITP</span>—, así que la cuota se
          autoliquida aparte. Se enseña aquí para cuadrarla antes de importar.
        </p>

        ${r.avisos.map(a => `<div class="regul-note" style="margin-bottom:14px">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div>${h(a.texto)}</div>
        </div>`).join('')}

        ${r.faltan.length ? `<div class="regul-note" style="margin-bottom:14px">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div><b>Faltan ${r.faltan.length} campo${r.faltan.length === 1 ? '' : 's'} obligatorio${r.faltan.length === 1 ? '' : 's'}</b>
            para que la importación sirva de algo:
            <b>${h(r.faltan.map(x => x.etiqueta).join(', '))}</b>.
            El XML se genera igual —con esos tags vacíos, no inventados—, pero
            complétalos antes de importarlo.</div>
        </div>` : ''}

        ${r.pendientes.length ? `<details class="gt-detalle">
          <summary><b>${r.pendientes.length} campos los completa el gestor</b>
            · van vacíos a propósito</summary>
          <ul style="margin:10px 0 0;padding-left:20px;line-height:1.7">
            ${filas(r.pendientes)}
          </ul>
        </details>` : ''}

        <details class="gt-detalle">
          <summary><b>${r.asignaOegam.length} campos los asigna OEGAM/DGT</b>
            · siempre vacíos</summary>
          <ul style="margin:10px 0 0;padding-left:20px;line-height:1.7">
            ${r.asignaOegam.map(t => `<li><span class="t-mono">${h(t)}</span></li>`).join('')}
          </ul>
          <p style="margin:10px 0 0">
            El número de documento y los códigos electrónicos los pone la
            plataforma al importar. GestoTrafic no los inventa.</p>
        </details>

        <details class="gt-detalle" ${r.faltan.length || r.pendientes.length > 3 ? 'open' : ''}>
          <summary><b>Datos de las personas</b> · lo que Gest-IA leyó de los DNI</summary>
          <form id="form-oegam" style="margin-top:12px">
            ${bloquePersona('comprador', 'Adquiriente · ' + (exp.comprador_nombre || 'comprador'))}
            ${bloquePersona('vendedor', 'Transmitente · ' + (exp.vendedor_nombre || 'vendedor'))}
            <div class="row-actions" style="margin-top:12px">
              <button type="submit" class="btn btn-sm" id="btn-oegam-guardar">Guardar estos datos</button>
            </div>
            <p style="margin:12px 0 0">
              Lo que no se leyó del DNI se queda en blanco: <b>en blanco se ve, y un dato
              aproximado no</b>. Complétalo mirando el documento, no de memoria.
            </p>
          </form>
        </details>

        <div class="row-actions">
          <button class="btn" id="btn-oegam">Exportar a OEGAM (XML)</button>
          <button class="btn btn-ghost" id="btn-oegam-ver">Ver el XML</button>
        </div>

        <div id="oegam-salida"></div>

        <p class="t-muted" style="font-size:.76rem;margin:16px 0 0">
          Se genera <b>en el navegador</b> y en <b>ISO-8859-1</b>, como pide el formato.
          No se guarda copia en ningún sitio: el archivo solo existe en tu descarga.
        </p>
      </div>`;

    cont.querySelector('#form-oegam').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const btn = form.querySelector('#btn-oegam-guardar');

      /* Todo esto vive en `datos` (jsonb): son campos sin columna propia, así
         que no hay migración que aplicar ni columna que se quede a medias. */
      const datos = Object.assign({}, exp.datos || {});
      ['comprador', 'vendedor'].forEach(p => T.camposPersona(p).forEach(c => {
        const el = form.querySelector('[name="' + c.n + '"]');
        if (!el) return;
        const v = (el.value || '').trim();
        if (v) datos[c.n] = v; else delete datos[c.n];
      }));

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Guardando…';
      try {
        await GTApi.actualizarExpediente(exp.id, { datos });
        exp.datos = datos;
        toast('Datos de OEGAM guardados', 'ok');
        panelOegam(exp, tr, cont);            // el informe se recalcula entero
      } catch (err) {
        toast(err.message || 'No se pudieron guardar', 'err');
        btn.disabled = false;
        btn.textContent = 'Guardar estos datos';
      }
    });

    cont.querySelector('#btn-oegam').addEventListener('click', () => {
      const salida = GTOegam.descargar(exp, { clientes: fichas });
      cont.querySelector('#oegam-salida').innerHTML = `
        <div class="doc-row ok" style="margin-top:14px">
          <div class="doc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
          <div class="doc-info">
            <strong>${h(salida.nombre)} · descargado</strong>
            <small>${Math.round(salida.bytes.length / 1024 * 10) / 10} KB · ISO-8859-1${salida.faltan.length
              ? ' · ' + salida.faltan.length + ' campo(s) obligatorio(s) vacío(s)' : ''}</small>
          </div>
        </div>
        ${salida.fueraLatin1.length ? `<div class="regul-note" style="margin-top:10px">
          ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
          <div>Estos caracteres no existen en ISO-8859-1 y se han sustituido por
            <span class="t-mono">?</span>: <b>${h(salida.fueraLatin1.join(' '))}</b>.
            Revísalos en el XML antes de importar.</div>
        </div>` : ''}`;
      toast('XML de OEGAM descargado', 'ok');
    });

    cont.querySelector('#btn-oegam-ver').addEventListener('click', () => {
      modal({
        titulo: 'XML OEGAM · ' + exp.referencia,
        ancho: 880,
        okTexto: 'Copiar al portapapeles',
        cuerpo: `<pre style="max-height:60vh;overflow:auto;font-size:.72rem;line-height:1.5;
          background:rgba(0,0,0,.25);padding:14px;border-radius:8px;white-space:pre">${h(r.xml)}</pre>`,
        onOk: async () => {
          /* Al portapapeles va el TEXTO. El archivo en ISO-8859-1 es el del
             botón de descarga: un pegado en un editor cualquiera lo
             guardaría en UTF-8 y los acentos se importarían mal. */
          await navigator.clipboard.writeText(r.xml);
          toast('XML copiado · ojo: el archivo válido es el de la descarga', 'ok');
        }
      });
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

    /* Aquí el expediente todavía no existe, así que el checklist no puede
       leer de él si el vendedor es empresa: hay que preguntarlo ANTES. Sin
       esta pregunta la lista salía siempre en modo particular y pedía el
       DNI del vendedor incluso vendiendo un concesionario, que factura. */
    const camposTipo = T.camposTipoParte(tr);
    const tipos = {};
    camposTipo.forEach(c => { tipos[c.n] = c.def || 'particular'; });
    const docsAplicables = () => T.docsDe(tr, { datos: tipos }).filter(d => d.tipo !== 'otros');

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
              <div>Gest-IA <b>propone los tres</b> y calcula el ITP sola: el <b>tipo</b> de la
                clasificación de la ficha técnica, la <b>CCAA</b> del domicilio del comprador
                —está en el reverso de su DNI— y el <b>valor BOE</b> de la tabla del Anexo I.
                Todo queda como <b>propuesta pendiente de tu validación</b>. Lo que no lea con
                seguridad se queda en blanco y te lo dice; y si encajan <b>varias versiones</b>
                del modelo <b>no elige ninguna</b> — eso lo fijas tú, que entre dos puede haber
                mil euros. Rellena algo aquí solo si quieres imponerlo.</div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="f-tipo-ia">Tipo de vehículo</label>
                <select id="f-tipo-ia" name="tipo_vehiculo">
                  <option value="">— que lo proponga Gest-IA —</option>
                  ${window.GT_TIPOS_VEHICULO.map(t => `<option value="${h(t.id)}">${h(t.label)}</option>`).join('')}
                </select>
                <small class="field-hint">Sale del campo «clasificación» de la ficha técnica.</small>
              </div>
              <div class="field">
                <label for="f-ccaa-ia">CCAA del comprador</label>
                <select id="f-ccaa-ia" name="ccaa">
                  <option value="">— que la proponga Gest-IA —</option>
                  ${window.GT_CCAA.map(c => `<option>${h(c)}</option>`).join('')}
                </select>
                <small class="field-hint">Sale de la provincia del domicilio del comprador.</small>
              </div>
              <div class="field">
                <label for="f-boe-ia">Valor BOE Anexo I (€) <span class="t-muted" style="font-weight:400">· opcional</span></label>
                <input type="number" step="0.01" min="0" id="f-boe-ia" name="valor_boe"
                       placeholder="lo propone Gest-IA">
                <small class="field-hint">Si lo rellenas, manda sobre lo que proponga Gest-IA.</small>
              </div>
            </div>` : ''}

          ${camposTipo.length ? `
            <div class="form-sec">Partes de la operación</div>
            <p class="t-muted" style="font-size:.79rem;margin:0 0 14px">
              Decide qué documentos se piden: una <b>empresa</b> se identifica con su
              <b>CIF</b> y documenta la venta con <b>factura</b>; un <b>particular</b>, con
              su <b>DNI / NIE</b> y un contrato de compraventa.
            </p>
            <div class="form-grid" id="ia-partes">
              ${camposTipo.map(c => campoHTML(Object.assign({}, c, { full: 0 }), null)).join('')}
            </div>` : ''}

          <div class="form-sec">Documentos del trámite</div>
          <p class="t-muted" style="font-size:.79rem;margin:0 0 14px">
            Sube los que tengas. Gest-IA lee foto o escaneo (JPG, PNG) y PDF, máximo 10 MB por archivo.
            Los que falten los rellena el gestor a mano.
          </p>

          <div id="ia-docs"></div>
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
      cuenta.textContent = n + ' archivo' + (n === 1 ? '' : 's');
      btn.disabled = n === 0;
    };

    const nombreArchivo = (f) => f.name + ' · ' + Math.round(f.size / 1024) + ' KB';

    /* Un documento puede traer varias caras, así que la clave de `elegidos`
       es tipo + cara. `completo` es el documento entero en un archivo. */
    const clave = (tipo, cara) => tipo + '|' + (cara || 'completo');
    const archivosDe = (tipo) => Object.keys(elegidos)
      .filter(k => k.slice(0, k.indexOf('|')) === tipo)
      .map(k => ({ cara: k.slice(k.indexOf('|') + 1), file: elegidos[k] }));

    /** Repinta la lista con los documentos que pide el trámite AHORA. */
    function pintarDocs() {
      const cont = view.querySelector('#ia-docs');
      const aplicables = docsAplicables();

      /* Si una parte pasa a empresa, su DNI deja de pedirse: también se
         suelta el archivo. Subir el documento de un tipo que el expediente
         ya no reclama solo sirve para descuadrar el checklist. */
      Object.keys(elegidos).forEach(k => {
        const tipo = k.slice(0, k.indexOf('|'));
        if (!aplicables.some(d => d.tipo === tipo)) delete elegidos[k];
      });

      cont.innerHTML = aplicables.map(d => {
        const varias = T.admiteVariasCaras(d);
        const elegir = (cara, texto) => `<label class="file-label">${h(texto)}<input type="file"
          accept="image/*,application/pdf" data-tipo="${h(d.tipo)}" data-cara="${h(cara)}"></label>`;

        return `
        <div class="doc-row ${varias ? 'doc-row-caras' : ''}" data-doc="${h(d.tipo)}">
          <div class="doc-ico">${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')}</div>
          <div class="doc-info">
            <strong>${h(d.label)} ${d.obligatorio ? '' : '<span class="t-muted" style="font-weight:400;font-size:.74rem">· opcional</span>'}</strong>
            <small data-nombre>${varias ? 'Las dos caras por separado, o un archivo con todo' : 'Sin archivo'}</small>
            ${varias ? `<div data-caras></div>
              <div class="doc-subidas">
                ${d.caras.map(c => elegir(c.id, c.label)).join('')}
                ${elegir('completo', 'Documento completo')}
              </div>` : ''}
          </div>
          ${varias ? '' : `<div class="doc-actions">${elegir('completo', 'Elegir')}</div>`}
        </div>`;
      }).join('');

      // Los archivos que siguen valiendo se conservan al repintar.
      aplicables.forEach(d => {
        const fila = cont.querySelector(`[data-doc="${d.tipo}"]`);
        const archivos = archivosDe(d.tipo);
        if (!archivos.length) return;
        fila.classList.add('ok');

        if (!T.admiteVariasCaras(d)) {
          fila.querySelector('[data-nombre]').textContent = nombreArchivo(archivos[0].file);
          return;
        }
        fila.querySelector('[data-nombre]').textContent = resumenCaras(d, archivos) || '';
        fila.querySelector('[data-caras]').innerHTML = archivos.map(a =>
          `<div class="doc-cara">
             <span class="doc-cara-l">${h(T.etiquetaCara(d, a.cara))}</span>
             <span class="doc-cara-n">${h(nombreArchivo(a.file))}</span>
           </div>`).join('');
      });

      cont.querySelectorAll('input[type="file"]').forEach(inp => {
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB', 'err'); inp.value = ''; return; }
          const cara = inp.dataset.cara || 'completo';
          /* O las caras sueltas, o el archivo con todo: son la misma cosa
             contada de dos maneras, y tenerlas a la vez solo duplica papel. */
          if (cara === 'completo') {
            archivosDe(inp.dataset.tipo).forEach(a => { delete elegidos[clave(inp.dataset.tipo, a.cara)]; });
          } else {
            delete elegidos[clave(inp.dataset.tipo, 'completo')];
          }
          elegidos[clave(inp.dataset.tipo, cara)] = f;
          pintarDocs();                          // repinta: cambian las caras que faltan
        });
      });

      refrescar();
    }

    view.querySelectorAll('#ia-partes select').forEach(sel => {
      sel.addEventListener('change', () => { tipos[sel.name] = sel.value; pintarDocs(); });
    });
    pintarDocs();

    btn.addEventListener('click', () => lanzarGestIA(tr, elegidos, {
      cliente_id: val(view, 'cliente_id'),
      valor_boe: view.querySelector('#f-boe-ia') ? num(view, 'valor_boe') : null,
      ccaa: view.querySelector('#f-ccaa-ia') ? val(view, 'ccaa') : null,
      tipo_vehiculo: view.querySelector('#f-tipo-ia') ? val(view, 'tipo_vehiculo') : null,
      // Lo que el gestor ya ha decidido nace con el expediente: no es un dato
      // que Gest-IA tenga que adivinar de ningún documento.
      datos: Object.assign({}, tipos)
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

  /** Crear expediente → subir → leer con IA → volcar propuestas → calcular ITP.
      `archivos` viene indexado por `tipo|cara`: un mismo tipo puede traer dos
      archivos (anverso y reverso), que se suben por separado y los lee juntos
      la Edge Function. */
  async function lanzarGestIA(tr, archivos, extra) {
    const claves = Object.keys(archivos);
    const pasos = [
      'Creando el expediente…',
      'Subiendo ' + claves.length + ' archivo' + (claves.length === 1 ? '' : 's') + '…',
      'Gest-IA está leyendo los documentos…',
      'Montando el expediente…',
      'Calculando el ITP con lo propuesto…'
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
        datos: Object.assign({}, extra.datos || {})
      });

      paso(1);
      const subidos = [];
      for (const k of claves) {
        const tipo = k.slice(0, k.indexOf('|'));
        const cara = k.slice(k.indexOf('|') + 1);
        const archivo = await GTApi.subirArchivo(exp.id, tipo, archivos[k], cara);
        await GTApi.registrarDocumento(exp.id, tipo, archivo);
        /* La cara viaja con el archivo: el DNI se lee en dos pasadas (anverso y
           reverso) y así cada una recibe solo su cara en vez de las dos. Sin
           este dato la lectura sale igual, solo cuesta el doble de imágenes. */
        subidos.push({ tipo: tipo, storage_path: archivo.path, cara: cara });
      }

      paso(2);
      const lectura = await GTApi.analizarDocumentos(exp.id, subidos);

      paso(3);
      const props = GTGestIA.propuestas(tr, lectura.documentos);
      // `datos` arrastra lo que decidió el gestor (quién vende, quién compra):
      // aExpediente escribe encima las propuestas, no las borra.
      const cambios = GTGestIA.aExpediente(tr, props, extra.datos || {});
      // Lo que ya aportó el gestor no cuenta como hueco de la IA.
      const yaPuestos = { valor_boe: extra.valor_boe, ccaa: extra.ccaa };
      cambios.ia_extraccion = {
        propuestas: props,
        documentos: lectura.documentos,
        huecos: GTGestIA.huecos(tr, props).filter(x => !yaPuestos[x.campo]),
        // Una cara que falta no es un dato ilegible: se arregla subiéndola.
        avisos_caras: GTGestIA.avisosCaras(tr, lectura.documentos),
        analizado_at: new Date().toISOString()
      };
      cambios.ia_modelo = lectura.modelo;
      await GTApi.actualizarExpediente(exp.id, cambios);

      /* 4 · El ITP, de punta a punta.
         Lo que el gestor haya fijado a mano manda siempre; lo que no, lo
         propone Gest-IA. Nada de esto queda confirmado: el expediente sigue
         en `pendiente_validacion` hasta que una persona lo valide. */
      if (tr.calculo !== 'itp') {
        await terminarGestIA(exp, cambios.ia_extraccion, []);
        return;
      }

      const tipo = extra.tipo_vehiculo || (props.tipo_vehiculo || {}).valor || null;
      const ccaa = extra.ccaa || cambios.ccaa || null;
      const faltan = [];

      // Sin tipo no se sabe en qué tabla del Anexo I buscar, y no se supone.
      if (!tipo) faltan.push('el tipo de vehículo (la ficha técnica no lo dice con claridad)');
      if (!ccaa) faltan.push('la CCAA del comprador (no se leyó su provincia)');
      if (!cambios.fecha_matriculacion) faltan.push('la fecha de 1ª matriculación');

      let vb = null;
      if (tipo && !extra.valor_boe) {
        try {
          vb = await GTApi.proponerValorBase({
            tipo_vehiculo: tipo,
            marca: cambios.marca || null,
            modelo: cambios.modelo || null,
            fecha_matriculacion: cambios.fecha_matriculacion || null,
            cilindrada: cambios.cilindrada || null,
            combustible: cambios.combustible || null
          });
        } catch (e) {
          // Que falle la propuesta no tumba el alta: queda el campo manual.
          console.warn('Gest-IA: no se pudo consultar el Anexo I', e);
        }
      }

      /* Varias versiones con precios distintos: aquí Gest-IA NO elige. Es la
         regla de la casa y no se negocia — entre dos versiones del mismo
         modelo puede haber mil euros, y acertar por sorteo no es acertar.
         Se lleva al gestor a la pantalla donde fija la versión, con todo lo
         demás ya propuesto. */
      if (vb && vb.estado === 'varios') {
        await confirmarValorBase(tr, exp, cambios, Object.assign({}, extra, { tipo_vehiculo: tipo, ccaa }), vb);
        return;
      }

      // Base del cálculo: el importe del gestor, o la única fila que encajó.
      let base = null;
      if (extra.valor_boe) {
        base = { valor_boe: extra.valor_boe, tipo_vehiculo: tipo === 'autocaravana' ? 'autocaravana' : 'coche' };
      } else if (vb && vb.estado === 'propuesta' && (vb.candidatos || []).length === 1) {
        base = { valor_base_id: vb.candidatos[0].id, tipo_vehiculo: tipo };
      } else {
        faltan.push(vb && vb.estado === 'sin_match'
          ? 'el valor base: ningún precio medio del Anexo I encaja con lo leído'
          : 'el valor base del Anexo I');
      }

      if (base && !faltan.length) {
        paso(4);
        const r = await calcularYGuardarITP(exp, cambios, Object.assign({}, extra, { ccaa }), base);
        await terminarGestIA(exp, cambios.ia_extraccion,
          r ? [] : ['el cálculo del ITP falló: revísalo en el expediente'],
          r ? 'ITP propuesto · ' + exp.referencia + ' pendiente de validación' : null);
        return;
      }

      /* No se puede calcular, pero el valor base sí se encontró: se deja
         puesto. Que falte la CCAA no es motivo para tirar un dato bueno y
         hacer que el gestor vuelva a buscar la versión a mano. */
      if (base && base.valor_base_id && vb.candidatos[0].valor_base) {
        try {
          await GTApi.actualizarExpediente(exp.id, { valor_boe: vb.candidatos[0].valor_base });
        } catch (e) { /* el campo se rellena a mano; no bloquea el alta */ }
      }

      await terminarGestIA(exp, cambios.ia_extraccion, faltan);

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

  /**
   * Cierra el alta y lleva al expediente.
   *
   * `faltan` son las piezas que Gest-IA no ha podido poner. Se guardan en el
   * expediente para que el banner las enseñe: no calcular a medias está bien,
   * pero solo si se dice exactamente qué falta y dónde arreglarlo.
   */
  async function terminarGestIA(exp, ia, faltan, mensaje) {
    if (faltan && faltan.length) {
      /* Se reescribe la extracción ENTERA con lo pendiente añadido. Guardar
         solo `pendientes_itp` borraría las propuestas y los huecos, que es
         justo lo que el gestor necesita para validar. */
      const completa = Object.assign({}, ia || {}, { pendientes_itp: faltan });
      try { await GTApi.actualizarExpediente(exp.id, { ia_extraccion: completa }); } catch (e) { /* no bloquea el alta */ }
    }
    toast(mensaje || ('Gest-IA montó ' + exp.referencia + ' · pendiente de validación'), 'ok');
    location.hash = '#/expedientes/' + exp.id;
  }

  /* Calcula el ITP y lo guarda. `base` fija de dónde sale el valor: un
     importe manual (`valor_boe`) o una fila del Anexo I (`valor_base_id`).
     Nunca las dos: si van las dos, el motor respeta el manual y no consulta
     la tabla. */
  async function calcularYGuardarITP(exp, cambios, extra, base) {
    try {
      const r = await GTApi.calcularITP(Object.assign({
        precio_contrato: cambios.precio_contrato || null,
        fecha_matriculacion: cambios.fecha_matriculacion,
        fecha_transmision: new Date().toISOString().slice(0, 10),
        ccaa: extra.ccaa || 'Comunidad de Madrid',
        cilindrada: cambios.cilindrada || null,
        cvf: cambios.cvf || null,
        etiqueta_dgt: cambios.etiqueta_dgt || '',
        uso_especial: false,
        tipo_vehiculo: base.tipo_vehiculo || 'coche'
      }, base));

      await GTApi.actualizarExpediente(exp.id, {
        valor_boe: r.detalle ? r.detalle.valor_boe : (base.valor_boe || null),
        valor_venal: r.valor_venal, base_imponible: r.base_imponible,
        itp_importe: r.itp, tasa_dgt: r.tasa_dgt, total_impuestos: r.total_impuestos,
        calculo_json: r, calculado_at: new Date().toISOString()
      });
      return r;
    } catch (e) {
      console.warn('Gest-IA: no se pudo calcular el ITP', e);
      return null;
    }
  }

  /* Pantalla intermedia del alta con Gest-IA: la IA ha encontrado precio(s) en
     el Anexo I y hace falta que una persona diga cuál. Con una sola fila viene
     preseleccionada como propuesta; con varias NO se selecciona ninguna. */
  async function confirmarValorBase(tr, exp, cambios, extra, vb) {
    const unica = vb.estado === 'propuesta';
    const cands = vb.candidatos || [];
    const porTramo = vb.criterio === 'tramo';

    const etiqueta = (c) => porTramo
      ? `${c.tramo_etiqueta} — ${eur(c.valor_base)}`
      : `${c.denominacion} — ${[c.periodo_desde ? c.periodo_desde + (c.periodo_hasta ? '-' + c.periodo_hasta : '→') : null,
            c.cilindrada ? c.cilindrada + 'cc' : null, c.combustible,
            c.potencia_kw ? c.potencia_kw + 'kW' : null].filter(Boolean).join(' · ')} — ${eur(c.valor_base)}`;

    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <h1 style="margin-top:6px">${svg(ICO_IA, 'h1-ico')} Confirma el valor base</h1>
          <p>${h(exp.referencia)} · Gest-IA ya leyó los documentos. Falta que fijes la versión.</p>
        </div>
      </div>

      <div class="stack" style="max-width:820px">
        <div class="card">
          <div class="card-t">Lo que leyó Gest-IA</div>
          <dl class="dl">
            <dt>Marca / modelo</dt><dd>${h([cambios.marca, cambios.modelo].filter(Boolean).join(' ') || '—')}</dd>
            <dt>1ª matriculación</dt><dd>${fecha(cambios.fecha_matriculacion)}</dd>
            <dt>Cilindrada</dt><dd>${cambios.cilindrada ? h(cambios.cilindrada) + ' c.c.' : '—'}</dd>
            <dt>Combustible</dt><dd>${h(cambios.combustible || '—')}</dd>
            <dt>Tipo de vehículo</dt><dd>${h((window.GT_TIPOS_VEHICULO
              .find(t => t.id === (extra.tipo_vehiculo || 'coche')) || {}).label || '—')}
              <span class="t-muted" style="font-size:.76rem">· lo indicaste tú</span></dd>
          </dl>

          <div class="form-sec" style="margin-top:18px">Precio medio del Anexo I</div>
          ${unica
            ? `<div class="boe-propuesta">
                 ${svg('<path d="M12 2l2.4 6.9H22l-6 4.3 2.3 6.8-6.3-4.4-6.3 4.4L8 13.2l-6-4.3h7.6z"/>')}
                 <div>Gest-IA propone <b>una única coincidencia</b>${porTramo
                   ? ' por tramo de cilindrada: en motos y quads el Anexo I no tiene versiones que elegir.'
                   : `, filtrando ${vb.del_modelo} versiones del modelo por lo que leyó de la ficha.`}
                   Revísala y confírmala.</div>
               </div>`
            : `<div class="boe-propuesta sin-match">
                 ${svg('<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}
                 <div>Encajan <b>${vb.total} versiones</b> con <b>precios distintos</b>
                   (de las ${vb.del_modelo} del modelo). <b>Gest-IA no elige</b>: mira los kW y el
                   acabado en la ficha técnica y elige tú.
                   ${vb.palabras_usadas < vb.palabras_leidas
                     ? ' Ojo: ninguna versión llevaba todas las palabras del modelo leído, así que la lista es más amplia.' : ''}
                   ${vb.recortado
                     ? ` Se muestran ${cands.length} de ${vb.total}: si ninguna es, usa el valor manual.` : ''}</div>
               </div>`}

          <div class="field">
            <label for="f-vb">Versión del Anexo I</label>
            <select id="f-vb">
              <option value="">— elige la versión —</option>
              ${cands.map(c => `<option value="${h(c.id)}" ${unica ? 'selected' : ''}>${h(etiqueta(c))}</option>`).join('')}
            </select>
          </div>

          <div class="field">
            <label for="f-vb-manual">…o introduce el valor base a mano (€)</label>
            <input type="number" step="0.01" min="0" id="f-vb-manual" placeholder="21000">
            <small class="field-hint">Si escribes un importe, manda sobre la versión elegida.</small>
          </div>
        </div>

        <div class="regul-note">
          ${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')}
          <div>El expediente <b>${h(exp.referencia)}</b> ya está creado y <b>pendiente de
            validación</b>. Puedes saltarte este paso: el valor base queda vacío y lo rellenas
            luego en la calculadora del expediente.</div>
        </div>

        <div class="flex">
          <button class="btn" id="btn-vb">Confirmar y calcular ITP</button>
          <button class="btn btn-ghost" id="btn-vb-saltar">Seguir sin valor base</button>
        </div>
      </div>
      ${footer()}`;

    const irAlExpediente = (msg, tono) => {
      toast(msg, tono || 'ok');
      location.hash = '#/expedientes/' + exp.id;
    };

    view.querySelector('#btn-vb-saltar').addEventListener('click', () =>
      irAlExpediente('Gest-IA montó ' + exp.referencia + ' · falta el valor base', 'ok'));

    view.querySelector('#btn-vb').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const manual = Number(view.querySelector('#f-vb-manual').value) || null;
      const id = view.querySelector('#f-vb').value || null;
      if (!manual && !id) { toast('Elige una versión o escribe el valor base', 'err'); return; }
      if (!cambios.fecha_matriculacion) {
        irAlExpediente('Falta la fecha de matriculación: completa el ITP en el expediente', 'err');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      const r = await calcularYGuardarITP(exp, cambios, extra, manual
        ? { valor_boe: manual, tipo_vehiculo: vb.tipo_vehiculo === 'autocaravana' ? 'autocaravana' : 'coche' }
        : { valor_base_id: id, tipo_vehiculo: vb.tipo_vehiculo === 'turismo' ? 'coche' : vb.tipo_vehiculo });

      irAlExpediente(r
        ? 'ITP calculado · ' + exp.referencia + ' pendiente de validación'
        : 'No se pudo calcular el ITP: revísalo en el expediente', r ? 'ok' : 'err');
    });
  }

  /* ============================================================
     VISTA · CALCULADORA ITP (herramienta suelta)
     ------------------------------------------------------------
     Consulta rápida, sin expediente: sirve para comprobar la cuota
     antes de tramitar. No guarda nada.

     No reimplementa el cálculo: manda los mismos datos al motor
     `gestotrafic-itp` que el panel del expediente, y usa el mismo
     buscador del Anexo I. Si aquí saliera otra cifra que en el
     expediente, sería un error.
     ============================================================ */
  async function vistaCalculadoraITP() {
    view.innerHTML = `
      ${cabecera()}
      <div class="page-head">
        <div>
          <h1>Calculadora ITP</h1>
          <p>Consulta rápida del impuesto y la tasa DGT. No crea expediente ni guarda nada.</p>
        </div>
        <span class="badge badge-completado" style="font-size:.62rem;align-self:center">Orden HAC/1501/2025</span>
      </div>

      <div class="detail-grid">
        <div class="itp-panel">
          <div class="form-grid">
            <div class="field">
              <label for="c-tipo">Tipo de vehículo</label>
              <select name="tipo_vehiculo" id="c-tipo">
                ${window.GT_TIPOS_VEHICULO.map(t => `<option value="${h(t.id)}">${h(t.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field hidden" data-solo-kw>
              <label>Potencia (kW)</label>
              <input name="potencia_kw" type="number" step="0.01" min="0" placeholder="11">
            </div>
            <div class="field" data-campo-boe>
              <label>Valor BOE Anexo I (€) *<span class="boe-sello hidden" data-sello-boe></span></label>
              <input name="valor_boe" type="number" step="0.01" min="0" placeholder="21000">
            </div>
          </div>

          ${htmlBuscadorBoe(true)}

          <div class="form-grid">
            <div class="field">
              <label>Fecha 1ª matriculación *</label>
              <input name="fecha_matriculacion" type="date">
            </div>
            <div class="field">
              <label>CCAA del comprador</label>
              <select name="ccaa">${window.GT_CCAA.map(c =>
                `<option ${c === 'Comunidad de Madrid' ? 'selected' : ''}>${h(c)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Precio de contrato (€)</label>
              <input name="precio_contrato" type="number" step="0.01" min="0" placeholder="8500">
            </div>
            <div class="field">
              <label>Cilindrada (c.c.)</label>
              <input name="cilindrada" type="number" min="0">
            </div>
            <div class="field">
              <label>Potencia fiscal (CVf)</label>
              <input name="cvf" type="number" step="0.01" min="0">
            </div>
            <div class="field">
              <label>Etiqueta DGT</label>
              <select name="etiqueta_dgt">${window.GT_ETIQUETAS.map(e =>
                `<option value="${h(e.id)}">${h(e.label)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Uso especial (taxi / autoescuela / alquiler)</label>
              <select name="uso_especial">
                <option value="no">No · base al 100%</option>
                <option value="si">Sí · reducción del 70%</option>
              </select>
            </div>
          </div>

          <button class="btn btn-full" id="c-calcular" style="margin-top:6px">Calcular</button>

          <div class="itp-out">
            <div class="itp-cell"><div class="itp-cell-num" id="c-r-venal">—</div><div class="itp-cell-lbl">Valor venal</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-r-itp">—</div><div class="itp-cell-lbl">ITP</div></div>
            <div class="itp-cell"><div class="itp-cell-num" id="c-r-dgt">—</div><div class="itp-cell-lbl">Tasa DGT</div></div>
            <div class="itp-cell total"><div class="itp-cell-num" id="c-r-total">—</div><div class="itp-cell-lbl">Total</div></div>
          </div>
          <div class="itp-detail" id="c-detalle">Elige el vehículo y pulsa <b>Calcular</b>.</div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-t">Cómo se calcula</div>
            <p class="t-muted" style="font-size:.8rem;line-height:1.6;margin:0">
              Precio medio del <b>Anexo I</b> × depreciación del <b>Anexo IV</b> según los años
              de uso = <b>valor venal</b>. La base imponible es el mayor entre ese valor y el
              precio de contrato. Sobre ella, el tipo de la CCAA, su cuota fija o su exención.
              Lo resuelve el motor <span class="t-mono">gestotrafic-itp</span>, el mismo del
              expediente.
            </p>
          </div>
          ${avisoRegulado()}
        </div>
      </div>
      ${footer()}`;

    const selTipo  = view.querySelector('#c-tipo');
    const campoBoe = view.querySelector('[data-campo-boe]');
    const inputBoe = campoBoe.querySelector('input');
    const selloBoe = view.querySelector('[data-sello-boe]');
    const campoKw  = view.querySelector('[data-solo-kw]');
    const cajaBuscador = view.querySelector('[data-buscador-boe]');
    let valorBaseId = null;

    const buscador = crearBuscadorBoe({
      raiz: cajaBuscador,
      tipoBoe: () => {
        const def = window.GT_TIPOS_VEHICULO.find(t => t.id === selTipo.value);
        return (def && def.boe) || 'turismo';
      },
      fechaMat: () => val(view, 'fecha_matriculacion'),
      sugerencia: null,       // aquí no hay expediente del que partir
      onCambio: (fila) => {
        valorBaseId = fila ? fila.id : null;
        if (fila) {
          inputBoe.value = fila.valor_base_euros;
          // La ficha técnica de la fila ahorra teclear lo que afecta al tipo.
          if (fila.cilindrada && !val(view, 'cilindrada')) {
            view.querySelector('[name=cilindrada]').value = fila.cilindrada;
          }
          if (fila.cvf && !val(view, 'cvf')) view.querySelector('[name=cvf]').value = fila.cvf;
        }
        sincronizar();
      }
    });

    function sincronizar() {
      const def = window.GT_TIPOS_VEHICULO.find(t => t.id === selTipo.value) || window.GT_TIPOS_VEHICULO[0];
      const porModelo = def.por === 'marca_modelo';
      campoKw.classList.toggle('hidden', def.por !== 'kw');
      cajaBuscador.classList.toggle('hidden', !porModelo);

      const desdeTabla = def.auto || (porModelo && valorBaseId);
      inputBoe.readOnly = !!desdeTabla;
      campoBoe.classList.toggle('boe-auto', !!desdeTabla);
      selloBoe.classList.toggle('hidden', !desdeTabla);

      if (def.auto) {
        selloBoe.textContent = 'automático';
        inputBoe.placeholder = def.por === 'kw' ? 'lo calcula por kW' : 'lo calcula por cilindrada';
      } else if (porModelo && valorBaseId) {
        selloBoe.textContent = 'Anexo I · versión elegida';
      } else {
        inputBoe.placeholder = porModelo ? 'elige la versión o escríbelo' : '21000';
      }

      if (porModelo) buscador.sincronizar();
    }
    selTipo.addEventListener('change', () => { valorBaseId = null; sincronizar(); });
    sincronizar();

    view.querySelector('#c-calcular').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const tipoVeh = val(view, 'tipo_vehiculo') || 'coche';
      const def = window.GT_TIPOS_VEHICULO.find(t => t.id === tipoVeh) || {};
      const desdeTabla = def.auto || (def.por === 'marca_modelo' && valorBaseId);

      const payload = {
        // Con valor de tabla NO se manda el manual: el motor respetaría el
        // manual y no llegaría a consultar la tabla.
        valor_boe: desdeTabla ? null : num(view, 'valor_boe'),
        valor_base_id: valorBaseId || null,
        tipo_vehiculo: tipoVeh,
        potencia_kw: num(view, 'potencia_kw'),
        precio_contrato: num(view, 'precio_contrato'),
        fecha_matriculacion: val(view, 'fecha_matriculacion'),
        fecha_transmision: new Date().toISOString().slice(0, 10),
        ccaa: val(view, 'ccaa'),
        cilindrada: num(view, 'cilindrada'),
        cvf: num(view, 'cvf'),
        etiqueta_dgt: val(view, 'etiqueta_dgt'),
        uso_especial: val(view, 'uso_especial') === 'si'
      };

      if (!payload.fecha_matriculacion) { toast('Falta la fecha de matriculación', 'err'); return; }
      if (!desdeTabla && !payload.valor_boe) {
        toast('Elige la versión en el Anexo I o escribe el valor base', 'err'); return;
      }
      if (def.auto && !payload.cilindrada && !payload.potencia_kw) {
        toast('Falta la cilindrada (o los kW en eléctricas)', 'err'); return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await GTApi.calcularITP(payload);
        if (desdeTabla) {
          inputBoe.value = r.detalle.valor_boe;
          const fila = r.detalle.valor_base_fila;
          if (fila && fila.tramo_etiqueta) selloBoe.textContent = fila.tramo_etiqueta;
        }
        view.querySelector('#c-r-venal').textContent = eur(r.valor_venal);
        view.querySelector('#c-r-itp').textContent   = eur(r.itp);
        view.querySelector('#c-r-dgt').textContent   = eur(r.tasa_dgt);
        view.querySelector('#c-r-total').textContent = eur(r.total_impuestos);
        view.querySelector('#c-detalle').innerHTML   = detalleTexto(r);
      } catch (err) {
        view.querySelector('#c-detalle').innerHTML =
          `<span style="color:var(--danger)">${h(err.message || 'No se pudo calcular')}</span>`;
        toast(err.message || 'No se pudo calcular', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Calcular';
      }
    });
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
          await vistaExpedientes(params.get('q'));
        }
      } else if (seccion === 'calculadora') {
        await vistaCalculadoraITP();
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
