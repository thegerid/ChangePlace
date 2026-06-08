import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { SESSION_TTL_SECONDS } from "./config.mjs";
import { httpError } from "./utils.mjs";

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

export {
  createPasswordDigest,
  createSession,
  getAuthUser,
  getSessionPayload,
  publicUser,
  requireAuthUser,
  syncUserPointSnapshots,
  verifyPassword,
};
