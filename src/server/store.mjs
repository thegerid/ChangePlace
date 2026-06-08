import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { DATA_FILE } from "./config.mjs";

let storeQueue = Promise.resolve();

async function withStore(handler) {
  const run = storeQueue.catch(() => {}).then(async () => {
    const store = await readStore();
    const context = { changed: cleanupStore(store) };
    const result = await handler(store, context);
    if (context.changed) await writeStore(store);
    return result;
  });
  storeQueue = run.catch(() => {});
  return run;
}

async function readStore() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    if (!raw.trim()) return normalizeStore({});
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return normalizeStore({});
  }
}

async function writeStore(store) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), "utf8");
  await rename(tempFile, DATA_FILE);
}

function normalizeStore(store) {
  return {
    version: 3,
    users: Array.isArray(store.users) ? store.users : [],
    sessions: Array.isArray(store.sessions) ? store.sessions : [],
    points: Array.isArray(store.points) ? store.points : [],
    offers: Array.isArray(store.offers) ? store.offers : [],
    stats: {
      successfulExchangesCount: Number(store.stats?.successfulExchangesCount || 0),
      updatedAt: store.stats?.updatedAt || new Date().toISOString(),
    },
    cleanup: {
      lastCleanupDay: store.cleanup?.lastCleanupDay || "",
    },
  };
}

function cleanupStore(store) {
  let changed = cleanupExpiredPointsAndOffers(store);
  const beforeSessions = store.sessions.length;
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  if (store.sessions.length !== beforeSessions) changed = true;
  return changed;
}

function cleanupExpiredPointsAndOffers(store) {
  const { dayKey, hour, minute } = getMoscowClock();
  const cleanupCurrentDay = hour === 23 && minute >= 59 && store.cleanup.lastCleanupDay !== dayKey;
  let changed = false;

  for (const point of store.points) {
    if (!point.deletedAt && (point.dayKey < dayKey || (cleanupCurrentDay && point.dayKey === dayKey))) {
      point.deletedAt = new Date().toISOString();
      changed = true;
    }
  }

  for (const offer of store.offers) {
    if (offer.status === "pending" && (offer.dayKey < dayKey || (cleanupCurrentDay && offer.dayKey === dayKey))) {
      offer.status = "declined";
      offer.respondedAt = offer.respondedAt || new Date().toISOString();
      changed = true;
    }
  }

  if (cleanupCurrentDay) {
    store.cleanup.lastCleanupDay = dayKey;
    changed = true;
  }

  return changed;
}

function cleanupAllActive(store) {
  const now = new Date().toISOString();
  store.points.forEach((point) => {
    if (!point.deletedAt) point.deletedAt = now;
  });
  store.offers.forEach((offer) => {
    if (offer.status === "pending") {
      offer.status = "declined";
      offer.respondedAt = now;
    }
  });
}

function getMoscowClock() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export { cleanupAllActive, readStore, withStore, writeStore };
