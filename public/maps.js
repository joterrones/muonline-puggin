(() => {
  const statusEl = document.getElementById("status");
  const listEl = document.getElementById("maps-list");
  const summaryEl = document.getElementById("map-summary");
  const spotsEl = document.getElementById("spots-list");
  const svg = document.getElementById("map-svg");
  const tooltip = document.getElementById("map-tooltip");
  const searchEl = document.getElementById("map-search");
  const eliteFilter = document.getElementById("filter-elite");
  const refreshBtn = document.getElementById("refresh");

  /** @type {any[]} */
  let maps = [];
  let mapSize = 256;
  /** @type {any | null} */
  let selected = null;
  /** @type {string | null} */
  let selectedRegionId = null;

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

  function regionCoords(region) {
    if (region.point) return `(${region.x1}, ${region.y1})`;
    return `(${region.x1},${region.y1}) → (${region.x2},${region.y2})`;
  }

  function regionMonsterLines(region) {
    return (region.monsters || [])
      .map(
        (m) =>
          `${m.name} ×${m.count}${m.elite ? " (Elite)" : ""}`
      )
      .join("\n");
  }

  function filteredMaps() {
    const q = searchEl.value.trim().toLowerCase();
    return maps.filter((m) => {
      if (eliteFilter.checked && !m.hasElite) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        String(m.number).includes(q)
      );
    });
  }

  function renderList() {
    const list = filteredMaps();
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">Sin mapas</p>';
      return;
    }
    listEl.innerHTML = list
      .map((m) => {
        const active = selected && selected.number === m.number ? " active" : "";
        const elite = m.hasElite
          ? '<span class="type-badge badge-elite">Elite</span>'
          : "";
        return `<button type="button" class="map-list-item${active}" data-map="${m.number}">
          <span class="map-list-name">${escapeHtml(m.name)}</span>
          <span class="map-list-meta">#${m.number} · ${m.monsterCount} mobs · ${m.regionCount || m.spotCount} zonas ${elite}</span>
        </button>`;
      })
      .join("");
  }

  function svgY(y) {
    return mapSize - y;
  }

  function renderSummary(map) {
    summaryEl.innerHTML = `
      <div class="maps-summary-grid">
        <div>
          <h2>${escapeHtml(map.name)}</h2>
          <p class="muted">Mapa #${map.number}${map.file ? ` · ${escapeHtml(map.file)}` : ""}</p>
        </div>
        <div class="maps-stat"><strong>${map.regionCount || 0}</strong><span>Zonas</span></div>
        <div class="maps-stat"><strong>${map.monsterCount}</strong><span>Monstruos</span></div>
        <div class="maps-stat maps-stat-elite"><strong>${map.eliteSpots}</strong><span>Spots elite</span></div>
        <div class="maps-stat maps-stat-elite"><strong>${map.eliteMonsters}</strong><span>Elites</span></div>
      </div>`;
  }

  function renderRegions(map) {
    const regions = map.regions || [];
    if (!regions.length) {
      spotsEl.innerHTML = '<p class="empty">Sin zonas de monstruos</p>';
      return;
    }
    spotsEl.innerHTML = regions
      .map((region) => {
        const active = selectedRegionId === region.id ? " active" : "";
        const eliteBadge = region.hasElite
          ? '<span class="type-badge badge-elite">Elite</span>'
          : '<span class="type-badge badge-normal">Normal</span>';
        const monsters = region.monsters
          .map(
            (m) =>
              `<li class="${m.elite ? "is-elite" : ""}">${escapeHtml(m.name)} ×${m.count}${
                m.elite ? " · Elite" : ""
              }</li>`
          )
          .join("");
        return `<button type="button" class="spot-card${active}" data-region="${escapeHtml(
          region.id
        )}">
          <div class="spot-card-head">
            <strong>${region.monsterKinds} tipo(s) · total ${region.totalCount}</strong>
            ${eliteBadge}
          </div>
          <div class="spot-card-meta">${escapeHtml(regionCoords(region))}</div>
          <ul class="spot-monster-list">${monsters}</ul>
        </button>`;
      })
      .join("");
  }

  function renderSvg(map) {
    const NS = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(mapSize));
    bg.setAttribute("height", String(mapSize));
    bg.setAttribute("class", "map-bg");
    svg.appendChild(bg);

    for (let i = 0; i <= mapSize; i += 32) {
      const v = document.createElementNS(NS, "line");
      v.setAttribute("x1", String(i));
      v.setAttribute("x2", String(i));
      v.setAttribute("y1", "0");
      v.setAttribute("y2", String(mapSize));
      v.setAttribute("class", "map-grid");
      svg.appendChild(v);
      const h = document.createElementNS(NS, "line");
      h.setAttribute("x1", "0");
      h.setAttribute("x2", String(mapSize));
      h.setAttribute("y1", String(i));
      h.setAttribute("y2", String(i));
      h.setAttribute("class", "map-grid");
      svg.appendChild(h);
    }

    const regions = map.regions || [];
    regions.forEach((region) => {
      const dimmed =
        selectedRegionId != null && selectedRegionId !== region.id
          ? " dimmed"
          : "";
      const eliteClass = region.hasElite ? " elite" : " normal";
      const highlight =
        selectedRegionId === region.id ? " spot-active" : "";
      const label = `${region.monsterKinds} tipos · ${region.totalCount} mobs`;
      const detail = `${regionCoords(region)}\n${regionMonsterLines(region)}`;

      if (region.point) {
        const r = Math.max(
          2,
          Math.min(7, 1.6 + Math.sqrt(region.totalCount))
        );
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", String(region.cx));
        c.setAttribute("cy", String(svgY(region.cy)));
        c.setAttribute("r", String(r));
        c.setAttribute(
          "class",
          `map-spawn map-spawn-point${eliteClass}${highlight}${dimmed}`
        );
        c.dataset.region = region.id;
        c.dataset.label = label;
        c.dataset.detail = detail;
        svg.appendChild(c);
      } else {
        const w = Math.max(1, region.x2 - region.x1);
        const h = Math.max(1, region.y2 - region.y1);
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", String(region.x1));
        rect.setAttribute("y", String(svgY(region.y2)));
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(h));
        rect.setAttribute(
          "class",
          `map-spawn map-spawn-area${eliteClass}${highlight}${dimmed}`
        );
        rect.dataset.region = region.id;
        rect.dataset.label = label;
        rect.dataset.detail = detail;
        svg.appendChild(rect);
      }

      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", String(region.cx));
      text.setAttribute("y", String(svgY(region.cy)));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute(
        "class",
        `map-spawn-label${dimmed}${region.hasElite ? " elite" : ""}`
      );
      text.textContent = String(region.totalCount);
      text.style.pointerEvents = "none";
      svg.appendChild(text);
    });
  }

  function selectMap(number) {
    selected = maps.find((m) => m.number === number) || null;
    selectedRegionId = null;
    renderList();
    if (!selected) {
      summaryEl.innerHTML = '<p class="empty">Selecciona un mapa</p>';
      spotsEl.innerHTML = '<p class="empty">—</p>';
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }
    renderSummary(selected);
    renderRegions(selected);
    renderSvg(selected);
  }

  function selectRegion(regionId) {
    selectedRegionId = regionId;
    if (!selected) return;
    renderRegions(selected);
    renderSvg(selected);
    const card = spotsEl.querySelector(
      `[data-region="${CSS.escape(regionId)}"]`
    );
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showTooltip(evt, label, detail) {
    tooltip.hidden = false;
    const lines = String(detail || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("");
    tooltip.innerHTML = `<strong>${escapeHtml(label)}</strong>${lines}`;
    const wrap = tooltip.parentElement.getBoundingClientRect();
    const x = evt.clientX - wrap.left + 12;
    const y = evt.clientY - wrap.top + 12;
    tooltip.style.left = `${Math.min(x, wrap.width - 240)}px`;
    tooltip.style.top = `${Math.min(y, wrap.height - 80)}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-map]");
    if (!btn) return;
    selectMap(Number(btn.dataset.map));
  });

  spotsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-region]");
    if (!btn) return;
    const id = btn.dataset.region;
    selectRegion(selectedRegionId === id ? null : id);
  });

  svg.addEventListener("pointermove", (e) => {
    const el = e.target.closest(".map-spawn");
    if (!el) {
      hideTooltip();
      return;
    }
    showTooltip(e, el.dataset.label, el.dataset.detail);
  });

  svg.addEventListener("pointerleave", hideTooltip);

  svg.addEventListener("click", (e) => {
    const el = e.target.closest(".map-spawn");
    if (!el) return;
    const id = el.dataset.region;
    selectRegion(selectedRegionId === id ? null : id);
  });

  searchEl.addEventListener("input", renderList);
  eliteFilter.addEventListener("change", renderList);

  async function load() {
    setStatus("Cargando…");
    refreshBtn.disabled = true;
    try {
      const res = await fetch("/api/maps", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      maps = data.maps || [];
      mapSize = data.mapSize || 256;
      svg.setAttribute("viewBox", `0 0 ${mapSize} ${mapSize}`);
      renderList();
      if (selected) {
        selectMap(selected.number);
      } else if (maps.length) {
        selectMap(maps[0].number);
      }
      const when = data.generatedAt
        ? new Date(data.generatedAt).toLocaleString("es-PE")
        : "";
      setStatus(data.cached ? `Cache · ${when}` : `Actualizado · ${when}`);
    } catch (err) {
      console.error(err);
      setStatus("Error al cargar");
      listEl.innerHTML =
        '<p class="empty">No se pudo cargar. ¿Existe Data/Monsters/MonsterSpawn.xml?</p>';
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", load);
  load();
})();
