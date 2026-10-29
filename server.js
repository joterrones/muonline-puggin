const path = require("path");
const fs = require("fs");
const express = require("express");
const axios = require("axios");
const { getCatalog } = require("./lib/dataCatalog");

const app = express();
const PORT = process.env.PORT || 3000;
const GUILDS_FILE = path.join(__dirname, "guilds.json");
const PAGE_SIZE = 20;
const RANKING_TOP = 25000;
const MIN_RANKING_LEVEL = 1200;
const CACHE_MS = 60_000;
const RANKING_CACHE_MS = 5 * 60_000;
const ROSTER_CACHE_MS = 30 * 60_000;
const IS_RENDER =
  process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_URL);

/** @type {{ id: string, name: string, enabled: boolean }[]} */
let memoryGuilds = null;

const cache = {
  ranking: { data: null, levelsByName: null, onlineByName: null, at: 0 },
  availableGuilds: { data: null, at: 0 },
  roster: new Map(),
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), render: IS_RENDER });
});

function guildNameToId(name) {
  return Buffer.from(String(name).trim(), "utf8").toString("hex");
}

function normalizeGuilds(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((g) => ({
      id: String(g.id || guildNameToId(g.name)).toLowerCase(),
      name: String(g.name || "").trim(),
      enabled: g.enabled !== false,
    }))
    .filter((g) => g.name && g.id);
}

function readGuilds() {
  if (memoryGuilds) return memoryGuilds;
  try {
    const raw = fs.readFileSync(GUILDS_FILE, "utf8");
    memoryGuilds = normalizeGuilds(JSON.parse(raw));
    return memoryGuilds;
  } catch {
    memoryGuilds = [];
    return memoryGuilds;
  }
}

function writeGuilds(list) {
  const cleaned = normalizeGuilds(list);
  memoryGuilds = cleaned;
  try {
    fs.writeFileSync(GUILDS_FILE, JSON.stringify(cleaned, null, 2));
  } catch (err) {
    // En Render el FS suele ser de solo lectura: igual devolvemos OK (memoria + localStorage del cliente).
    console.warn("No se pudo escribir guilds.json:", err.message);
  }
  return cleaned;
}

async function launchBrowser() {
  if (IS_RENDER) {
    const chromium = require("@sparticuz/chromium");
    const puppeteerCore = require("puppeteer-core");
    if (typeof chromium.setGraphicsMode === "function") {
      chromium.setGraphicsMode(false);
    }
    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(),
      headless: typeof chromium.headless === "boolean" ? chromium.headless : true,
      ignoreHTTPSErrors: true,
    });
  }

  const puppeteer = require("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    timeout: 60_000,
  });
}

async function withBrowser(fn) {
  const browser = await launchBrowser();
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function fetchRankingPlayers() {
  if (cache.ranking.data && Date.now() - cache.ranking.at < RANKING_CACHE_MS) {
    return {
      players: cache.ranking.data,
      levelsByName: cache.ranking.levelsByName || {},
      onlineByName: cache.ranking.onlineByName || {},
      cached: true,
    };
  }

  const params = new URLSearchParams({
    type: "players",
    server: "DEFAULT",
    top: String(RANKING_TOP),
  });

  const { data } = await axios.post(
    "https://perumu.com/rankings/load_ranking_data",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: 120_000,
    }
  );

  const all = (data.players || []).map((p) => {
    const level = Number(p.level) || 0;
    const mlevel = Number(p.mlevel) || 0;
    const totalLvl = level + mlevel;
    const rawLoc = String(p.loc || "").trim();
    const location =
      !rawLoc || /^unknown$/i.test(rawLoc) ? "Sin ubicación" : rawLoc;
    const exp = Number(p.exp) || 0;
    const online = Number(p.status) === 1;
    return {
      name: p.name || "",
      nameHex: p.name_hex || "",
      profileUrl: p.name_hex
        ? `https://perumu.com/character/${p.name_hex}/DEFAULT`
        : "",
      clase: p.class || p.class_small || "",
      totalLvl,
      lvlRes: `${totalLvl} / (${p.resets ?? 0})`,
      level,
      mlevel,
      resets: p.resets,
      exp,
      expThousands: Number((exp / 1_000).toFixed(2)),
      online,
      status: online ? "Online" : "Offline",
      location,
    };
  });

  const levelsByName = {};
  const onlineByName = {};
  for (const p of all) {
    if (!p.name) continue;
    const key = p.name.toLowerCase();
    levelsByName[key] = p.totalLvl;
    onlineByName[key] = p.online;
  }

  const players = all
    .filter((p) => p.totalLvl >= MIN_RANKING_LEVEL)
    .map((p, i) => ({ ...p, place: i + 1 }));

  cache.ranking = {
    data: players,
    levelsByName,
    onlineByName,
    at: Date.now(),
  };
  return { players, levelsByName, onlineByName, cached: false };
}

async function fetchAvailableGuilds() {
  if (
    cache.availableGuilds.data &&
    Date.now() - cache.availableGuilds.at < CACHE_MS
  ) {
    return { guilds: cache.availableGuilds.data, cached: true };
  }

  const params = new URLSearchParams({
    type: "guilds",
    server: "DEFAULT",
    top: "500",
  });

  const { data } = await axios.post(
    "https://perumu.com/rankings/load_ranking_data",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: 60_000,
    }
  );

  const guilds = (data.guilds || []).map((g) => ({
    id: String(g.name_hex || guildNameToId(g.name)).toLowerCase(),
    name: g.name,
    members: g.members,
    master: g.master,
  }));

  cache.availableGuilds = { data: guilds, at: Date.now() };
  return { guilds, cached: false };
}

async function scrapeGuildRoster(browser, guild) {
  const cacheKey = guild.id;
  const hit = cache.roster.get(cacheKey);
  if (hit && Date.now() - hit.at < ROSTER_CACHE_MS) {
    return {
      id: guild.id,
      guild: guild.name,
      members: hit.members,
      error: hit.error,
      cached: true,
    };
  }

  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(25_000);
    await page.goto(`https://perumu.com/guild/${guild.id}/DEFAULT`, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Invalid Guild") ||
        [...document.querySelectorAll("table")].some((t) =>
          /Status/i.test(t.innerText)
        ),
      { timeout: 20_000 }
    );

    const result = await page.evaluate(() => {
      if (document.body.innerText.includes("Invalid Guild")) {
        return { invalid: true, members: [] };
      }

      const table = [...document.querySelectorAll("table")].find((t) => {
        const header = t.querySelector("tr");
        return (
          header &&
          /Status/i.test(header.innerText) &&
          /Name/i.test(header.innerText)
        );
      });

      if (!table) return { invalid: false, members: [] };

      const members = [];
      table.querySelectorAll("tr").forEach((row, i) => {
        if (i === 0) return;
        const cols = row.querySelectorAll("td");
        if (cols.length < 7) return;

        const status =
          cols[6].querySelector("img")?.getAttribute("title") || "Offline";

        members.push({
          nombre:
            cols[1].querySelector("a")?.innerText.trim() ||
            cols[1].innerText.trim(),
          clase: cols[2].innerText.trim(),
          level: cols[4].innerText.trim(),
          position: cols[5].innerText.trim(),
          status,
        });
      });

      return { invalid: false, members };
    });

    if (result.invalid) {
      const error = `El guild ${guild.name} no existe o cambió de nombre en PeruMU.`;
      cache.roster.set(cacheKey, { members: [], at: Date.now(), error });
      return {
        id: guild.id,
        guild: guild.name,
        members: [],
        error,
        cached: false,
      };
    }

    cache.roster.set(cacheKey, {
      members: result.members,
      at: Date.now(),
      error: null,
    });
    return {
      id: guild.id,
      guild: guild.name,
      members: result.members,
      cached: false,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function buildOnlineFromRoster(guild, members, onlineByName) {
  const players = (members || [])
    .filter((m) => {
      const key = String(m.nombre || "").toLowerCase();
      if (onlineByName && Object.prototype.hasOwnProperty.call(onlineByName, key)) {
        return Boolean(onlineByName[key]);
      }
      return m.status === "Online";
    })
    .map((m) => ({
      nombre: m.nombre,
      clase: m.clase,
      level: m.level,
      position: m.position,
    }));

  return {
    id: guild.id,
    guild: guild.name,
    players,
  };
}

app.get("/api/guilds", (_req, res) => {
  res.json({ guilds: readGuilds() });
});

app.put("/api/guilds", (req, res) => {
  if (!Array.isArray(req.body?.guilds)) {
    return res.status(400).json({ error: "Envía { guilds: [...] }" });
  }
  const guilds = writeGuilds(req.body.guilds);
  res.json({ guilds, persisted: true });
});

app.get("/api/guilds/available", async (_req, res) => {
  try {
    const result = await fetchAvailableGuilds();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo listar guilds de PeruMU." });
  }
});

/** Roster completo de un guild (para cachear en cliente). */
app.post("/api/guild-roster", async (req, res) => {
  try {
    const guild = normalizeGuilds([req.body?.guild || req.body])[0];
    if (!guild) {
      return res.status(400).json({ error: "Envía { guild: { id, name } }" });
    }

    let result;
    try {
      result = await withBrowser((browser) => scrapeGuildRoster(browser, guild));
    } catch (err) {
      console.error("browser launch roster:", err.message || err);
      return res.json({
        id: guild.id,
        guild: guild.name,
        members: [],
        error:
          "No se pudo abrir el navegador en el servidor. Reintenta en unos segundos.",
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo obtener el roster del guild." });
  }
});

async function handleOnlineRequest(req, res) {
  try {
    const fromClient = normalizeGuilds(req.body?.guilds);
    const configured = fromClient.length ? fromClient : readGuilds();
    const filterIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map((s) => String(s).toLowerCase())
      : String(req.body?.ids || req.query.ids || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

    const selected = configured.filter((g) => {
      if (!g.enabled) return false;
      if (!filterIds.length) return true;
      return filterIds.includes(g.id);
    });

    if (!selected.length) {
      return res.json({ guilds: [] });
    }

    let onlineByName = {};
    try {
      const ranking = await fetchRankingPlayers();
      onlineByName = ranking.onlineByName || {};
    } catch (err) {
      console.error("ranking for online:", err.message || err);
    }

    const results = [];
    try {
      await withBrowser(async (browser) => {
        for (const g of selected) {
          try {
            const roster = await scrapeGuildRoster(browser, g);
            if (roster.error) {
              results.push({
                id: g.id,
                guild: g.name,
                players: [],
                error: roster.error,
              });
            } else {
              results.push(
                buildOnlineFromRoster(g, roster.members, onlineByName)
              );
            }
          } catch (err) {
            console.error(`online ${g.name}:`, err.message || err);
            results.push({
              id: g.id,
              guild: g.name,
              players: [],
              error: "No se pudo obtener jugadores online. Reintenta.",
            });
          }
        }
      });
    } catch (err) {
      console.error("browser launch:", err.message || err);
      for (const g of selected) {
        results.push({
          id: g.id,
          guild: g.name,
          players: [],
          error:
            "El servidor no pudo abrir el navegador. Pulsa Actualizar en unos segundos.",
        });
      }
    }

    res.json({ guilds: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cargar online de guilds." });
  }
}

app.post("/api/online", handleOnlineRequest);
app.get("/api/online", handleOnlineRequest);

app.get("/api/ranking", async (_req, res) => {
  try {
    const { players, levelsByName, onlineByName, cached } =
      await fetchRankingPlayers();
    res.json({
      players,
      levelsByName,
      onlineByName,
      pageSize: PAGE_SIZE,
      total: players.length,
      cached,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo obtener el ranking." });
  }
});

app.get("/api/drops", (_req, res) => {
  try {
    const catalog = getCatalog();
    res.json(catalog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo leer el catálogo de drops." });
  }
});

app.listen(PORT, () => {
  console.log(`PjsVivos en http://localhost:${PORT}`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `El puerto ${PORT} está en uso. Prueba: set PORT=3010 && npm start`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
