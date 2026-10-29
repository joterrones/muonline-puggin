const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const guildInput = document.getElementById("guild-input");
const guildOptions = document.getElementById("guild-options");
const guildChips = document.getElementById("guild-chips");
const filterChips = document.getElementById("filter-chips");
const guildGrid = document.getElementById("guild-grid");
const onlineSummary = document.getElementById("online-summary");
const rankFilter = document.getElementById("rank-filter");
const topList = document.getElementById("top-list");
const rankSummary = document.getElementById("rank-summary");
const pageLabel = document.getElementById("page-label");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");

const PAGE_SIZE = 20;

const state = {
  guilds: [],
  available: [],
  visibleIds: new Set(),
  onlinePayloads: [],
  rankingAll: [],
  levelsByName: new Map(),
  rankingPage: 1,
  rankingQ: "",
  filterTimer: null,
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nameToId(name) {
  const bytes = new TextEncoder().encode(String(name).trim());
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de red");
  return data;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function realLevelFor(nombre) {
  const key = String(nombre).toLowerCase();
  if (state.levelsByName.has(key)) return state.levelsByName.get(key);
  return null;
}

function formatGuildLevel(player) {
  const real = realLevelFor(player.nombre);
  if (real != null) return String(real);
  return player.level ? String(player.level) : "—";
}

function initAccordions() {
  document.querySelectorAll(".p-accordion-tab").forEach((tab) => {
    tab.classList.add("p-accordion-tab-active");
    const header = tab.querySelector(".p-accordion-header");
    header.addEventListener("click", () => {
      const open = tab.classList.toggle("p-accordion-tab-active");
      header.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
}

function renderGuildChips() {
  if (!state.guilds.length) {
    guildChips.innerHTML = `<p class="empty">Todavía no agregaste guilds.</p>`;
    filterChips.innerHTML = "";
    return;
  }

  guildChips.innerHTML = state.guilds
    .map(
      (g) => `
      <button type="button" class="chip ${g.enabled ? "active" : ""}" data-toggle="${escapeHtml(g.id)}">
        ${escapeHtml(g.name)}
        <span class="x" data-remove="${escapeHtml(g.id)}" title="Quitar">×</span>
      </button>`
    )
    .join("");

  filterChips.innerHTML = state.guilds
    .filter((g) => g.enabled)
    .map(
      (g) => `
      <button type="button" class="chip ${state.visibleIds.has(g.id) ? "active" : ""}" data-filter="${escapeHtml(g.id)}">
        ${escapeHtml(g.name)}
      </button>`
    )
    .join("");
}

function renderAvailableOptions() {
  guildOptions.innerHTML = state.available
    .map((g) => `<option value="${escapeHtml(g.name)}"></option>`)
    .join("");
}

function renderOnline(guildPayloads = state.onlinePayloads) {
  state.onlinePayloads = guildPayloads;

  if (!guildPayloads.length) {
    onlineSummary.textContent = "—";
    guildGrid.innerHTML = `<p class="empty">Selecciona qué guilds mostrar arriba.</p>`;
    return;
  }

  const totalOnline = guildPayloads.reduce(
    (sum, g) => sum + (g.error ? 0 : g.players?.length || 0),
    0
  );
  onlineSummary.textContent = String(totalOnline);

  guildGrid.innerHTML = guildPayloads
    .map((g) => {
      if (g.error) {
        return `
          <article class="guild-panel">
            <div class="guild-panel-head">
              <h3>${escapeHtml(g.guild)}</h3>
            </div>
            <p class="error">${escapeHtml(g.error)}</p>
          </article>`;
      }

      const players = g.players || [];
      const body = players.length
        ? `<div class="player-list">${players
            .map(
              (p) => `
            <article class="player-row">
              <span class="player-name">${escapeHtml(p.nombre)}</span>
              <span class="player-level">${escapeHtml(formatGuildLevel(p))}</span>
              <span class="player-meta">${escapeHtml(p.clase)}${p.position ? ` · ${escapeHtml(p.position)}` : ""}</span>
            </article>`
            )
            .join("")}</div>`
        : `<p class="empty" style="padding:0.85rem">Nadie online ahora.</p>`;

      return `
        <article class="guild-panel">
          <div class="guild-panel-head">
            <h3>${escapeHtml(g.guild)}</h3>
            <span class="online-count">${players.length} online</span>
          </div>
          ${body}
        </article>`;
    })
    .join("");
}

function getFilteredRanking() {
  const q = state.rankingQ.toLowerCase();
  if (!q) return state.rankingAll;
  return state.rankingAll.filter((p) => p.name.toLowerCase().includes(q));
}

function renderRankingPage() {
  const filtered = getFilteredRanking();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.rankingPage = Math.min(Math.max(1, state.rankingPage), totalPages);

  const start = (state.rankingPage - 1) * PAGE_SIZE;
  const players = filtered.slice(start, start + PAGE_SIZE);

  rankSummary.textContent = String(total);
  pageLabel.textContent = `${state.rankingPage} / ${totalPages}`;
  prevPageBtn.disabled = state.rankingPage <= 1;
  nextPageBtn.disabled = state.rankingPage >= totalPages;

  if (!players.length) {
    topList.innerHTML = `<tr><td colspan="8" class="empty-cell">${
      state.rankingQ ? "Ningún PJ coincide con el filtro." : "Sin datos de ranking."
    }</td></tr>`;
    return;
  }

  topList.innerHTML = players
    .map((p) => {
      const expLabel =
        p.expThousands != null
          ? `${Number(p.expThousands).toLocaleString("es-PE", {
              maximumFractionDigits: 2,
            })} K`
          : "—";
      const profileBtn = p.profileUrl
        ? `<a class="p-button p-button-sm p-button-outlined" href="${escapeHtml(p.profileUrl)}" target="_blank" rel="noopener noreferrer">Ver PJ</a>`
        : "—";
      const statusClass = p.online ? "status-online" : "status-offline";
      const statusLabel = p.status || (p.online ? "Online" : "Offline");

      return `
      <tr>
        <td>${escapeHtml(p.place)}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.clase)}</td>
        <td>${escapeHtml(p.totalLvl ?? p.lvlRes)}</td>
        <td>${escapeHtml(expLabel)}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
        <td>${escapeHtml(p.location || "—")}</td>
        <td>${profileBtn}</td>
      </tr>`;
    })
    .join("");
}

async function saveGuilds() {
  const data = await api("/api/guilds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guilds: state.guilds }),
  });
  state.guilds = data.guilds;
  const enabledIds = new Set(state.guilds.filter((g) => g.enabled).map((g) => g.id));
  state.visibleIds = new Set([...state.visibleIds].filter((id) => enabledIds.has(id)));
  if (!state.visibleIds.size) {
    state.guilds.filter((g) => g.enabled).forEach((g) => state.visibleIds.add(g.id));
  }
  renderGuildChips();
}

async function loadGuilds() {
  const data = await api("/api/guilds");
  state.guilds = data.guilds || [];
  state.visibleIds = new Set(state.guilds.filter((g) => g.enabled).map((g) => g.id));
  renderGuildChips();
}

async function loadAvailableGuilds() {
  try {
    const data = await api("/api/guilds/available");
    state.available = data.guilds || [];
    renderAvailableOptions();
  } catch {
    state.available = [];
  }
}

async function loadOnline() {
  const ids = [...state.visibleIds];
  if (!ids.length) {
    renderOnline([]);
    return;
  }
  const data = await api(`/api/online?ids=${encodeURIComponent(ids.join(","))}`);
  renderOnline(data.guilds || []);
}

async function loadRanking(force = false) {
  if (!force && state.rankingAll.length) {
    renderRankingPage();
    renderOnline();
    return;
  }
  setStatus("Descargando ranking…");
  const data = await api("/api/ranking");
  state.rankingAll = data.players || [];
  state.levelsByName = new Map(
    Object.entries(data.levelsByName || {}).map(([k, v]) => [k, Number(v)])
  );
  state.rankingPage = 1;
  renderRankingPage();
  renderOnline();
}

async function refreshAll() {
  refreshBtn.disabled = true;
  setStatus("Actualizando…");
  try {
    await Promise.all([loadOnline(), loadRanking(true)]);
    const now = new Date().toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setStatus(`Actualizado a las ${now}`);
  } catch (err) {
    setStatus("Error al cargar");
    renderOnline([]);
    topList.innerHTML = `<tr><td colspan="8" class="empty-cell error">${escapeHtml(err.message)}</td></tr>`;
    rankSummary.textContent = "—";
    pageLabel.textContent = "—";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
  } finally {
    refreshBtn.disabled = false;
  }
}

document.getElementById("add-guild").addEventListener("click", async () => {
  const name = guildInput.value.trim();
  if (!name) return;

  const fromList = state.available.find(
    (g) => g.name.toLowerCase() === name.toLowerCase()
  );
  const id = (fromList?.id || nameToId(name)).toLowerCase();

  if (state.guilds.some((g) => g.id === id || g.name.toLowerCase() === name.toLowerCase())) {
    setStatus("Ese guild ya está en la lista");
    return;
  }

  state.guilds.push({
    id,
    name: fromList?.name || name,
    enabled: true,
  });
  state.visibleIds.add(id);
  guildInput.value = "";
  await saveGuilds();
  await loadOnline();
  setStatus(`Agregado ${fromList?.name || name}`);
});

guildChips.addEventListener("click", async (e) => {
  const removeId = e.target.getAttribute("data-remove");
  if (removeId) {
    e.stopPropagation();
    state.guilds = state.guilds.filter((g) => g.id !== removeId);
    state.visibleIds.delete(removeId);
    await saveGuilds();
    await loadOnline();
    return;
  }

  const toggleId = e.target.closest("[data-toggle]")?.getAttribute("data-toggle");
  if (!toggleId) return;
  const guild = state.guilds.find((g) => g.id === toggleId);
  if (!guild) return;
  guild.enabled = !guild.enabled;
  if (!guild.enabled) state.visibleIds.delete(guild.id);
  else state.visibleIds.add(guild.id);
  await saveGuilds();
  await loadOnline();
});

filterChips.addEventListener("click", async (e) => {
  const id = e.target.closest("[data-filter]")?.getAttribute("data-filter");
  if (!id) return;
  if (state.visibleIds.has(id)) state.visibleIds.delete(id);
  else state.visibleIds.add(id);
  renderGuildChips();
  setStatus("Filtrando guilds…");
  try {
    await loadOnline();
    setStatus("Filtro aplicado");
  } catch (err) {
    setStatus(err.message);
  }
});

rankFilter.addEventListener("input", () => {
  clearTimeout(state.filterTimer);
  state.filterTimer = setTimeout(() => {
    state.rankingQ = rankFilter.value.trim();
    state.rankingPage = 1;
    renderRankingPage();
  }, 150);
});

prevPageBtn.addEventListener("click", () => {
  if (state.rankingPage <= 1) return;
  state.rankingPage -= 1;
  renderRankingPage();
});

nextPageBtn.addEventListener("click", () => {
  state.rankingPage += 1;
  renderRankingPage();
});

refreshBtn.addEventListener("click", refreshAll);

initAccordions();

(async function init() {
  setStatus("Cargando…");
  refreshBtn.disabled = true;
  try {
    await loadGuilds();
    await loadAvailableGuilds();
    await refreshAll();
  } catch (err) {
    setStatus(err.message);
  } finally {
    refreshBtn.disabled = false;
  }
})();
