import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(ROOT_DIR, "data", "changeplace-data.json");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_STATUSES = new Set(["search", "agreed", "unavailable"]);

let storeQueue = Promise.resolve();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status, {
      error: status >= 500 ? "server_error" : "request_error",
      message: error.message || "Server error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ChangePlace server: http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, mode: "local", time: new Date().toISOString() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    const deviceId = normalizeDeviceId(url.searchParams.get("device_id"));
    const cityId = normalizeRequiredText(url.searchParams.get("city_id"), "city_id");
    const dayKey = normalizeDayKey(url.searchParams.get("day_key"));

    const result = await withStore((store) => ({
      points: activePoints(store, cityId, dayKey).map((point) => publicPoint(point, deviceId)),
      proposals: visibleOffers(store, deviceId, dayKey).map(publicOffer),
      stats: publicStats(store),
    }));

    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/points") {
    const body = await readJsonBody(request);
    const result = await upsertPoint(body);
    sendJson(response, 200, result);
    return;
  }

  const pointDeleteMatch = url.pathname.match(/^\/api\/points\/([^/]+)$/);
  if (request.method === "DELETE" && pointDeleteMatch) {
    const body = await readJsonBody(request);
    const pointId = decodeURIComponent(pointDeleteMatch[1]);
    await deletePoint(pointId, body);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/offers") {
    const body = await readJsonBody(request);
    const result = await createOffer(body);
    sendJson(response, 200, result);
    return;
  }

  const offerActionMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/(accept|decline)$/);
  if (request.method === "POST" && offerActionMatch) {
    const body = await readJsonBody(request);
    const offerId = decodeURIComponent(offerActionMatch[1]);
    const action = offerActionMatch[2];
    const result = action === "accept" ? await acceptOffer(offerId, body) : await declineOffer(offerId, body);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cleanup") {
    await withStore((store, context) => {
      cleanupAllActive(store);
      context.changed = true;
      return { ok: true };
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  throw httpError(404, "API route not found");
}

async function upsertPoint(body) {
  const deviceId = normalizeDeviceId(body.device_id);
  const cityId = normalizeRequiredText(body.city_id, "city_id");
  const dayKey = normalizeDayKey(body.day_key);
  const fullName = normalizeRequiredText(body.full_name, "full_name");
  const preferredLocation = normalizeRequiredText(body.preferred_location, "preferred_location");
  const status = normalizeStatus(body.status);
  const lat = normalizeCoordinate(body.lat, -90, 90, "lat");
  const lng = normalizeCoordinate(body.lng, -180, 180, "lng");
  const now = new Date().toISOString();

  return withStore((store, context) => {
    const requestedId = normalizeOptionalText(body.point_id);
    let point =
      (requestedId &&
        store.points.find((item) => item.id === requestedId && item.deviceId === deviceId && !item.deletedAt)) ||
      store.points.find(
        (item) =>
          item.deviceId === deviceId &&
          item.cityId === cityId &&
          item.dayKey === dayKey &&
          !item.deletedAt,
      );

    if (!point) {
      point = {
        id: randomUUID(),
        deviceId,
        cityId,
        dayKey,
        createdAt: now,
        deletedAt: null,
      };
      store.points.push(point);
    }

    Object.assign(point, {
      fullName,
      phone: normalizeOptionalText(body.phone),
      telegram: normalizeOptionalText(body.telegram),
      max: normalizeOptionalText(body.max),
      preferredLocation,
      comment: normalizeOptionalText(body.comment),
      status,
      lat,
      lng,
      updatedAt: now,
      deletedAt: null,
    });

    context.changed = true;
    return { point: publicPoint(point, deviceId) };
  });
}

async function deletePoint(pointId, body) {
  const deviceId = normalizeDeviceId(body.device_id);
  return withStore((store, context) => {
    const point = store.points.find((item) => item.id === pointId && item.deviceId === deviceId && !item.deletedAt);
    if (!point) throw httpError(404, "Точка не найдена для этого устройства.");

    point.deletedAt = new Date().toISOString();
    store.offers.forEach((offer) => {
      if (offer.status === "pending" && (offer.fromPointId === point.id || offer.toPointId === point.id)) {
        offer.status = "declined";
        offer.respondedAt = point.deletedAt;
      }
    });
    context.changed = true;
    return { ok: true };
  });
}

async function createOffer(body) {
  const fromDeviceId = normalizeDeviceId(body.from_device_id);
  const toPointId = normalizeRequiredText(body.to_point_id, "to_point_id");
  const dayKey = normalizeDayKey(body.day_key);
  const now = new Date().toISOString();

  return withStore((store, context) => {
    const source = store.points.find(
      (point) => point.deviceId === fromDeviceId && point.dayKey === dayKey && !point.deletedAt,
    );
    if (!source) throw httpError(404, "Сначала добавьте свою точку на карту.");

    const target = store.points.find((point) => point.id === toPointId && point.dayKey === dayKey && !point.deletedAt);
    if (!target) throw httpError(404, "Точка коллеги уже удалена.");
    if (target.deviceId === source.deviceId) throw httpError(400, "Нельзя отправить предложение самому себе.");
    if (target.status === "unavailable") throw httpError(400, "Коллега не готов меняться.");

    const duplicate = store.offers.find(
      (offer) =>
        offer.fromPointId === source.id &&
        offer.toPointId === target.id &&
        offer.status === "pending",
    );
    if (duplicate) return { proposal: publicOffer(duplicate) };

    const offer = {
      id: randomUUID(),
      fromDeviceId: source.deviceId,
      toDeviceId: target.deviceId,
      fromPointId: source.id,
      toPointId: target.id,
      dayKey,
      status: "pending",
      createdAt: now,
      respondedAt: null,
    };
    store.offers.push(offer);
    context.changed = true;
    return { proposal: publicOffer(offer) };
  });
}

async function acceptOffer(offerId, body) {
  const deviceId = normalizeDeviceId(body.device_id);
  const now = new Date().toISOString();

  return withStore((store, context) => {
    const offer = store.offers.find((item) => item.id === offerId && item.status === "pending");
    if (!offer) throw httpError(404, "Заявка не найдена или уже обработана.");
    if (offer.toDeviceId !== deviceId) throw httpError(403, "Принять заявку может только получатель.");

    const source = store.points.find((point) => point.id === offer.fromPointId && !point.deletedAt);
    const target = store.points.find((point) => point.id === offer.toPointId && !point.deletedAt);
    if (!source || !target) throw httpError(404, "Одна из точек уже удалена.");

    const sourceLat = source.lat;
    const sourceLng = source.lng;
    source.lat = target.lat;
    source.lng = target.lng;
    target.lat = sourceLat;
    target.lng = sourceLng;
    source.status = "agreed";
    target.status = "agreed";
    source.updatedAt = now;
    target.updatedAt = now;

    offer.status = "accepted";
    offer.respondedAt = now;
    store.stats.successfulExchangesCount += 1;
    store.stats.updatedAt = now;
    context.changed = true;

    return { proposal: publicOffer(offer), stats: publicStats(store) };
  });
}

async function declineOffer(offerId, body) {
  const deviceId = normalizeDeviceId(body.device_id);
  const now = new Date().toISOString();

  return withStore((store, context) => {
    const offer = store.offers.find((item) => item.id === offerId && item.status === "pending");
    if (!offer) throw httpError(404, "Заявка не найдена или уже обработана.");
    if (offer.toDeviceId !== deviceId) throw httpError(403, "Отклонить заявку может только получатель.");

    offer.status = "declined";
    offer.respondedAt = now;
    context.changed = true;
    return { proposal: publicOffer(offer) };
  });
}

function activePoints(store, cityId, dayKey) {
  return store.points.filter((point) => point.cityId === cityId && point.dayKey === dayKey && !point.deletedAt);
}

function visibleOffers(store, deviceId, dayKey) {
  return store.offers
    .filter(
      (offer) =>
        offer.dayKey === dayKey &&
        (offer.fromDeviceId === deviceId || offer.toDeviceId === deviceId),
    )
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function publicPoint(point, deviceId) {
  return {
    id: point.id,
    is_own: point.deviceId === deviceId,
    city_id: point.cityId,
    day_key: point.dayKey,
    full_name: point.fullName,
    phone: point.phone || "",
    telegram: point.telegram || "",
    max: point.max || "",
    preferred_location: point.preferredLocation,
    comment: point.comment || "",
    status: point.status,
    lat: point.lat,
    lng: point.lng,
    updated_at: point.updatedAt,
  };
}

function publicOffer(offer) {
  return {
    id: offer.id,
    from_point_id: offer.fromPointId,
    to_point_id: offer.toPointId,
    day_key: offer.dayKey,
    status: offer.status,
    created_at: offer.createdAt,
    responded_at: offer.respondedAt || "",
  };
}

function publicStats(store) {
  return {
    successful_exchanges_count: store.stats.successfulExchangesCount,
    updated_at: store.stats.updatedAt,
  };
}

async function withStore(handler) {
  const run = storeQueue.catch(() => {}).then(async () => {
    const store = await readStore();
    const context = { changed: cleanupExpired(store) };
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
    version: 1,
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

function cleanupExpired(store) {
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

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "Слишком большой запрос.");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Некорректный JSON.");
  }
}

async function serveStatic(response, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = resolve(ROOT_DIR, normalize(requestPath).replace(/^[/\\]+/, ""));
  const pathDelta = relative(ROOT_DIR, filePath);

  if (pathDelta.startsWith("..") || pathDelta === "" || pathDelta.includes("..\\") || pathDelta.includes("../")) {
    throw httpError(403, "Forbidden");
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw httpError(404, "Not found");
    response.writeHead(200, {
      "Content-Type": getContentType(extname(filePath)),
      "Cache-Control": filePath.endsWith("config.js") ? "no-store" : "public, max-age=300",
    });
    response.end(await readFile(filePath));
  } catch (error) {
    if (error.status) throw error;
    throw httpError(404, "Not found");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(payload === null ? "" : JSON.stringify(payload));
}

function getContentType(extension) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon",
    }[extension.toLowerCase()] || "application/octet-stream"
  );
}

function normalizeDeviceId(value) {
  const normalized = normalizeRequiredText(value, "device_id");
  if (normalized.length < 16) throw httpError(400, "Некорректный device_id.");
  return normalized.slice(0, 160);
}

function normalizeDayKey(value) {
  const normalized = normalizeRequiredText(value, "day_key");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw httpError(400, "Некорректная дата.");
  return normalized;
}

function normalizeStatus(value) {
  const normalized = normalizeRequiredText(value, "status");
  if (!ALLOWED_STATUSES.has(normalized)) throw httpError(400, "Некорректный статус.");
  return normalized;
}

function normalizeCoordinate(value, min, max, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw httpError(400, `Некорректная координата ${name}.`);
  }
  return number;
}

function normalizeRequiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw httpError(400, `Поле ${name} обязательно.`);
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
