(() => {
  const statusEl = document.getElementById("status");
  const countEl = document.getElementById("drops-count");
  const bodyEl = document.getElementById("drops-body");
  const mapOptions = document.getElementById("map-options");
  const itemOptions = document.getElementById("item-options");
  const filterMonster = document.getElementById("filter-monster");
  const filterMap = document.getElementById("filter-map");
  const filterItem = document.getElementById("filter-item");
  const filterType = document.getElementById("filter-type");
  const clearBtn = document.getElementById("clear-filters");
  const refreshBtn = document.getElementById("refresh");

  /** @type {any[]} */
  let monsters = [];

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fillDatalist(el, options, getLabel) {
    el.innerHTML = options
      .map((o) => `<option value="${escapeHtml(getLabel(o))}"></option>`)
      .join("");
  }

  function matches(row) {
    const qMonster = filterMonster.value.trim().toLowerCase();
    const qMap = filterMap.value.trim().toLowerCase();
    const qItem = filterItem.value.trim().toLowerCase();
    const qType = filterType.value;

    if (qType && row.type !== qType) return false;
    if (qMonster && !row.name.toLowerCase().includes(qMonster)) return false;
    if (
      qMap &&
      !(row.mapNames || []).some((n) => n.toLowerCase().includes(qMap))
    ) {
      return false;
    }
    if (
      qItem &&
      !(row.itemNames || []).some((n) => n.toLowerCase().includes(qItem))
    ) {
      return false;
    }
    return true;
  }

  function render() {
    const filtered = monsters.filter(matches);
    countEl.textContent = `${filtered.length} de ${monsters.length} monstruos`;

    if (!filtered.length) {
      bodyEl.innerHTML =
        '<tr><td colspan="5" class="empty">Sin resultados con estos filtros.</td></tr>';
      return;
    }

    bodyEl.innerHTML = filtered
      .map((row) => {
        const typeClass =
          row.type === "Elite" ? "badge-elite" : "badge-normal";
        const maps =
          (row.mapNames || []).length > 0
            ? row.mapNames.map(escapeHtml).join(", ")
            : '<span class="muted">Sin mapa</span>';
        const items =
          (row.items || []).length > 0
            ? `<ul class="drop-item-list">${row.items
                .map((i) => `<li>${escapeHtml(i.name)}</li>`)
                .join("")}</ul>`
            : '<span class="muted">Sin drops</span>';

        return `<tr>
          <td>
            <div class="monster-name">${escapeHtml(row.name)}</div>
            <div class="monster-id">#${row.id}</div>
          </td>
          <td class="col-lvl">${row.level || "—"}</td>
          <td><span class="type-badge ${typeClass}">${escapeHtml(
            row.type
          )}</span></td>
          <td class="col-maps">${maps}</td>
          <td class="col-items">${items}</td>
        </tr>`;
      })
      .join("");
  }

  async function load(forceStatus) {
    if (forceStatus !== false) setStatus("Cargando…");
    refreshBtn.disabled = true;
    try {
      const res = await fetch("/api/drops", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      monsters = data.monsters || [];
      fillDatalist(mapOptions, data.filters?.maps || [], (m) => m.name);
      fillDatalist(itemOptions, data.filters?.items || [], (i) => i.name);
      render();
      const when = data.generatedAt
        ? new Date(data.generatedAt).toLocaleString("es-PE")
        : "";
      setStatus(
        data.cached
          ? `Cache · ${when}`
          : `Actualizado · ${when}`
      );
    } catch (err) {
      console.error(err);
      bodyEl.innerHTML =
        '<tr><td colspan="5" class="empty">No se pudo cargar el catálogo. ¿Existe la carpeta Data?</td></tr>';
      setStatus("Error al cargar");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  filterMonster.addEventListener("input", render);
  filterMap.addEventListener("input", render);
  filterItem.addEventListener("input", render);
  filterType.addEventListener("change", render);

  clearBtn.addEventListener("click", () => {
    filterMonster.value = "";
    filterMap.value = "";
    filterItem.value = "";
    filterType.value = "";
    render();
  });

  refreshBtn.addEventListener("click", () => load());

  load();
})();
