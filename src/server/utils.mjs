import {
  ALLOWED_POINT_TYPES,
  ALLOWED_STATUSES,
  AVATAR_IDS,
  CITY_IDS,
  DELIVERY_INTERVALS,
  DELIVERY_PRODUCTS,
  FORBIDDEN_TEXT_PATTERNS,
  LOGISTIC_CENTER_REGIONS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MODERATED_FIELDS,
  PASSWORD_MIN_LENGTH,
} from "./config.mjs";

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

function normalizePointType(value) {
  const normalized = normalizeRequiredText(value, "point_type").toLowerCase();
  if (!ALLOWED_POINT_TYPES.has(normalized)) throw httpError(400, "Некорректный тип метки.");
  return normalized;
}

function normalizeStoredPointType(point) {
  return point?.pointType === "delivery" ? "delivery" : "swap";
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

function normalizeDeliveryProduct(value) {
  const normalized = normalizeRequiredText(value, "product_type");
  if (!DELIVERY_PRODUCTS.has(normalized)) throw httpError(400, "Некорректный продукт доставки.");
  return normalized;
}

function normalizeDeliveryInterval(value) {
  const normalized = normalizeRequiredText(value, "delivery_interval");
  if (!DELIVERY_INTERVALS.includes(normalized)) {
    throw httpError(400, "Некорректный интервал доставки.");
  }
  return normalized;
}

function normalizeMeetingAgreed(value) {
  const normalized = normalizeRequiredText(value, "meeting_agreed").toLowerCase();
  if (normalized !== "yes" && normalized !== "no") {
    throw httpError(400, "Поле meeting_agreed должно быть yes или no.");
  }
  return normalized;
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
    const value = fieldName === "full_name" ? payload.fullName : fieldName === "telegram" ? payload.telegram : "";
    if (value && containsForbiddenContent(value)) {
      throw httpError(400, "Недопустимое содержимое: уберите мат или оскорбительные выражения.");
    }
  });
}

function validatePointPayload(payload) {
  if (payload.pointType === "delivery") {
    validateDeliveryPointPayload(payload);
    return;
  }

  MODERATED_FIELDS.forEach((fieldName) => {
    const value = fieldName === "preferred_location" ? payload.preferredLocation : fieldName === "comment" ? payload.comment : "";
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

function validateDeliveryPointPayload(payload) {
  ["deliveryAddress", "comment"].forEach((fieldName) => {
    const value = fieldName === "deliveryAddress" ? payload.deliveryAddress : payload.comment;
    if (value && containsForbiddenContent(value)) {
      throw httpError(400, "Недопустимое содержимое: уберите мат или оскорбительные выражения.");
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
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFullName(value) {
  return normalizeSpaces(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isValidRussianPhone(value) {
  return /^(\+7|7|8)\D*\d{3}\D*\d{3}\D*\d{2}\D*\d{2}$/.test(normalizeSpaces(value));
}

function getPhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function formatPhoneValue(value) {
  const digits = getPhoneDigits(value);
  return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function containsForbiddenContent(value) {
  const normalized = normalizeModerationText(value);
  return FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeModerationText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[0о]/g, "о")
    .replace(/3/g, "з")
    .replace(/4/g, "ч")
    .replace(/6/g, "б")
    .replace(/@/g, "а");
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(item));
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

export {
  containsForbiddenContent,
  estimateAttachmentBytes,
  formatFullName,
  formatPhoneValue,
  getLogisticCenterRegion,
  httpError,
  isValidRussianPhone,
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
  normalizeSpaces,
  normalizeStatus,
  normalizeStoredPointType,
  normalizeTelegram,
  validateDeliveryPointPayload,
  validateLogisticCenter,
  validatePointPayload,
  validateUserPayload,
};
