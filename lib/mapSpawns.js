const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const DATA_ROOT = path.join(__dirname, "..", "Data");
const MAP_SIZE = 256;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  trimValues: true,
});

let cache = { stamp: "", payload: null };

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function fileMtime(filePath) {
  try {
    return String(fs.statSync(filePath).mtimeMs);
  } catch {
    return "0";
  }
}

function buildStamp() {
  return [
    fileMtime(path.join(DATA_ROOT, "Monsters", "MonsterSpawn.xml")),
    fileMtime(path.join(DATA_ROOT, "Monsters", "MonsterList.xml")),
    fileMtime(path.join(DATA_ROOT, "Map", "MapList.xml")),
  ].join("::");
}

function mapNameFromFile(fileName) {
  if (!fileName) return "";
  return String(fileName)
    .replace(/\.att$/i, "")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ")
    .trim();
}

function isEliteMonster(monster) {
  if (!monster) return false;
  if (monster.elite) return true;
  // Solo "(Elite) ..." — evita falsos positivos tipo "Elite Bull Fighter"
  if (/\(elite\)/i.test(monster.name || "")) return true;
  return false;
}

function clampCoord(value, fallback = 0) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(MAP_SIZE - 1, n));
}

function loadMonsters() {
  const xml = safeRead(path.join(DATA_ROOT, "Monsters", "MonsterList.xml"));
  const monsters = new Map();
  if (!xml) return monsters;
  const doc = parser.parse(xml);
  for (const m of asArray(doc?.MonsterList?.Monster)) {
    const index = Number(m.Index);
    if (Number.isNaN(index)) continue;
    monsters.set(index, {
      index,
      name: m.Name || `Monster ${index}`,
      level: Number(m.Level) || 0,
      elite: Number(m.EliteMonster) === 1,
      isTrap: Number(m.IsTrap) === 1,
    });
  }
  return monsters;
}

function loadMapMeta() {
  const xml = safeRead(path.join(DATA_ROOT, "Map", "MapList.xml"));
  const maps = new Map();
  if (!xml) return maps;
  const doc = parser.parse(xml);
  for (const map of asArray(doc?.MapList?.DefaultMaps?.Map)) {
    const number = Number(map.Number);
    if (Number.isNaN(number)) continue;
    maps.set(number, {
      number,
      file: map.File || "",
      name: mapNameFromFile(map.File) || `Map ${number}`,
    });
  }
  return maps;
}

function normalizeSpawn(raw, monsters, spotType) {
  const index = Number(raw.Index);
  if (Number.isNaN(index)) return null;
  const monster = monsters.get(index);
  if (monster?.isTrap) return null;

  const startX = clampCoord(raw.StartX);
  const startY = clampCoord(raw.StartY);
  const hasEnd =
    raw.EndX != null &&
    raw.EndY != null &&
    String(raw.EndX) !== "" &&
    String(raw.EndY) !== "";
  const endX = hasEnd ? clampCoord(raw.EndX, startX) : startX;
  const endY = hasEnd ? clampCoord(raw.EndY, startY) : startY;

  const x1 = Math.min(startX, endX);
  const x2 = Math.max(startX, endX);
  const y1 = Math.min(startY, endY);
  const y2 = Math.max(startY, endY);

  let count = Number(raw.Count);
  if (Number.isNaN(count) || count <= 0) {
    // Type 2/4 = single point → 1
    count = spotType === 1 || spotType === 3 ? 1 : 1;
  }

  const name = monster?.name || `Monster ${index}`;
  const elite = isEliteMonster(monster);

  return {
    index,
    name,
    level: monster?.level || 0,
    count,
    elite,
    distance: Number(raw.Distance) || 0,
    x1,
    y1,
    x2,
    y2,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    point: x1 === x2 && y1 === y2,
  };
}

function buildMapsPayload() {
  const monsters = loadMonsters();
  const mapMeta = loadMapMeta();
  const xml = safeRead(path.join(DATA_ROOT, "Monsters", "MonsterSpawn.xml"));
  const maps = [];

  if (!xml) {
    return {
      generatedAt: new Date().toISOString(),
      mapSize: MAP_SIZE,
      count: 0,
      maps: [],
    };
  }

  const doc = parser.parse(xml);
  for (const mapNode of asArray(doc?.MonsterSpawn?.Map)) {
    const number = Number(mapNode.Number);
    if (Number.isNaN(number)) continue;
    const meta = mapMeta.get(number);
    const name = mapNode.Name || meta?.name || `Map ${number}`;

    const spots = [];
    let spotIdx = 0;
    let totalMonsters = 0;
    let eliteSpots = 0;
    let eliteMonsters = 0;

    for (const spotNode of asArray(mapNode.Spot)) {
      const type = Number(spotNode.Type);
      // 0 = NPC/Traps — omitidos en la vista de monstruos
      if (type === 0) continue;

      const spawns = [];
      for (const spawnNode of asArray(spotNode.Spawn)) {
        const spawn = normalizeSpawn(spawnNode, monsters, type);
        if (!spawn) continue;
        spawns.push(spawn);
      }
      if (!spawns.length) continue;

      const monsterCount = spawns.reduce((sum, s) => sum + s.count, 0);
      const hasElite = spawns.some((s) => s.elite);
      const eliteCount = spawns
        .filter((s) => s.elite)
        .reduce((sum, s) => sum + s.count, 0);

      totalMonsters += monsterCount;
      if (hasElite) eliteSpots += 1;
      eliteMonsters += eliteCount;

      spots.push({
        id: spotIdx++,
        type,
        description: spotNode.Description || `Spot ${spotIdx}`,
        monsterCount,
        eliteCount,
        hasElite,
        spawns,
      });
    }

    if (!spots.length) continue;

    maps.push({
      number,
      name,
      file: meta?.file || "",
      spotCount: spots.length,
      monsterCount: totalMonsters,
      eliteSpots,
      eliteMonsters,
      hasElite: eliteSpots > 0,
      spots,
    });
  }

  maps.sort((a, b) => a.number - b.number);

  return {
    generatedAt: new Date().toISOString(),
    mapSize: MAP_SIZE,
    count: maps.length,
    maps,
  };
}

function getMapSpawns(force = false) {
  const stamp = buildStamp();
  if (!force && cache.payload && cache.stamp === stamp) {
    return { ...cache.payload, cached: true };
  }
  const payload = buildMapsPayload();
  cache = { stamp, payload };
  return { ...payload, cached: false };
}

module.exports = { getMapSpawns, MAP_SIZE, DATA_ROOT };
