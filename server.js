const path = require("path");
const fs = require("fs");
const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;
const GUILDS_FILE = path.join(__dirname, "guilds.json");
const PAGE_SIZE = 20;
const RANKING_TOP = 25000;
const MIN_RANKING_LEVEL = 1200;
const CACHE_MS = 60_000;
const RANKING_CACHE_MS = 5 * 60_000;
const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

const cache = {
  ranking: { data: null, levelsByName: null, at: 0 },
  availableGuilds: { data: null, at: 0 },
  online: new Map(),
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function guildNameToId(name) {
  return Buffer.from(String(name).trim(), "utf8").toString("hex");
}

function readGuilds() {
  try {
    const raw = fs.readFileSync(GUILDS_FILE, "utf8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((g) => ({
        id: String(g.id || guildNameToId(g.name)).toLowerCase(),
        name: String(g.name || "").trim(),
        enabled: g.enabled !== false,
      }))
      .filter((g) => g.name && g.id);
  } catch {
    return [];
  }
}

function writeGuilds(list) {
  const cleaned = list
    .map((g) => ({
      id: String(g.id || guildNameToId(g.name)).toLowerCase(),
      name: String(g.name || "").trim(),
      enabled: g.enabled !== false,
    }))
    .filter((g) => g.name && g.id);
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(cleaned, null, 2));
  return cleaned;
}

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function fetchRankingPlayers() {
  if (cache.ranking.data && Date.now() - cache.ranking.at < RANKING_CACHE_MS) {
    return {
      players: cache.ranking.data,
      levelsByName: cache.ranking.levelsByName || {},
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
  for (const p of all) {
    if (p.name) levelsByName[p.name.toLowerCase()] = p.totalLvl;
  }

  const players = all
    .filter((p) => p.totalLvl >= MIN_RANKING_LEVEL)
    .map((p, i) => ({ ...p, place: i + 1 }));

  cache.ranking = { data: players, levelsByName, at: Date.now() };
  return { players, levelsByName, cached: false };
}

async function fetchAvailableGuilds() {
  if (cache.availableGuilds.data && Date.now() - cache.availableGuilds.at < CACHE_MS) {
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

async function scrapeGuildOnline(browser, guild) {
  const cacheKey = guild.id;
  const hit = cache.online.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return {
      id: guild.id,
      guild: guild.name,
      players: hit.data,
      error: hit.error,
      cached: true,
    };
  }

  const page = await browser.newPage();
  try {
    await page.goto(`https://perumu.com/guild/${guild.id}/DEFAULT`, {
      waitUntil: "networkidle2",
      timeout: 45_000,
    });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Invalid Guild") ||
        [...document.querySelectorAll("table")].some((t) =>
          /Status/i.test(t.innerText)
        ),
      { timeout: 30_000 }
    );

    const result = await page.evaluate(() => {
      if (document.body.innerText.includes("Invalid Guild")) {
        return { invalid: true, players: [] };
      }

      const table = [...document.querySelectorAll("table")].find((t) => {
        const header = t.querySelector("tr");
        return (
          header &&
          /Status/i.test(header.innerText) &&
          /Name/i.test(header.innerText)
        );
      });

      if (!table) return { invalid: false, players: [] };

      const players = [];
      table.querySelectorAll("tr").forEach((row, i) => {
        if (i === 0) return;
        const cols = row.querySelectorAll("td");
        if (cols.length < 7) return;

        const status = cols[6].querySelector("img")?.getAttribute("title");
        if (status !== "Online") return;

        players.push({
          nombre:
            cols[1].querySelector("a")?.innerText.trim() ||
            cols[1].innerText.trim(),
          clase: cols[2].innerText.trim(),
          level: cols[4].innerText.trim(),
          position: cols[5].innerText.trim(),
        });
      });

      return { invalid: false, players };
    });

    if (result.invalid) {
      const error = `El guild ${guild.name} no existe o cambió de nombre en PeruMU.`;
      cache.online.set(cacheKey, { data: [], at: Date.now(), error });
      return {
        id: guild.id,
        guild: guild.name,
        players: [],
        error,
        cached: false,
      };
    }

    cache.online.set(cacheKey, {
      data: result.players,
      at: Date.now(),
      error: null,
    });
    return {
      id: guild.id,
      guild: guild.name,
      players: result.players,
      cached: false,
    };
  } finally {
    await page.close();
  }
}

app.get("/api/guilds", (_req, res) => {
  res.json({ guilds: readGuilds() });
});

app.put("/api/guilds", (req, res) => {
  if (!Array.isArray(req.body?.guilds)) {
    return res.status(400).json({ error: "Envía { guilds: [...] }" });
  }
  const guilds = writeGuilds(req.body.guilds);
  res.json({ guilds });
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

app.get("/api/online", async (req, res) => {
  try {
    const configured = readGuilds();
    const filterIds = String(req.query.ids || "")
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

    const guilds = await withBrowser(async (browser) =>
      Promise.all(
        selected.map((g) =>
          scrapeGuildOnline(browser, g).catch((err) => {
            console.error(err);
            return {
              id: g.id,
              guild: g.name,
              players: [],
              error: "No se pudo obtener jugadores online.",
            };
          })
        )
      )
    );

    res.json({ guilds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cargar online de guilds." });
  }
});

app.get("/api/ranking", async (req, res) => {
  try {
    const { players, levelsByName, cached } = await fetchRankingPlayers();
    res.json({
      players,
      levelsByName,
      pageSize: PAGE_SIZE,
      total: players.length,
      cached,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo obtener el ranking." });
  }
});

app.listen(PORT, () => {
  console.log(`PjsVivos en http://localhost:${PORT}`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} está en uso. Prueba: set PORT=3010 && npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
