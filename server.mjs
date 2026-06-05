import { createServer } from "node:http";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(ROOT_DIR, "data", "changeplace-data.json");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_STATUSES = new Set(["search", "agreed", "unavailable"]);
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 650000;
const SESSION_COOKIE = "changeplace_session";
const SESSION_TTL_SECONDS = 5 * 24 * 60 * 60;
const PASSWORD_MIN_LENGTH = 8;
const AVATAR_IDS = new Set(["cat-1", "cat-2", "cat-3", "cat-4", "cat-5"]);
const CITY_IDS = new Set(["spb", "msk", "kzn"]);
const LOGISTIC_CENTER_REGIONS = [
  {
    id: "spb",
    label: "Санкт-Петербург",
    bounds: [
      [59.75, 29.55],
      [60.15, 30.75],
    ],
    options: ["Ломоносовская", "Озерки"],
  },
  {
    id: "msk",
    label: "Москва",
    bounds: [
      [55.45, 36.8],
      [56.05, 37.95],
    ],
    options: ["Алтуфьево", "Ленинский", "Стахановская", "ЦСКА"],
  },
];
const MODERATED_FIELDS = ["full_name", "telegram", "preferred_location", "comment"];
const FORBIDDEN_TEXT_PATTERNS = [
  /ху[йеёяию]/i,
  /пизд/i,
  /бля[дт]?/i,
  /(?:^|[^а-яё])(?:е|ё|йо)б[а-яё]*/i,
  /говн/i,
  /дерьм/i,
  /сран/i,
  /муд[ао]/i,
  /гандон/i,
  /залуп/i,
  /дроч/i,
  /секс/i,
  /порно/i,
  /интим/i,
  /эрот/i,
  /минет/i,
  /орал/i,
  /анал/i,
  /проститут/i,
  /шлюх/i,
  /лох/i,
  /лошар/i,
  /дурак/i,
  /дурн/i,
  /дебил/i,
  /идиот/i,
  /кретин/i,
  /урод/i,
  /тупиц/i,
  /мраз/i,
  /твар/i,
  /сук[аи]/i,
  /коз[её]л/i,
];

let storeQueue = Promise.resolve();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      sendJson(request, response, 204, null);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(request, response, status, {
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
    sendJson(request, response, 200, { ok: true, mode: "local", time: new Date().toISOString() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const sessionToken = getSessionToken(request);
    const result = await withStore((store, context) => getSessionPayload(store, sessionToken, context));
    sendJson(request, response, 200, result.body, result.clearCookie ? { "Set-Cookie": clearSessionCookie() } : {});
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJsonBody(request);
    const result = await registerUser(body);
    sendJson(
      request,
      response,
      201,
      { user: publicUser(result.user) },
      { "Set-Cookie": createSessionCookie(result.sessionToken) },
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJsonBody(request);
    const result = await loginUser(body);
    sendJson(
      request,
      response,
      200,
      { user: publicUser(result.user) },
      { "Set-Cookie": createSessionCookie(result.sessionToken) },
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const sessionToken = getSessionToken(request);
    await logoutUser(sessionToken);
    sendJson(request, response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/profile") {
    const body = await readJsonBody(request);
    const sessionToken = getSessionToken(request);
    const result = await updateProfile(sessionToken, body);
    sendJson(request, response, 200, { user: publicUser(result.user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/profile/password") {
    const body = await readJsonBody(request);
    const sessionToken = getSessionToken(request);
    await changePassword(sessionToken, body);
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    const cityId = normalizeCityId(url.searchParams.get("city_id"));
    const dayKey = normalizeDayKey(url.searchParams.get("day_key"));
    const sessionToken = getSessionToken(request);

    const result = await withStore((store, context) => {
      const auth = getAuthUser(store, sessionToken, context);
      return {
        points: activePoints(store, cityId, dayKey).map((point) => publicPoint(point, auth.user?.id || "", store)),
        proposals: visibleOffers(store, auth.user?.id || "", dayKey).map(publicOffer),
        stats: publicStats(store),
      };
    });

    sendJson(request, response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/points") {
    const body = await readJsonBody(request);
    const sessionToken = getSessionToken(request);
    const result = await upsertPoint(sessionToken, body);
    sendJson(request, response, 200, result);
    return;
  }

  const pointDeleteMatch = url.pathname.match(/^\/api\/points\/([^/]+)$/);
  if (request.method === "DELETE" && pointDeleteMatch) {
    const pointId = decodeURIComponent(pointDeleteMatch[1]);
    const sessionToken = getSessionToken(request);
    await deletePoint(sessionToken, pointId);
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/offers") {
    const body = await readJsonBody(request);
    const sessionToken = getSessionToken(request);
    const result = await createOffer(sessionToken, body);
    sendJson(request, response, 200, result);
    return;
  }

  const offerActionMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/(accept|decline)$/);
  if (request.method === "POST" && offerActionMatch) {
    const offerId = decodeURIComponent(offerActionMatch[1]);
    const action = offerActionMatch[2];
    const sessionToken = getSessionToken(request);
    const result =
      action === "accept"
        ? await acceptOffer(sessionToken, offerId)
        : await declineOffer(sessionToken, offerId);
    sendJson(request, response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cleanup") {
    await withStore((store, context) => {
      cleanupAllActive(store);
      context.changed = true;
      return { ok: true };
    });
    sendJson(request, response, 200, { ok: true });
    return;
  }

  throw httpError(404, "API route not found");
}

async function registerUser(body) {
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const fullName = formatFullName(normalizeRequiredText(body.full_name, "full_name"));
  const phone = normalizePhone(body.phone);
  const telegram = normalizeTelegram(body.telegram);
  const cityId = normalizeCityId(body.city_id);
  const avatarId = normalizeAvatarId(body.avatar_id);
  validateUserPayload({ fullName, phone, telegram });

  return withStore((store, context) => {
    const duplicate = store.users.find((user) => user.email === email);
    if (duplicate) throw httpError(409, "Аккаунт с таким email уже зарегистрирован.");

    const now = new Date().toISOString();
    const { salt, hash } = createPasswordDigest(password);
    const user = {
      id: randomUUID(),
      email,
      passwordSalt: salt,
      passwordHash: hash,
      fullName,
      phone,
      telegram,
      cityId,
      avatarId,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    const sessionToken = createSession(store, user.id, now);
    context.changed = true;
    return { user, sessionToken };
  });
}

async function loginUser(body) {
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);

  return withStore((store, context) => {
    const user = store.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw httpError(401, "Неверный email или пароль.");
    }

    const now = new Date().toISOString();
    const sessionToken = createSession(store, user.id, now);
    context.changed = true;
    return { user, sessionToken };
  });
}

async function logoutUser(sessionToken) {
  if (!sessionToken) return;
  await withStore((store, context) => {
    const before = store.sessions.length;
    store.sessions = store.sessions.filter((session) => session.token !== sessionToken);
    if (store.sessions.length !== before) context.changed = true;
    return { ok: true };
  });
}

async function updateProfile(sessionToken, body) {
  const fullName = formatFullName(normalizeRequiredText(body.full_name, "full_name"));
  const phone = normalizePhone(body.phone);
  const telegram = normalizeTelegram(body.telegram);
  const cityId = normalizeCityId(body.city_id);
  const avatarId = normalizeAvatarId(body.avatar_id);
  validateUserPayload({ fullName, phone, telegram });

  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    user.fullName = fullName;
    user.phone = phone;
    user.telegram = telegram;
    user.cityId = cityId;
    user.avatarId = avatarId;
    user.updatedAt = new Date().toISOString();
    syncUserPointSnapshots(store, user.id, user);
    context.changed = true;
    return { user };
  });
}

async function changePassword(sessionToken, body) {
  const currentPassword = normalizePassword(body.current_password, "current_password");
  const newPassword = normalizePassword(body.new_password, "new_password");
  if (currentPassword === newPassword) {
    throw httpError(400, "Новый пароль должен отличаться от текущего.");
  }

  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
      throw httpError(401, "Текущий пароль введен неверно.");
    }

    const { salt, hash } = createPasswordDigest(newPassword);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.updatedAt = new Date().toISOString();
    context.changed = true;
    return { ok: true };
  });
}

async function upsertPoint(sessionToken, body) {
  const cityId = normalizeCityId(body.city_id);
  const dayKey = normalizeDayKey(body.day_key);
  const preferredLocation = normalizeRequiredText(body.preferred_location, "preferred_location");
  const lat = normalizeCoordinate(body.lat, -90, 90, "lat");
  const lng = normalizeCoordinate(body.lng, -180, 180, "lng");
  const comment = normalizeOptionalText(body.comment);
  const logisticCenter = normalizeOptionalText(body.logistic_center);
  const attachments = normalizeAttachments(body.attachments);

  validatePointPayload({ preferredLocation, comment, logisticCenter, attachments, lat, lng });
  validateLogisticCenter({ logisticCenter, lat, lng });

  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const now = new Date().toISOString();
    const requestedId = normalizeOptionalText(body.point_id);
    let point =
      (requestedId &&
        store.points.find((item) => item.id === requestedId && item.userId === user.id && !item.deletedAt)) ||
      store.points.find(
        (item) => item.userId === user.id && item.cityId === cityId && item.dayKey === dayKey && !item.deletedAt,
      );

    if (!point) {
      point = {
        id: randomUUID(),
        userId: user.id,
        cityId,
        dayKey,
        createdAt: now,
        deletedAt: null,
      };
      store.points.push(point);
    }

    Object.assign(point, {
      fullName: user.fullName,
      phone: user.phone,
      telegram: user.telegram,
      avatarId: user.avatarId,
      preferredLocation,
      logisticCenter,
      comment,
      attachments,
      status: point.status || "search",
      lat,
      lng,
      updatedAt: now,
      deletedAt: null,
    });

    context.changed = true;
    return { point: publicPoint(point, user.id, store) };
  });
}

async function deletePoint(sessionToken, pointId) {
  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const point = store.points.find((item) => item.id === pointId && item.userId === user.id && !item.deletedAt);
    if (!point) throw httpError(404, "Точка не найдена для этого аккаунта.");

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

async function createOffer(sessionToken, body) {
  const toPointId = normalizeRequiredText(body.to_point_id, "to_point_id");
  const dayKey = normalizeDayKey(body.day_key);
  const now = new Date().toISOString();

  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const target = store.points.find((point) => point.id === toPointId && point.dayKey === dayKey && !point.deletedAt);
    if (!target) throw httpError(404, "Точка коллеги уже удалена.");

    const sourceSameCity = store.points.find(
      (point) =>
        point.userId === user.id &&
        point.dayKey === dayKey &&
        point.cityId === target.cityId &&
        !point.deletedAt,
    );
    const sourceAnyCity =
      sourceSameCity ||
      store.points.find((point) => point.userId === user.id && point.dayKey === dayKey && !point.deletedAt);
    if (sourceAnyCity && sourceAnyCity.cityId !== target.cityId) {
      throw httpError(400, "Поменяться районами с коллегой из другого города нельзя.");
    }
    const source = sourceAnyCity;
    if (!source) throw httpError(404, "Сначала добавьте свою точку на карту.");
    if (target.userId === source.userId) throw httpError(400, "Нельзя отправить предложение самому себе.");
    if (target.status === "unavailable") throw httpError(400, "Коллега не готов меняться.");
    if (isExchangeBlockedByLogisticCenter(source, target)) {
      throw httpError(400, "Поменяться районами с коллегой из другого ЛЦ нельзя.");
    }

    const duplicate = store.offers.find(
      (offer) => offer.fromPointId === source.id && offer.toPointId === target.id && offer.status === "pending",
    );
    if (duplicate) return { proposal: publicOffer(duplicate) };

    const offer = {
      id: randomUUID(),
      fromUserId: source.userId,
      toUserId: target.userId,
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

async function acceptOffer(sessionToken, offerId) {
  const now = new Date().toISOString();
  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const offer = store.offers.find((item) => item.id === offerId && item.status === "pending");
    if (!offer) throw httpError(404, "Заявка не найдена или уже обработана.");
    if (offer.toUserId !== user.id) throw httpError(403, "Принять заявку может только получатель.");

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

async function declineOffer(sessionToken, offerId) {
  const now = new Date().toISOString();
  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const offer = store.offers.find((item) => item.id === offerId && item.status === "pending");
    if (!offer) throw httpError(404, "Заявка не найдена или уже обработана.");
    if (offer.toUserId !== user.id) throw httpError(403, "Отклонить заявку может только получатель.");

    offer.status = "declined";
    offer.respondedAt = now;
    context.changed = true;
    return { proposal: publicOffer(offer) };
  });
}

function activePoints(store, cityId, dayKey) {
  return store.points.filter((point) => point.cityId === cityId && point.dayKey === dayKey && !point.deletedAt);
}

function visibleOffers(store, userId, dayKey) {
  if (!userId) return [];
  return store.offers
    .filter((offer) => offer.dayKey === dayKey && (offer.fromUserId === userId || offer.toUserId === userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function isExchangeBlockedByLogisticCenter(source, target) {
  if (!source || !target) return false;
  if (source.cityId !== target.cityId) return false;
  const region = LOGISTIC_CENTER_REGIONS.find(
    (item) => item.id === source.cityId && Array.isArray(item.options) && item.options.length > 1,
  );
  if (!region) return false;
  const sourceCenter = String(source.logisticCenter || "").trim();
  const targetCenter = String(target.logisticCenter || "").trim();
  if (!sourceCenter || !targetCenter) return false;
  return sourceCenter !== targetCenter;
}

function publicPoint(point, userId, store) {
  const contactsVisible = canViewPointContacts(point, userId, store);
  const isOwn = point.userId === userId;
  return {
    id: point.id,
    is_own: isOwn,
    city_id: point.cityId,
    day_key: point.dayKey,
    full_name: contactsVisible || isOwn ? point.fullName : "Мобильный Банкир",
    phone: contactsVisible ? point.phone || "" : "",
    telegram: contactsVisible ? point.telegram || "" : "",
    contacts_visible: contactsVisible,
    has_private_contacts: Boolean(point.phone || point.telegram),
    preferred_location: point.preferredLocation,
    logistic_center: point.logisticCenter || "",
    comment: point.comment || "",
    attachments: Array.isArray(point.attachments) ? point.attachments : [],
    avatar_id: point.avatarId || "",
    status: point.status,
    lat: point.lat,
    lng: point.lng,
    updated_at: point.updatedAt,
  };
}

function canViewPointContacts(point, userId, store) {
  if (!userId) return false;
  if (point.userId === userId) return true;

  return store.offers.some(
    (offer) =>
      offer.status === "accepted" &&
      ((offer.fromUserId === userId && offer.toPointId === point.id) ||
        (offer.toUserId === userId && offer.fromPointId === point.id)),
  );
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

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    phone: user.phone,
    telegram: user.telegram,
    city_id: user.cityId,
    avatar_id: user.avatarId,
  };
}

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
    version: 2,
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

function getSessionPayload(store, sessionToken, context) {
  const auth = getAuthUser(store, sessionToken, context);
  if (!auth.user) {
    return {
      body: { authenticated: false, user: null },
      clearCookie: Boolean(sessionToken),
    };
  }
  return {
    body: { authenticated: true, user: publicUser(auth.user) },
    clearCookie: false,
  };
}

function getAuthUser(store, sessionToken, context) {
  if (!sessionToken) return { user: null, session: null };
  const session = store.sessions.find((item) => item.token === sessionToken);
  if (!session) return { user: null, session: null };

  if (Date.parse(session.expiresAt) <= Date.now()) {
    store.sessions = store.sessions.filter((item) => item.token !== sessionToken);
    context.changed = true;
    return { user: null, session: null };
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user) {
    store.sessions = store.sessions.filter((item) => item.token !== sessionToken);
    context.changed = true;
    return { user: null, session: null };
  }

  return { user, session };
}

function requireAuthUser(store, sessionToken, context) {
  const auth = getAuthUser(store, sessionToken, context);
  if (!auth.user) throw httpError(401, "Требуется регистрация или повторный вход.");
  return auth.user;
}

function createSession(store, userId, nowIso) {
  const token = randomBytes(32).toString("hex");
  store.sessions.push({
    token,
    userId,
    createdAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + SESSION_TTL_SECONDS * 1000).toISOString(),
  });
  return token;
}

function createSessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

function getSessionToken(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return cookies[SESSION_COOKIE] || "";
}

function parseCookies(value) {
  return String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      const key = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
      const rawValue = separatorIndex === -1 ? "" : part.slice(separatorIndex + 1);
      acc[key] = decodeURIComponent(rawValue);
      return acc;
    }, {});
}

function syncUserPointSnapshots(store, userId, user) {
  for (const point of store.points) {
    if (point.userId !== userId || point.deletedAt) continue;
    point.fullName = user.fullName;
    point.phone = user.phone;
    point.telegram = user.telegram;
    point.avatarId = user.avatarId;
    point.updatedAt = new Date().toISOString();
  }
}

function createPasswordDigest(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return derived.length === stored.length && timingSafeEqual(derived, stored);
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
    const cacheControl = getStaticCacheControl(filePath);
    const headers = {
      "Content-Type": getContentType(extname(filePath)),
      "Cache-Control": cacheControl,
    };
    if (cacheControl === "no-store, no-cache, must-revalidate, max-age=0") {
      headers.Pragma = "no-cache";
      headers.Expires = "0";
    }
    response.writeHead(200, headers);
    response.end(await readFile(filePath));
  } catch (error) {
    if (error.status) throw error;
    throw httpError(404, "Not found");
  }
}

function getStaticCacheControl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const noStoreAssets = [
    "/index.html",
    "/app.js",
    "/styles.css",
    "/config.js",
    "/service-worker.js",
    "/manifest.webmanifest",
  ];

  if (noStoreAssets.some((suffix) => normalized.endsWith(suffix))) {
    return "no-store, no-cache, must-revalidate, max-age=0";
  }

  return "public, max-age=300";
}

function sendJson(request, response, status, payload, extraHeaders = {}) {
  const origin = request.headers.origin || "";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    ...extraHeaders,
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin, Cookie";
  } else {
    headers["Access-Control-Allow-Origin"] = process.env.CORS_ORIGIN || "*";
    headers.Vary = "Cookie";
  }

  response.writeHead(status, headers);
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

function normalizeCityId(value) {
  const normalized = normalizeRequiredText(value, "city_id").toLowerCase();
  if (!CITY_IDS.has(normalized)) throw httpError(400, "Некорректный город.");
  return normalized;
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

function normalizeEmail(value) {
  const normalized = normalizeRequiredText(value, "email").toLowerCase();
  if (!/^[a-z0-9._%+-]+@alfabank\.ru$/i.test(normalized)) {
    throw httpError(400, "Можно использовать только корпоративный email.");
  }
  return normalized;
}

function normalizePassword(value, fieldName = "password") {
  const normalized = String(value || "");
  if (normalized.length < PASSWORD_MIN_LENGTH || normalized.length > 120) {
    throw httpError(400, `Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до 120 символов.`);
  }
  if (/^\s+$/.test(normalized)) {
    throw httpError(400, `Поле ${fieldName} заполнено некорректно.`);
  }
  return normalized;
}

function normalizePhone(value) {
  const normalized = normalizeRequiredText(value, "phone");
  if (!isValidRussianPhone(normalized)) {
    throw httpError(400, "Введите номер по шаблону +7 999 123-45-67.");
  }
  return formatPhoneValue(normalized);
}

function normalizeTelegram(value) {
  const normalized = normalizeRequiredText(value, "telegram");
  if (!/^@?[a-z0-9_]{3,32}$/i.test(normalized)) {
    throw httpError(400, "Укажите корректный ник Telegram.");
  }
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function normalizeAvatarId(value) {
  const normalized = normalizeRequiredText(value, "avatar_id");
  if (!AVATAR_IDS.has(normalized)) throw httpError(400, "Некорректный аватар.");
  return normalized;
}

function validateUserPayload(payload) {
  if (!isValidFullName(payload.fullName)) {
    throw httpError(400, "Введите Фамилию и Имя кириллицей. Отчество можно не указывать.");
  }

  MODERATED_FIELDS.forEach((fieldName) => {
    const value =
      fieldName === "full_name"
        ? payload.fullName
        : fieldName === "telegram"
          ? payload.telegram
          : "";
    if (value && containsForbiddenContent(value)) {
      throw httpError(400, "Недопустимое содержимое: уберите мат или оскорбительные выражения.");
    }
  });
}

function validatePointPayload(payload) {
  MODERATED_FIELDS.forEach((fieldName) => {
    const value =
      fieldName === "preferred_location"
        ? payload.preferredLocation
        : fieldName === "comment"
          ? payload.comment
          : "";
    if (value && containsForbiddenContent(value)) {
      throw httpError(400, "Недопустимое содержимое: уберите мат или оскорбительные выражения.");
    }
  });

  if (payload.attachments.length > MAX_ATTACHMENTS) {
    throw httpError(400, `Можно прикрепить не более ${MAX_ATTACHMENTS} фото.`);
  }

  payload.attachments.forEach((attachment) => {
    if (estimateAttachmentBytes(attachment) > MAX_ATTACHMENT_BYTES) {
      throw httpError(400, "Одно из изображений слишком большое. Выберите файл поменьше.");
    }
  });
}

function getLogisticCenterRegion(lat, lng) {
  const pointLat = Number(lat);
  const pointLng = Number(lng);
  if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) return null;

  return (
    LOGISTIC_CENTER_REGIONS.find((region) => {
      const [[minLat, minLng], [maxLat, maxLng]] = region.bounds;
      return pointLat >= minLat && pointLat <= maxLat && pointLng >= minLng && pointLng <= maxLng;
    }) || null
  );
}

function validateLogisticCenter({ logisticCenter, lat, lng }) {
  const logisticCenterRegion = getLogisticCenterRegion(lat, lng);
  if (!logisticCenterRegion) return;

  if (!logisticCenter) {
    throw httpError(400, `Поле логистический центр обязательно для ${logisticCenterRegion.label}.`);
  }

  if (!logisticCenterRegion.options.includes(logisticCenter)) {
    throw httpError(400, "Некорректный логистический центр.");
  }
}

function isValidFullName(value) {
  if (containsForbiddenContent(value)) return false;

  const parts = normalizeSpaces(value).split(" ");
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every(isLikelyNamePart);
}

function isLikelyNamePart(part) {
  return /^[^\d\s_-]{2,32}(?:-[^\d\s_-]{2,32})?$/u.test(String(part || ""));
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatFullName(value) {
  return normalizeSpaces(value)
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join("-"),
    )
    .join(" ");
}

function isValidRussianPhone(value) {
  return /^7\d{10}$/.test(getPhoneDigits(value));
}

function getPhoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith("7")) digits = `7${digits}`;
  return digits.slice(0, 11);
}

function formatPhoneValue(value) {
  const digits = getPhoneDigits(value);
  const rest = digits.slice(1);
  if (!rest) return "+7 ";

  let formatted = "+7";
  if (rest.length > 0) formatted += ` ${rest.slice(0, 3)}`;
  if (rest.length > 3) formatted += ` ${rest.slice(3, 6)}`;
  if (rest.length > 6) formatted += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) formatted += `-${rest.slice(8, 10)}`;
  return formatted;
}

function containsForbiddenContent(value) {
  const text = normalizeModerationText(value);
  if (!text) return false;
  return FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(text.compact) || pattern.test(text.spaced));
}

function normalizeModerationText(value) {
  const mapped = String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[a@]/g, "а")
    .replace(/e/g, "е")
    .replace(/o/g, "о")
    .replace(/p/g, "р")
    .replace(/c/g, "с")
    .replace(/x/g, "х")
    .replace(/y/g, "у");

  return {
    spaced: mapped,
    compact: mapped.replace(/[^а-яёa-z0-9]+/giu, ""),
  };
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item || "").trim())
    .filter((item) => /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(item))
    .slice(0, MAX_ATTACHMENTS);
}

function estimateAttachmentBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
