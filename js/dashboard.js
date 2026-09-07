'use strict';

// Dashboard de proveedores (reconstrucción nativa del módulo heredado, más
// optimizado): el cálculo pesado (facturas + pagos + ventas del año por
// proveedor) lo hace una función Postgres; aquí solo se presenta.
(function () {
  const API = '/api/purchases/v2/dashboard/providers';

  const BUCKETS = [
    { key: 'alDia', label: 'Al día o por vencer', color: '#177a44' },
    { key: 'normal', label: 'Seguimiento · 1 a 21 días', color: '#175cd3' },
    { key: 'atencion', label: 'Atención · 22 a 45 días', color: '#b7791f' },
    { key: 'alta', label: 'Alta prioridad · 46 a 60 días', color: '#c2410c' },
    { key: 'critica', label: 'Crítico · 61 a 90 días', color: '#b42318' },
    { key: 'riesgo', label: 'Riesgo · más de 90 días', color: '#7a1410' }
  ];

  const state = { bound: false, loading: false, year: null, data: null };

  const el = (id) => document.getElementById(id);
  const money = (value) => window.app.formatCurrency(Number(value) || 0);
  const num = (value) => Number(value) || 0;

  function priority(dias) {
    if (dias <= 0) return { key: 'al-dia', label: 'Al día', order: 1 };
    if (dias <= 21) return { key: 'seguimiento', label: 'Seguimiento', order: 2 };
    if (dias <= 45) return { key: 'atencion', label: 'Atención', order: 3 };
    if (dias <= 60) return { key: 'alta', label: 'Alta', order: 4 };
    if (dias <= 90) return { key: 'critica', label: 'Crítica', order: 5 };
    return { key: 'riesgo', label: 'Riesgo', order: 6 };
  }

  function score(p) {
    return priority(num(p.max_atraso)).order * 1e6
      + num(p.saldo_vencido) * 100
      + num(p.facturas_vencidas) * 1000
      + num(p.saldo_pendiente);
  }

  function bucketOf(key) {
    return (state.data?.buckets || []).find((b) => b.key === key) || { count: 0, saldo: 0 };
  }

  function cell(text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function listRow(title, amount, sub, bar) {
    const row = document.createElement('div');
    row.className = 'dashboard-list-row';
    const head = document.createElement('div');
    head.className = 'dashboard-list-head';
    const name = document.createElement('span');
    name.textContent = title;
    const value = document.createElement('strong');
    value.textContent = amount;
    head.append(name, value);
    row.appendChild(head);
    if (sub) {
      const subEl = document.createElement('p');
      subEl.className = 'dashboard-list-sub';
      subEl.textContent = sub;
      row.appendChild(subEl);
    }
    if (bar != null) {
      const track = document.createElement('div');
      track.className = 'dashboard-bar';
      const fill = document.createElement('span');
      fill.style.width = Math.max(4, Math.min(100, bar)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
    }
    return row;
  }

  // ---- Render -----------------------------------------------------------
  function renderKpis(data) {
    const provs = data.proveedores || [];
    const totalPendiente = provs.reduce((s, p) => s + num(p.saldo_pendiente), 0);
    const totalVencido = provs.reduce((s, p) => s + num(p.saldo_vencido), 0);
    const nAbiertas = provs.reduce((s, p) => s + num(p.facturas_pendientes), 0);
    const comprasAnio = provs.reduce((s, p) => s + num(p.compras_anio), 0);
    const ventasAnio = provs.reduce((s, p) => s + num(p.ventas_anio), 0);
    const venceSemana = (data.semana || [])
      .filter((f) => num(f.dias_para_vencer) >= 0 && num(f.dias_para_vencer) <= 7)
      .reduce((s, f) => s + num(f.saldo_pendiente), 0);
    const pct = totalPendiente > 0 ? (totalVencido * 100 / totalPendiente) : 0;

    const kpis = [
      { label: 'Saldo pendiente', value: money(totalPendiente), note: `${nAbiertas} facturas abiertas` },
      { label: 'Saldo vencido', value: money(totalVencido), note: `${pct.toFixed(1)}% del pendiente`, tone: 'danger' },
      { label: 'Vence esta semana', value: money(venceSemana), note: 'Sin vencidas antiguas', tone: 'warn' },
      { label: `Compras ${data.anio}`, value: money(comprasAnio), note: 'Facturas emitidas' },
      { label: 'Ventas asociadas', value: money(ventasAnio), note: `${num(data.lineas_con_proveedor)}/${num(data.lineas_venta_total)} líneas con proveedor`, tone: 'ok' }
    ];

    const wrap = el('dashKpis');
    wrap.replaceChildren();
    kpis.forEach((kpi) => {
      const box = document.createElement('div');
      box.className = 'dashboard-kpi' + (kpi.tone ? ` is-${kpi.tone}` : '');
      const label = document.createElement('span');
      label.className = 'dashboard-kpi-label';
      label.textContent = kpi.label;
      const value = document.createElement('strong');
      value.className = 'dashboard-kpi-value';
      value.textContent = kpi.value;
      const note = document.createElement('span');
      note.className = 'dashboard-kpi-note';
      note.textContent = kpi.note;
      box.append(label, value, note);
      wrap.appendChild(box);
    });
  }

  function renderPriority(data) {
    const rows = (data.proveedores || [])
      .filter((p) => num(p.saldo_pendiente) > 0 || num(p.ventas_anio) > 0 || num(p.compras_anio) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 12);
    const body = el('dashPriorityBody');
    body.replaceChildren();
    rows.forEach((p) => {
      const tr = document.createElement('tr');
      const first = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = p.proveedor || 'Sin proveedor';
      const small = document.createElement('small');
      small.textContent = `${num(p.facturas_pendientes)} pendientes · ${num(p.facturas_vencidas)} vencidas`;
      first.append(strong, document.createElement('br'), small);
      tr.appendChild(first);

      const prio = priority(num(p.max_atraso));
      const pillCell = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `dashboard-pill is-${prio.key}`;
      pill.textContent = prio.label;
      pillCell.appendChild(pill);
      tr.appendChild(pillCell);

      tr.appendChild(cell(money(p.saldo_pendiente), 'number'));
      tr.appendChild(cell(money(p.saldo_vencido), 'number'));
      tr.appendChild(cell(`${num(p.max_atraso)} días`, 'number'));
      tr.appendChild(cell(money(p.ventas_anio), 'number'));
      body.appendChild(tr);
    });
    if (!rows.length) body.appendChild(emptyRow(6, 'Sin datos de proveedores para este año.'));
  }

  function emptyRow(colspan, text) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.className = 'dashboard-empty';
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }

  function renderBuckets() {
    const wrap = el('dashBuckets');
    wrap.replaceChildren();
    BUCKETS.forEach((meta) => {
      const b = bucketOf(meta.key);
      const row = document.createElement('div');
      row.className = 'dashboard-bucket';
      row.style.setProperty('--bucket-color', meta.color);
      const head = document.createElement('div');
      head.className = 'dashboard-list-head';
      const name = document.createElement('span');
      name.textContent = meta.label;
      const value = document.createElement('strong');
      value.textContent = money(b.saldo);
      head.append(name, value);
      const sub = document.createElement('p');
      sub.className = 'dashboard-list-sub';
      sub.textContent = `${num(b.count)} facturas`;
      row.append(head, sub);
      wrap.appendChild(row);
    });
  }

  function renderWeek(data) {
    const rows = (data.semana || [])
      .slice()
      .sort((a, b) => num(b.dias_atraso) - num(a.dias_atraso) || num(b.saldo_pendiente) - num(a.saldo_pendiente))
      .slice(0, 8);
    const wrap = el('dashWeek');
    wrap.replaceChildren();
    if (!rows.length) {
      wrap.appendChild(emptyBlock('Nada próximo a vencer ni atrasos altos.'));
      return;
    }
    rows.forEach((f) => {
      const estado = num(f.dias_atraso) > 0
        ? `${num(f.dias_atraso)} días vencida`
        : `vence en ${num(f.dias_para_vencer)} días`;
      wrap.appendChild(listRow(f.proveedor || 'Sin proveedor', money(f.saldo_pendiente), `${f.numero_factura || ''} · ${estado}`));
    });
  }

  function renderSales(data) {
    const rows = (data.proveedores || [])
      .filter((p) => num(p.ventas_anio) > 0)
      .sort((a, b) => num(b.ventas_anio) - num(a.ventas_anio))
      .slice(0, 8);
    const wrap = el('dashSales');
    wrap.replaceChildren();
    if (!rows.length) {
      wrap.appendChild(emptyBlock('Sin ventas asociadas a proveedores este año.'));
      return;
    }
    const max = Math.max(...rows.map((r) => num(r.ventas_anio)), 1);
    rows.forEach((p) => {
      wrap.appendChild(listRow(
        p.proveedor || 'Sin proveedor',
        money(p.ventas_anio),
        `Ganancia estimada ${money(p.ganancia_estimada_anio)} · ${num(p.lineas_venta)} líneas`,
        num(p.ventas_anio) * 100 / max
      ));
    });
  }

  function emptyBlock(text) {
    const p = document.createElement('p');
    p.className = 'dashboard-empty';
    p.textContent = text;
    return p;
  }

  function renderRecs(data) {
    const ordered = (data.proveedores || [])
      .filter((p) => num(p.saldo_pendiente) > 0)
      .sort((a, b) => score(b) - score(a));
    const top = ordered[0];
    const riesgo = ordered.filter((p) => num(p.max_atraso) > 60);
    const normal = bucketOf('normal');
    const vencen = (data.semana || []).filter((f) => num(f.dias_para_vencer) >= 0 && num(f.dias_para_vencer) <= 7);
    const recs = [];

    if (top) {
      recs.push(`Priorizar ${top.proveedor}: concentra ${money(top.saldo_vencido)} vencidos y su mayor atraso es de ${num(top.max_atraso)} días.`);
    }
    if (num(normal.saldo) > 0) {
      recs.push(`${money(normal.saldo)} están vencidos dentro del rango operativo normal de 1 a 21 días; conviene monitorear sin saturar alertas.`);
    }
    if (vencen.length) {
      const total = vencen.reduce((s, f) => s + num(f.saldo_pendiente), 0);
      recs.push(`Esta semana vencen ${vencen.length} facturas por ${money(total)}.`);
    }
    if (riesgo.length) {
      recs.push(`${riesgo.length} proveedores tienen atrasos mayores a 60 días; revisarlos antes de nuevos pedidos grandes.`);
    }
    if (!recs.length) {
      recs.push('El estado general luce controlado. Mantener seguimiento semanal de vencimientos.');
    }

    const wrap = el('dashRecs');
    wrap.replaceChildren();
    recs.forEach((text) => {
      const row = document.createElement('p');
      row.className = 'dashboard-rec';
      row.textContent = text;
      wrap.appendChild(row);
    });
  }

  function render() {
    const data = state.data;
    if (!data) return;
    renderKpis(data);
    renderPriority(data);
    renderBuckets();
    renderWeek(data);
    renderSales(data);
    renderRecs(data);
  }

  // ---- Carga ----------------------------------------------------------------
  async function load(fresh) {
    if (state.loading) return;
    state.loading = true;
    const summary = el('dashSummary');
    summary.textContent = 'Calculando dashboard…';
    el('dashRefresh').disabled = true;
    try {
      const year = el('dashYear').value;
      const params = new URLSearchParams({ anio: year });
      if (fresh) params.set('fresh', '1');
      const response = await window.app.posApiRequest(`${API}?${params.toString()}`, { method: 'GET' });
      state.data = response?.data || null;
      state.year = year;
      render();
      const provs = state.data?.proveedores?.length || 0;
      summary.textContent = state.data
        ? `${provs} proveedores · actualizado ${new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}${response.cached ? ' (caché)' : ''}`
        : 'Sin datos.';
    } catch (error) {
      summary.textContent = error?.message || 'No fue posible cargar el dashboard.';
    } finally {
      state.loading = false;
      el('dashRefresh').disabled = false;
    }
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    const select = el('dashYear');
    const current = new Date().getFullYear();
    for (let y = current; y >= 2022; y -= 1) {
      const option = document.createElement('option');
      option.value = String(y);
      option.textContent = String(y);
      select.appendChild(option);
    }
    select.addEventListener('change', () => load(false));
    el('dashRefresh').addEventListener('click', () => load(true));
  }

  window.initDashboardProveedores = async function initDashboardProveedores() {
    bindOnce();
    await load(false);
  };
})();
