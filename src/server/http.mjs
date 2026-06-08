import { readFile, stat } from "node:fs/promises";
import { extname, normalize, relative, resolve } from "node:path";

import { MAX_BODY_BYTES, ROOT_DIR, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./config.mjs";
import { httpError } from "./utils.mjs";

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

export {
  clearSessionCookie,
  createSessionCookie,
  getSessionToken,
  readJsonBody,
  sendJson,
  serveStatic,
};
