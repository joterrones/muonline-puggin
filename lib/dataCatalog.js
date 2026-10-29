const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const DATA_ROOT = path.join(__dirname, "..", "Data");
const ITEMBAGS_DIR = path.join(DATA_ROOT, "ItemBags");
const MAP_DROP_DIR = path.join(
  DATA_ROOT,
  "Items",
  "Drop",
  "EachMonsterMapDrop"
);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  trimValues: true,
  commentPropName: false,
});

let cache = { at: 0, stamp: "", payload: null };

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

function dirStamp(dirPath, filterFn) {
  try {
    return fs
      .readdirSync(dirPath)
      .filter(filterFn || (() => true))
      .map((name) => `${name}:${fileMtime(path.join(dirPath, name))}`)
      .sort()
      .join("|");
  } catch {
    return "";
  }
}

function buildStamp() {
  return [
    fileMtime(path.join(DATA_ROOT, "Monsters", "MonsterList.xml")),
    fileMtime(path.join(DATA_ROOT, "Monsters", "MonsterSpawn.xml")),
    fileMtime(path.join(DATA_ROOT, "Map", "MapList.xml")),
    fileMtime(path.join(DATA_ROOT, "Items", "ItemList.xml")),
    fileMtime(path.join(DATA_ROOT, "Scripts", "ItemBags", "ItemBagScript.lua")),
    fileMtime(path.join(DATA_ROOT, "Items", "Drop", "AllMonsterBag.xml")),
    fileMtime(path.join(DATA_ROOT, "Items", "Drop", "EachMonsterMapList.xml")),
    dirStamp(ITEMBAGS_DIR, (n) => n.endsWith(".xml")),
    dirStamp(MAP_DROP_DIR, (n) => n.endsWith(".xml")),
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

function isEliteMonster(monster, bagFile) {
  if (Number(monster.EliteMonster) === 1) return true;
  if (monster.eliteFlag) return true;
  if (/\(elite\)|elite/i.test(monster.Name || monster.name || "")) return true;
  if (bagFile && /elite/i.test(bagFile)) return true;
  return false;
}

function attrNumber(attrs, name) {
  const m = new RegExp(`${name}="(-?\\d+)"`, "i").exec(attrs);
  return m ? Number(m[1]) : NaN;
}

function attrString(attrs, name) {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(attrs);
  return m ? m[1].trim() : "";
}

function makeItem(cat, index, nameHint, itemNames) {
  const key = `${cat}:${index}`;
  return {
    cat,
    index,
    key,
    name: nameHint || itemNames.get(key) || `Item ${cat}/${index}`,
  };
}

function sortItems(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function mergeItemMaps(...maps) {
  const out = new Map();
  for (const map of maps) {
    if (!map) continue;
    for (const [key, item] of map.entries()) {
      if (!out.has(key)) out.set(key, item);
    }
  }
  return out;
}

function loadItemNames() {
  const xml = safeRead(path.join(DATA_ROOT, "Items", "ItemList.xml"));
  const names = new Map();
  if (!xml) return names;

  const doc = parser.parse(xml);
  const sections = asArray(doc?.ItemList?.Section);
  for (const section of sections) {
    const cat = Number(section.Index);
    if (Number.isNaN(cat)) continue;
    for (const item of asArray(section.Item)) {
      const index = Number(item.Index);
      if (Number.isNaN(index)) continue;
      names.set(`${cat}:${index}`, item.Name || `${cat}:${index}`);
    }
  }
  return names;
}

function loadMaps() {
  const xml = safeRead(path.join(DATA_ROOT, "Map", "MapList.xml"));
  const maps = new Map();
  if (!xml) return maps;

  const doc = parser.parse(xml);
  const list = asArray(doc?.MapList?.DefaultMaps?.Map);
  for (const map of list) {
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
      eliteFlag: Number(m.EliteMonster) === 1,
      isTrap: Number(m.IsTrap) === 1,
    });
  }
  return monsters;
}

function loadSpawnMaps() {
  const xml = safeRead(path.join(DATA_ROOT, "Monsters", "MonsterSpawn.xml"));
  /** @type {Map<number, { number: number, name: string }[]>} */
  const byMonster = new Map();
  if (!xml) return byMonster;

  const doc = parser.parse(xml);
  for (const map of asArray(doc?.MonsterSpawn?.Map)) {
    const mapNumber = Number(map.Number);
    const mapName = map.Name || `Map ${mapNumber}`;
    for (const spot of asArray(map.Spot)) {
      const type = Number(spot.Type);
      // 0 = NPC/Traps
      if (type === 0) continue;
      for (const spawn of asArray(spot.Spawn)) {
        const index = Number(spawn.Index);
        if (Number.isNaN(index)) continue;
        if (!byMonster.has(index)) byMonster.set(index, []);
        const list = byMonster.get(index);
        if (!list.some((m) => m.number === mapNumber)) {
          list.push({ number: mapNumber, name: mapName });
        }
      }
    }
  }
  return byMonster;
}

function loadBagScriptLinks() {
  const lua = safeRead(
    path.join(DATA_ROOT, "Scripts", "ItemBags", "ItemBagScript.lua")
  );
  /** @type {Map<number, string[]>} */
  const links = new Map();
  if (!lua) return links;

  const re =
    /ItemBag\.Add\(\s*BAG_MONSTER\s*,\s*\d+\s*,\s*(\d+)\s*,\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = re.exec(lua))) {
    const id = Number(match[1]);
    const base = match[2];
    if (!links.has(id)) links.set(id, []);
    const list = links.get(id);
    if (!list.includes(base)) list.push(base);
  }
  return links;
}

function extractItemsFromBagXml(xml, itemNames) {
  const items = new Map();
  if (!xml) return items;

  // <Item ... /> <!--Nombre opcional-->  o  <Item ...></Item>
  const re =
    /<Item\b([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/Item>)\s*(?:<!--\s*(.*?)\s*-->)?/gi;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = match[1];
    const comment = (match[2] || "").trim();
    const cat = attrNumber(attrs, "Cat");
    const index = attrNumber(attrs, "Index");
    if (Number.isNaN(cat) || Number.isNaN(index)) continue;
    const key = `${cat}:${index}`;
    if (items.has(key)) continue;
    const named = attrString(attrs, "Name");
    items.set(key, makeItem(cat, index, comment || named, itemNames));
  }

  return items;
}

function monsterIdFromBagFileName(fileName) {
  const patterns = [
    /^Monster_\((\d+)\)_/i,
    /^Monster_(\d+)_/i,
    /^Event_Monster_\((\d+)\)_/i,
    /^Event_Monster_(\d+)_/i,
  ];
  for (const re of patterns) {
    const m = re.exec(fileName);
    if (m) return Number(m[1]);
  }
  return null;
}

function loadMonsterBags(itemNames, scriptLinks) {
  /** @type {Map<number, { files: string[], items: Map<string, any> }>} */
  const bags = new Map();

  function addBag(monsterId, fileName, xml) {
    if (!xml) return;
    if (!bags.has(monsterId)) {
      bags.set(monsterId, { files: [], items: new Map() });
    }
    const entry = bags.get(monsterId);
    if (!entry.files.includes(fileName)) entry.files.push(fileName);
    const extracted = extractItemsFromBagXml(xml, itemNames);
    for (const [key, item] of extracted) {
      if (!entry.items.has(key)) entry.items.set(key, item);
    }
  }

  let files = [];
  try {
    files = fs.readdirSync(ITEMBAGS_DIR).filter((f) => f.endsWith(".xml"));
  } catch {
    return bags;
  }

  for (const [monsterId, bases] of scriptLinks.entries()) {
    for (const base of bases) {
      const fileName = `${base}.xml`;
      addBag(monsterId, fileName, safeRead(path.join(ITEMBAGS_DIR, fileName)));
    }
  }

  for (const file of files) {
    const monsterId = monsterIdFromBagFileName(file);
    if (monsterId == null) continue;
    addBag(monsterId, file, safeRead(path.join(ITEMBAGS_DIR, file)));
  }

  return bags;
}

/** Drops por MonsterID desde EachMonsterMapDrop/*.xml */
function loadEachMonsterMapDrops(itemNames) {
  /** @type {Map<number, Map<string, any>>} */
  const byMonster = new Map();

  let files = [];
  try {
    files = fs.readdirSync(MAP_DROP_DIR).filter((f) => f.endsWith(".xml"));
  } catch {
    return byMonster;
  }

  const dropRe = /<DropItem\b([^>]*?)\/>/gi;

  for (const file of files) {
    const xml = safeRead(path.join(MAP_DROP_DIR, file));
    if (!xml) continue;
    let match;
    while ((match = dropRe.exec(xml))) {
      const attrs = match[1];
      const monsterId = attrNumber(attrs, "MonsterID");
      const cat = attrNumber(attrs, "Cat");
      const index = attrNumber(attrs, "Index");
      if (
        Number.isNaN(monsterId) ||
        Number.isNaN(cat) ||
        Number.isNaN(index)
      ) {
        continue;
      }
      if (!byMonster.has(monsterId)) byMonster.set(monsterId, new Map());
      const items = byMonster.get(monsterId);
      const key = `${cat}:${index}`;
      if (items.has(key)) continue;
      items.set(
        key,
        makeItem(cat, index, attrString(attrs, "Name"), itemNames)
      );
    }
  }

  return byMonster;
}

/**
 * Drops globales por rango de nivel (AllMonsterBag.xml).
 * @returns {{ min: number, max: number, item: any }[]}
 */
function loadAllMonsterLevelDrops(itemNames) {
  const xml = safeRead(
    path.join(DATA_ROOT, "Items", "Drop", "AllMonsterBag.xml")
  );
  /** @type {{ min: number, max: number, item: any }[]} */
  const ranges = [];
  if (!xml) return ranges;

  const dropRe = /<DropItem\b([^>]*?)\/>/gi;
  let match;
  while ((match = dropRe.exec(xml))) {
    const attrs = match[1];
    const cat = attrNumber(attrs, "Cat");
    const index = attrNumber(attrs, "Index");
    if (Number.isNaN(cat) || Number.isNaN(index)) continue;
    const minRaw = attrNumber(attrs, "MonsterMinLevel");
    const maxRaw = attrNumber(attrs, "MonsterMaxLevel");
    const min = Number.isNaN(minRaw) || minRaw < 0 ? 0 : minRaw;
    const max = Number.isNaN(maxRaw) || maxRaw < 0 ? Number.MAX_SAFE_INTEGER : maxRaw;
    ranges.push({
      min,
      max,
      item: makeItem(cat, index, attrString(attrs, "Name"), itemNames),
    });
  }
  return ranges;
}

function itemsForMonsterLevel(level, levelRanges) {
  const items = new Map();
  for (const range of levelRanges) {
    if (level < range.min || level > range.max) continue;
    if (!items.has(range.item.key)) items.set(range.item.key, range.item);
  }
  return items;
}

function buildCatalog() {
  const itemNames = loadItemNames();
  const maps = loadMaps();
  const monsters = loadMonsters();
  const spawnMaps = loadSpawnMaps();
  const scriptLinks = loadBagScriptLinks();
  const bags = loadMonsterBags(itemNames, scriptLinks);
  const mapDrops = loadEachMonsterMapDrops(itemNames);
  const levelRanges = loadAllMonsterLevelDrops(itemNames);

  const rows = [];
  const mapOptions = new Map();
  const itemOptions = new Map();

  const ids = new Set([
    ...monsters.keys(),
    ...bags.keys(),
    ...spawnMaps.keys(),
    ...mapDrops.keys(),
  ]);

  for (const id of ids) {
    const monster = monsters.get(id) || {
      index: id,
      name: `Monster ${id}`,
      level: 0,
      eliteFlag: false,
      isTrap: false,
    };
    if (monster.isTrap) continue;

    const bag = bags.get(id);
    const mapDropItems = mapDrops.get(id);
    const spawn = spawnMaps.get(id) || [];
    const mapList = spawn.map((s) => {
      const fromList = maps.get(s.number);
      const name = fromList?.name || s.name || `Map ${s.number}`;
      mapOptions.set(s.number, name);
      return { number: s.number, name };
    });

    // Solo monstruos con spawn, bag dedicada o drop por mapa
    const hasContext =
      mapList.length > 0 ||
      (bag && bag.items.size > 0) ||
      (mapDropItems && mapDropItems.size > 0);
    if (!hasContext) continue;

    const merged = mergeItemMaps(
      bag?.items,
      mapDropItems,
      itemsForMonsterLevel(monster.level, levelRanges)
    );
    const items = sortItems(merged.values());
    for (const item of items) itemOptions.set(item.key, item.name);

    const bagFile = bag?.files?.[0] || null;
    const elite = isEliteMonster(monster, bagFile);
    if (!items.length && !mapList.length) continue;

    rows.push({
      id,
      name: monster.name,
      level: monster.level,
      type: elite ? "Elite" : "Normal",
      maps: mapList,
      mapNames: mapList.map((m) => m.name),
      items: items.map((i) => ({ key: i.key, name: i.name })),
      itemNames: items.map((i) => i.name),
      bagFile,
      bagFiles: bag?.files || [],
    });
  }

  rows.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name, "es");
  });

  return {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    monsters: rows,
    filters: {
      maps: [...mapOptions.entries()]
        .map(([number, name]) => ({ number, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
      items: [...itemOptions.entries()]
        .map(([key, name]) => ({ key, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
      types: ["Normal", "Elite"],
    },
  };
}

function getCatalog(force = false) {
  const stamp = buildStamp();
  if (!force && cache.payload && cache.stamp === stamp) {
    return { ...cache.payload, cached: true };
  }
  const payload = buildCatalog();
  cache = { at: Date.now(), stamp, payload };
  return { ...payload, cached: false };
}

module.exports = { getCatalog, DATA_ROOT };
