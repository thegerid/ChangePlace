import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import {
  DATA_FILE,
  HOST,
  LOGISTIC_CENTER_REGIONS,
  PORT,
} from "./src/server/config.mjs";
import {
  createPasswordDigest,
  createSession,
  getAuthUser,
  getSessionPayload,
  publicUser,
  requireAuthUser,
  syncUserPointSnapshots,
  verifyPassword,
} from "./src/server/auth.mjs";
import {
  clearSessionCookie,
  createSessionCookie,
  getSessionToken,
  readJsonBody,
  sendJson,
  serveStatic,
} from "./src/server/http.mjs";
import { cleanupAllActive, withStore } from "./src/server/store.mjs";
import {
  formatFullName,
  getLogisticCenterRegion,
  httpError,
  normalizeAttachments,
  normalizeAvatarId,
  normalizeCityId,
  normalizeCoordinate,
  normalizeDayKey,
  normalizeDeliveryInterval,
  normalizeDeliveryProduct,
  normalizeEmail,
  normalizeMeetingAgreed,
  normalizeOptionalText,
  normalizePassword,
  normalizePhone,
  normalizePointType,
  normalizeRequiredText,
  normalizeStoredPointType,
  normalizeTelegram,
  validateLogisticCenter,
  validatePointPayload,
  validateUserPayload,
} from "./src/server/utils.mjs";
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

  const pointReserveMatch = url.pathname.match(/^\/api\/points\/([^/]+)\/reserve$/);
  if (request.method === "POST" && pointReserveMatch) {
    const pointId = decodeURIComponent(pointReserveMatch[1]);
    const sessionToken = getSessionToken(request);
    const result = await reserveDeliveryPoint(sessionToken, pointId);
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
  const pointType = normalizePointType(body.point_type || "swap");
  const cityId = normalizeCityId(body.city_id);
  const dayKey = normalizeDayKey(body.day_key);
  const lat = normalizeCoordinate(body.lat, -90, 90, "lat");
  const lng = normalizeCoordinate(body.lng, -180, 180, "lng");
  const comment = normalizeOptionalText(body.comment);
  const preferredLocation = pointType === "swap" ? normalizeRequiredText(body.preferred_location, "preferred_location") : "";
  const logisticCenter = pointType === "swap" ? normalizeOptionalText(body.logistic_center) : "";
  const attachments = pointType === "swap" ? normalizeAttachments(body.attachments) : [];
  const deliveryNumber = pointType === "delivery" ? normalizeRequiredText(body.delivery_number, "delivery_number") : "";
  const productType = pointType === "delivery" ? normalizeDeliveryProduct(body.product_type) : "";
  const deliveryInterval = pointType === "delivery" ? normalizeDeliveryInterval(body.delivery_interval) : "";
  const deliveryAddress = pointType === "delivery" ? normalizeRequiredText(body.delivery_address, "delivery_address") : "";
  const meetingAgreed = pointType === "delivery" ? normalizeMeetingAgreed(body.meeting_agreed) : "";

  validatePointPayload({
    pointType,
    preferredLocation,
    comment,
    logisticCenter,
    attachments,
    lat,
    lng,
    deliveryNumber,
    productType,
    deliveryInterval,
    deliveryAddress,
    meetingAgreed,
  });
  if (pointType === "swap") {
    validateLogisticCenter({ logisticCenter, lat, lng });
  }

  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const now = new Date().toISOString();
    const requestedId = normalizeOptionalText(body.point_id);
    let point = requestedId
      ? store.points.find((item) => item.id === requestedId && item.userId === user.id && !item.deletedAt)
      : null;

    if (!point && pointType === "swap") {
      point = store.points.find(
        (item) =>
          item.userId === user.id &&
          item.cityId === cityId &&
          item.dayKey === dayKey &&
          !item.deletedAt &&
          normalizeStoredPointType(item) === "swap",
      );
    }

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
      pointType,
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
      deliveryNumber,
      productType,
      deliveryInterval,
      deliveryAddress,
      meetingAgreed,
      reservedByUserId: pointType === "delivery" ? point.reservedByUserId || "" : "",
      reservedAt: pointType === "delivery" ? point.reservedAt || "" : "",
      updatedAt: now,
      deletedAt: null,
    });

    context.changed = true;
    return { point: publicPoint(point, user.id, store) };
  });
}

async function reserveDeliveryPoint(sessionToken, pointId) {
  const now = new Date().toISOString();
  return withStore((store, context) => {
    const user = requireAuthUser(store, sessionToken, context);
    const point = store.points.find((item) => item.id === pointId && !item.deletedAt);
    if (!point || normalizeStoredPointType(point) !== "delivery") {
      throw httpError(404, "Заявка на доставку не найдена.");
    }
    if (point.userId === user.id) {
      return { point: publicPoint(point, user.id, store) };
    }
    if (point.reservedByUserId && point.reservedByUserId !== user.id) {
      throw httpError(
        409,
        "Метка уже забронирована, дождитесь пока она станет доступна или выберите другую.",
      );
    }

    point.reservedByUserId = user.id;
    point.reservedAt = now;
    point.updatedAt = now;
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
    if (normalizeStoredPointType(target) !== "swap") {
      throw httpError(400, "Обмен доступен только для меток обмена районами.");
    }

    const sourceSameCity = store.points.find(
      (point) =>
        point.userId === user.id &&
        point.dayKey === dayKey &&
        point.cityId === target.cityId &&
        !point.deletedAt &&
        normalizeStoredPointType(point) === "swap",
    );
    const sourceAnyCity =
      sourceSameCity ||
      store.points.find(
        (point) => point.userId === user.id && point.dayKey === dayKey && !point.deletedAt && normalizeStoredPointType(point) === "swap",
      );
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
    if (offer.toUserId !== user.id && offer.fromUserId !== user.id) {
      throw httpError(403, "Отклонить или отменить заявку может только один из участников.");
    }

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
  const pointType = normalizeStoredPointType(point);
  const deliveryDetailsVisible = canViewDeliveryPointDetails(point, userId);
  const contactsVisible =
    pointType === "delivery" ? deliveryDetailsVisible : canViewSwapPointContacts(point, userId, store);
  const isOwn = point.userId === userId;
  return {
    id: point.id,
    is_own: isOwn,
    city_id: point.cityId,
    day_key: point.dayKey,
    point_type: pointType,
    full_name:
      contactsVisible || isOwn
        ? point.fullName
        : pointType === "delivery"
          ? "Заявка на доставку"
          : "Мобильный Банкир",
    phone: contactsVisible ? point.phone || "" : "",
    telegram: contactsVisible ? point.telegram || "" : "",
    contacts_visible: contactsVisible,
    has_private_contacts: Boolean(point.phone || point.telegram),
    preferred_location: pointType === "swap" ? point.preferredLocation || "" : "",
    logistic_center: pointType === "swap" ? point.logisticCenter || "" : "",
    comment: pointType === "delivery" && !deliveryDetailsVisible && !isOwn ? "" : point.comment || "",
    attachments: pointType === "swap" ? (Array.isArray(point.attachments) ? point.attachments : []) : [],
    avatar_id: point.avatarId || "",
    status: point.status,
    lat: point.lat,
    lng: point.lng,
    delivery_number: deliveryDetailsVisible || isOwn ? point.deliveryNumber || "" : "",
    product_type: point.productType || "",
    delivery_interval: point.deliveryInterval || "",
    delivery_address: deliveryDetailsVisible || isOwn ? point.deliveryAddress || "" : "",
    meeting_agreed: deliveryDetailsVisible || isOwn ? point.meetingAgreed || "" : "",
    delivery_details_visible: deliveryDetailsVisible || isOwn,
    delivery_reserved_by_me: pointType === "delivery" && point.reservedByUserId === userId,
    delivery_availability:
      pointType === "delivery"
        ? point.reservedByUserId
          ? point.reservedByUserId === userId
            ? "reserved_by_me"
            : "reserved"
          : "available"
        : "",
    updated_at: point.updatedAt,
  };
}

function canViewSwapPointContacts(point, userId, store) {
  if (!userId) return false;
  if (point.userId === userId) return true;

  return store.offers.some(
    (offer) =>
      offer.status === "accepted" &&
      ((offer.fromUserId === userId && offer.toPointId === point.id) ||
        (offer.toUserId === userId && offer.fromPointId === point.id)),
  );
}

function canViewDeliveryPointDetails(point, userId) {
  if (normalizeStoredPointType(point) !== "delivery") return false;
  if (!userId) return false;
  return point.userId === userId || point.reservedByUserId === userId;
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
