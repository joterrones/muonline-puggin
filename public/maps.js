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
  /** @type {number | null} */
  let selectedSpotId = null;

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
          <span class="map-list-meta">#${m.number} · ${m.monsterCount} mobs · ${m.spotCount} spots ${elite}</span>
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
        <div class="maps-stat"><strong>${map.spotCount}</strong><span>Spots</span></div>
        <div class="maps-stat"><strong>${map.monsterCount}</strong><span>Monstruos</span></div>
        <div class="maps-stat maps-stat-elite"><strong>${map.eliteSpots}</strong><span>Spots elite</span></div>
        <div class="maps-stat maps-stat-elite"><strong>${map.eliteMonsters}</strong><span>Elites</span></div>
      </div>`;
  }

  function renderSpots(map) {
    if (!map.spots.length) {
      spotsEl.innerHTML = '<p class="empty">Sin spots de monstruos</p>';
      return;
    }
    spotsEl.innerHTML = map.spots
      .map((spot) => {
        const active = selectedSpotId === spot.id ? " active" : "";
        const eliteBadge = spot.hasElite
          ? '<span class="type-badge badge-elite">Elite</span>'
          : '<span class="type-badge badge-normal">Normal</span>';
        const monsters = spot.spawns
          .map(
            (s) =>
              `<li class="${s.elite ? "is-elite" : ""}">${escapeHtml(s.name)} ×${s.count}${
                s.elite ? " · Elite" : ""
              }</li>`
          )
          .join("");
        return `<button type="button" class="spot-card${active}" data-spot="${spot.id}">
          <div class="spot-card-head">
            <strong>${escapeHtml(spot.description)}</strong>
            ${eliteBadge}
          </div>
          <div class="spot-card-meta">${spot.monsterCount} monstruos · tipo ${spot.type}</div>
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

    // grid
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

    map.spots.forEach((spot) => {
      const dimmed =
        selectedSpotId != null && selectedSpotId !== spot.id ? " dimmed" : "";
      spot.spawns.forEach((spawn, idx) => {
        const eliteClass = spawn.elite ? " elite" : " normal";
        const highlight =
          selectedSpotId === spot.id ? " spot-active" : "";
        const title = `${spawn.name} ×${spawn.count}${spawn.elite ? " (Elite)" : ""}`;

        if (spawn.point) {
          const r = Math.max(1.8, Math.min(6, 1.5 + Math.sqrt(spawn.count)));
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", String(spawn.cx));
          c.setAttribute("cy", String(svgY(spawn.cy)));
          c.setAttribute("r", String(r));
          c.setAttribute(
            "class",
            `map-spawn map-spawn-point${eliteClass}${highlight}${dimmed}`
          );
          c.dataset.spot = String(spot.id);
          c.dataset.label = title;
          c.dataset.detail = `${spot.description} · (${spawn.x1}, ${spawn.y1})`;
          svg.appendChild(c);
        } else {
          const w = Math.max(1, spawn.x2 - spawn.x1);
          const h = Math.max(1, spawn.y2 - spawn.y1);
          const rect = document.createElementNS(NS, "rect");
          rect.setAttribute("x", String(spawn.x1));
          rect.setAttribute("y", String(svgY(spawn.y2)));
          rect.setAttribute("width", String(w));
          rect.setAttribute("height", String(h));
          rect.setAttribute(
            "class",
            `map-spawn map-spawn-area${eliteClass}${highlight}${dimmed}`
          );
          rect.dataset.spot = String(spot.id);
          rect.dataset.label = title;
          rect.dataset.detail = `${spot.description} · (${spawn.x1},${spawn.y1})-(${spawn.x2},${spawn.y2}) · ${spawn.count}`;
          svg.appendChild(rect);

          if (spawn.count >= 5 || spawn.elite) {
            const label = document.createElementNS(NS, "text");
            label.setAttribute("x", String(spawn.cx));
            label.setAttribute("y", String(svgY(spawn.cy)));
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("dominant-baseline", "middle");
            label.setAttribute(
              "class",
              `map-spawn-label${dimmed}${spawn.elite ? " elite" : ""}`
            );
            label.textContent = String(spawn.count);
            label.dataset.spot = String(spot.id);
            label.style.pointerEvents = "none";
            svg.appendChild(label);
          }
        }
        void idx;
      });
    });
  }

  function selectMap(number) {
    selected = maps.find((m) => m.number === number) || null;
    selectedSpotId = null;
    renderList();
    if (!selected) {
      summaryEl.innerHTML = '<p class="empty">Selecciona un mapa</p>';
      spotsEl.innerHTML = '<p class="empty">—</p>';
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }
    renderSummary(selected);
    renderSpots(selected);
    renderSvg(selected);
  }

  function selectSpot(spotId) {
    selectedSpotId = spotId;
    if (!selected) return;
    renderSpots(selected);
    renderSvg(selected);
    const card = spotsEl.querySelector(`[data-spot="${spotId}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showTooltip(evt, label, detail) {
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${escapeHtml(label)}</strong><div>${escapeHtml(
      detail || ""
    )}</div>`;
    const wrap = tooltip.parentElement.getBoundingClientRect();
    const x = evt.clientX - wrap.left + 12;
    const y = evt.clientY - wrap.top + 12;
    tooltip.style.left = `${Math.min(x, wrap.width - 220)}px`;
    tooltip.style.top = `${Math.min(y, wrap.height - 60)}px`;
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
    const btn = e.target.closest("[data-spot]");
    if (!btn) return;
    const id = Number(btn.dataset.spot);
    selectSpot(selectedSpotId === id ? null : id);
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
    selectSpot(Number(el.dataset.spot));
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
