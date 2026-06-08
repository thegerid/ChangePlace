import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DATA_FILE = process.env.DATA_FILE || join(ROOT_DIR, "data", "changeplace-data.json");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_STATUSES = new Set(["search", "agreed", "unavailable"]);
const ALLOWED_POINT_TYPES = new Set(["swap", "delivery"]);
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
const DELIVERY_PRODUCTS = new Set(["DC", "CC", "CC2", "RE", "Orange", "Orange PAY", "RKO"]);
const DELIVERY_INTERVALS = buildDeliveryIntervals();
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

function buildDeliveryIntervals() {
  const values = [];
  for (let hour = 9; hour <= 21; hour += 2) {
    const nextHour = hour + 2;
    values.push(`${String(hour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`);
  }
  return values;
}

export {
  ALLOWED_POINT_TYPES,
  ALLOWED_STATUSES,
  AVATAR_IDS,
  CITY_IDS,
  DATA_FILE,
  DELIVERY_INTERVALS,
  DELIVERY_PRODUCTS,
  FORBIDDEN_TEXT_PATTERNS,
  HOST,
  LOGISTIC_CENTER_REGIONS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
  MODERATED_FIELDS,
  PASSWORD_MIN_LENGTH,
  PORT,
  ROOT_DIR,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
};
