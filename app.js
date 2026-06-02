(function () {
  "use strict";

  const STORAGE_KEY = "changeplace:v2";
  const THEME_KEY = "changeplace:theme";
  const DEVICE_KEY = "changeplace:device_id";
  const DEVICE_COOKIE = "changeplace_device_id";
  const LAST_LOCATION_KEY = "changeplace:last_location";
  const tileThemes = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  };

  const cities = {
    spb: {
      id: "spb",
      name: "Санкт-Петербург",
      timeZone: "Europe/Moscow",
      center: [59.93428, 30.3351],
      zoom: 11,
      minZoom: 3,
      bounds: [
        [41.15, -180],
        [82.25, 180],
      ],
    },
  };

  const statuses = {
    search: { label: "Ищу обмен", markerClass: "marker-search", badgeClass: "status-search" },
    agreed: { label: "Уже договорился", markerClass: "marker-agreed", badgeClass: "status-agreed" },
    unavailable: {
      label: "Не готов меняться",
      markerClass: "marker-unavailable",
      badgeClass: "status-unavailable",
    },
  };

  const proposalStatuses = {
    pending: "Ожидает ответа",
    accepted: "Принято",
    declined: "Отказ",
  };
  const MODERATED_TEXT_FIELDS = ["name", "telegram", "max", "location", "comment"];
  const FORBIDDEN_TEXT_PATTERNS = [
    /ху[йеяию]/i,
    /пизд/i,
    /бля[дт]?/i,
    /(?:^|[^а-яё])(?:е|ё|йо)б[а-яё]*/i,
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
  ];

  const dom = {
    map: document.getElementById("map"),
    sheet: document.getElementById("sheet"),
    sheetContent: document.getElementById("sheetContent"),
    sheetClose: document.getElementById("sheetClose"),
    ownPointButton: document.getElementById("ownPointButton"),
    ownPointButtonText: document.getElementById("ownPointButtonText"),
    listButton: document.getElementById("listButton"),
    proposalsButton: document.getElementById("proposalsButton"),
    proposalBadge: document.getElementById("proposalBadge"),
    geoButton: document.getElementById("geoButton"),
    ownerContactsButton: document.getElementById("ownerContactsButton"),
    themeToggle: document.getElementById("themeToggle"),
    cleanupCountdown: document.getElementById("cleanupCountdown"),
    mapHint: document.getElementById("mapHint"),
    toast: document.getElementById("toast"),
    filterBar: document.querySelector(".filter-bar"),
    filters: Array.from(document.querySelectorAll("[data-filter]")),
  };

  let state = loadState();
  let map;
  let baseTileLayer;
  let clusterLayer;
  let activeFilter = "all";
  let pendingLatLng = null;
  let moveMode = false;
  let toastTimer = 0;

  init();

  function init() {
    applyTheme(loadTheme());

    if (!window.L) {
      dom.map.innerHTML =
        '<div class="empty-state">Карта не загрузилась. Проверьте доступ к CDN Leaflet и перезапустите локальный сервер.</div>';
      return;
    }

    const city = cities[state.cityId] || cities.spb;
    const worldBounds = L.latLngBounds([-85.05112878, -180], [85.05112878, 180]);
    const cityBounds = city.bounds ? L.latLngBounds(city.bounds) : worldBounds;
    const initialView = getInitialView(city);
    map = L.map("map", {
      center: initialView.center,
      zoom: initialView.zoom,
      minZoom: city.minZoom,
      maxBounds: cityBounds,
      maxBoundsViscosity: 1,
      worldCopyJump: false,
      zoomControl: false,
    });

    baseTileLayer = L.tileLayer(getTileUrl(loadTheme()), {
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
      maxZoom: 19,
      noWrap: true,
      bounds: worldBounds,
    }).addTo(map);

    clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      maxClusterRadius: 46,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          html: `<span>${cluster.getChildCount()}</span>`,
          className: "cluster-marker",
          iconSize: L.point(46, 46),
        }),
    });
    map.addLayer(clusterLayer);

    map.on("click", handleMapClick);
    bindEvents();
    refresh();
    tryUseGrantedGeolocation();
    updateCountdown();
    setInterval(updateCountdown, 1000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  function bindEvents() {
    dom.sheetClose.addEventListener("click", closeSheet);
    dom.ownPointButton.addEventListener("click", () => {
      const own = getOwnPoint();
      if (own) {
        pendingLatLng = L.latLng(own.lat, own.lng);
        openForm(own);
      } else {
        pendingLatLng = map.getCenter();
        openForm();
        showToast("Можно заполнить данные сейчас, тапнуть карту или нажать «Гео».");
      }
    });

    dom.listButton.addEventListener("click", openNearbyList);
    dom.proposalsButton.addEventListener("click", () => openProposalsScreen("incoming"));
    dom.geoButton.addEventListener("click", locateUser);
    dom.ownerContactsButton.addEventListener("click", openOwnerContacts);
    dom.themeToggle.addEventListener("click", toggleTheme);

    dom.filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        dom.filters.forEach((item) => item.classList.toggle("is-active", item === button));
        refreshMarkers();
      });
    });

    enableFilterBarDrag();
  }

  function enableFilterBarDrag() {
    const bar = dom.filterBar;
    if (!bar) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let moved = false;
    let suppressClick = false;

    bar.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      isDragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      startScrollLeft = bar.scrollLeft;
      bar.classList.add("is-dragging");
      bar.setPointerCapture(event.pointerId);
    });

    bar.addEventListener("pointermove", (event) => {
      if (!isDragging) return;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaX) <= 4 || Math.abs(deltaX) <= Math.abs(deltaY)) return;

      moved = true;
      bar.scrollLeft = startScrollLeft - deltaX;
      event.preventDefault();
    });

    const stopDragging = (event) => {
      if (!isDragging) return;

      isDragging = false;
      bar.classList.remove("is-dragging");
      if (bar.hasPointerCapture(event.pointerId)) {
        bar.releasePointerCapture(event.pointerId);
      }

      if (moved) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 160);
      }
    };

    bar.addEventListener("pointerup", stopDragging);
    bar.addEventListener("pointercancel", stopDragging);
    bar.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  function getInitialView(city) {
    const own = state.points.find((point) => point.id === state.ownPointId || point.deviceId === state.deviceId);
    if (own && isAllowedMapPoint(own)) {
      return { center: [own.lat, own.lng], zoom: 14 };
    }

    const savedLocation = loadLastLocation();
    if (savedLocation && isAllowedMapPoint(savedLocation)) {
      return { center: [savedLocation.lat, savedLocation.lng], zoom: savedLocation.zoom || 13 };
    }

    return { center: city.center, zoom: city.zoom };
  }

  function tryUseGrantedGeolocation() {
    if (!navigator.geolocation || !navigator.permissions) return;

    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state !== "granted") return;
        locateUser({ silent: true, openFormOnNewPoint: false, updateOwnPoint: false });
      })
      .catch(() => {});
  }

  function loadLastLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "null");
      if (!saved) return null;

      const lat = Number(saved.lat);
      const lng = Number(saved.lng);
      const zoom = Number(saved.zoom);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return {
        lat,
        lng,
        zoom: Number.isFinite(zoom) ? zoom : 13,
      };
    } catch {
      return null;
    }
  }

  function saveLastLocation(latLng, zoom = 13) {
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({
        lat: latLng.lat,
        lng: latLng.lng,
        zoom,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  function isAllowedMapPoint(point) {
    const city = cities[state.cityId] || cities.spb;
    if (!city.bounds) return true;

    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    return L.latLngBounds(city.bounds).contains(L.latLng(lat, lng));
  }

  function handleMapClick(event) {
    const own = getOwnPoint();
    pendingLatLng = event.latlng;

    if (moveMode && own) {
      updateOwnLocation(event.latlng, "Местоположение вашей точки обновлено.");
      return;
    }

    if (own) {
      showToast("У вас уже есть активная точка. Откройте «Моя точка», чтобы перенести ее.");
      return;
    }

    openForm();
  }

  function locateUser(options = {}) {
    const { silent = false, openFormOnNewPoint = true, updateOwnPoint = true } = options;

    if (!navigator.geolocation) {
      if (!silent) showToast("Геолокация недоступна в этом браузере.");
      return;
    }

    if (!silent) dom.geoButton.classList.add("is-active");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = L.latLng(position.coords.latitude, position.coords.longitude);
        if (!isAllowedMapPoint(latLng)) {
          if (!silent) {
            dom.geoButton.classList.remove("is-active");
            showToast("Геолокация вне доступной области карты.");
          }
          return;
        }

        pendingLatLng = latLng;
        saveLastLocation(latLng, 15);
        map.setView(latLng, 15);
        if (!silent) dom.geoButton.classList.remove("is-active");

        if (getOwnPoint() && updateOwnPoint) {
          updateOwnLocation(latLng, "Точка перенесена по геолокации.");
        } else if (!getOwnPoint() && openFormOnNewPoint) {
          openForm();
          if (!silent) showToast("Геолокация найдена. Заполните карточку для публикации.");
        }
      },
      () => {
        if (!silent) {
          dom.geoButton.classList.remove("is-active");
          showToast("Не удалось получить геолокацию. Можно поставить точку вручную.");
        }
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
    );
  }

  function openForm(existingPoint) {
    const own = existingPoint || getOwnPoint();
    const latLng = pendingLatLng || (own ? L.latLng(own.lat, own.lng) : map.getCenter());
    const isEdit = Boolean(own);
    const phoneValue = formatPhoneValue(own?.phone || "+7 ");

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${isEdit ? "Моя точка" : "Добавить себя на карту"}</h2>
      <p class="sheet-subtitle">
        ${isEdit ? "Обновите статус, контакты или расположение." : "Точка появится на карте для всех пользователей макета."}
      </p>
      <div class="public-warning">
        Ваши данные будут видны всем пользователям карты до 23:59 по времени выбранного города.
      </div>
      <form class="form-grid" id="pointForm" novalidate>
        <label class="field" data-field="name">
          <span>ФИО *</span>
          <input name="name" autocomplete="name" value="${escapeAttr(own?.name || "")}" />
          <small class="field-error">Введите Фамилию Имя Отчество кириллицей.</small>
        </label>
        <label class="field" data-field="phone">
          <span>Телефон</span>
          <input name="phone" inputmode="tel" autocomplete="tel" maxlength="18" placeholder="+7 999 123-45-67" value="${escapeAttr(phoneValue)}" />
          <small class="field-error">Введите номер по шаблону +7 999 123-45-67.</small>
        </label>
        <label class="field" data-field="telegram">
          <span>Telegram</span>
          <input name="telegram" autocomplete="off" placeholder="@username" value="${escapeAttr(own?.telegram || "")}" />
          <small class="field-error">Укажите Telegram или другой канал связи.</small>
        </label>
        <label class="field" data-field="max">
          <span>MAX</span>
          <input name="max" autocomplete="off" placeholder="@username или ссылка" value="${escapeAttr(own?.max || "")}" />
          <small class="field-error">Укажите MAX или другой канал связи.</small>
        </label>
        <label class="field" data-field="location">
          <span>Предпочтительная локация для обмена *</span>
          <input name="location" autocomplete="off" placeholder="Например, Петроградка или юг города" value="${escapeAttr(own?.location || "")}" />
          <small class="field-error">Укажите желаемую локацию.</small>
        </label>
        <label class="field" data-field="status">
          <span>Статус *</span>
          <select name="status">
            ${Object.entries(statuses)
              .map(
                ([value, status]) =>
                  `<option value="${value}" ${own?.status === value ? "selected" : ""}>${status.label}</option>`,
              )
              .join("")}
          </select>
          <small class="field-error">Выберите статус.</small>
        </label>
        <label class="field" data-field="comment">
          <span>Комментарий</span>
          <textarea name="comment" placeholder="Например, когда удобно созвониться">${escapeHtml(own?.comment || "")}</textarea>
          <small class="field-error">Комментарий не должен содержать мат или пошлый контекст.</small>
        </label>
        <label class="checkbox-field">
          <input name="privacy" type="checkbox" ${isEdit ? "checked" : ""} />
          <span>Понимаю, что указанные контакты и комментарий публичны до автоматической очистки.</span>
        </label>
        <input type="hidden" name="lat" value="${latLng.lat}" />
        <input type="hidden" name="lng" value="${latLng.lng}" />
        <div class="button-grid">
          <button class="action-button primary" type="submit">${isEdit ? "Сохранить изменения" : "Опубликовать точку"}</button>
          <button class="action-button" id="pickOnMap" type="button">Выбрать на карте</button>
          <button class="action-button" id="useGeoInForm" type="button">Показать меня</button>
          ${isEdit ? '<button class="action-button danger" id="deletePoint" type="button">Удалить точку</button>' : ""}
        </div>
      </form>
    `;

    const form = document.getElementById("pointForm");
    form.addEventListener("submit", handleFormSubmit);
    form.querySelectorAll("input, textarea, select").forEach((field) => {
      field.addEventListener("input", () => clearFieldError(field));
      field.addEventListener("change", () => clearFieldError(field));
    });
    const phoneInput = form.elements.phone;
    ensurePhonePrefix(phoneInput);
    phoneInput.addEventListener("focus", () => ensurePhonePrefix(phoneInput));
    phoneInput.addEventListener("input", () => formatPhoneField(phoneInput));

    document.getElementById("pickOnMap").addEventListener("click", () => {
      closeSheet();
      showToast(isEdit ? "Тапните новое место точки на карте." : "Тапните место на карте, затем заполните карточку.");
    });

    document.getElementById("useGeoInForm").addEventListener("click", locateUser);

    const deleteButton = document.getElementById("deletePoint");
    if (deleteButton) {
      deleteButton.addEventListener("click", deleteOwnPoint);
    }

    openSheet();
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const required = ["name", "location", "status"];
    let firstInvalid = null;
    let hasMissingRequired = false;
    let hasFormatError = false;
    let hasForbiddenContent = false;

    required.forEach((name) => {
      const input = form.elements[name];
      const value = String(formData.get(name) || "").trim();
      if (!value) {
        setFieldError(input);
        firstInvalid = firstInvalid || input;
        hasMissingRequired = true;
      }
    });

    const fullName = normalizeSpaces(formData.get("name"));
    if (fullName && !isValidFullName(fullName)) {
      setFieldError(form.elements.name, "Введите Фамилию Имя Отчество кириллицей.");
      firstInvalid = firstInvalid || form.elements.name;
      hasFormatError = true;
    }

    const phoneValue = String(formData.get("phone") || "").trim();
    const phoneFilled = isPhoneFilled(phoneValue);
    if (phoneFilled && !isValidRussianPhone(phoneValue)) {
      setFieldError(form.elements.phone, "Введите номер по шаблону +7 999 123-45-67.");
      firstInvalid = firstInvalid || form.elements.phone;
      hasFormatError = true;
    }

    const hasContact =
      (phoneFilled && isValidRussianPhone(phoneValue)) ||
      ["telegram", "max"].some((name) => String(formData.get(name) || "").trim());
    if (!hasContact) {
      ["phone", "telegram", "max"].forEach((name) =>
        setFieldError(form.elements[name], "Укажите телефон, Telegram или MAX."),
      );
      firstInvalid = firstInvalid || form.elements.phone;
      hasMissingRequired = true;
    }

    MODERATED_TEXT_FIELDS.forEach((name) => {
      const input = form.elements[name];
      const value = String(formData.get(name) || "").trim();
      if (!value || !containsForbiddenContent(value)) return;

      setFieldError(input, "Недопустимое содержание: уберите мат или пошлый контекст.");
      firstInvalid = firstInvalid || input;
      hasForbiddenContent = true;
    });

    if (firstInvalid) {
      if (hasForbiddenContent) {
        showToast("Форма содержит недопустимые выражения. Уберите мат или пошлый контекст.");
      } else if (hasFormatError) {
        showToast("Проверьте ФИО и телефон: данные должны быть в корректном формате.");
      } else if (hasMissingRequired) {
        showToast("Заполните обязательные поля карточки.");
      }
      firstInvalid.focus();
      return;
    }

    if (!form.elements.privacy.checked) {
      firstInvalid = firstInvalid || form.elements.privacy;
      showToast("Перед публикацией подтвердите публичность данных.");
      firstInvalid.focus();
      return;
    }

    const existing = getOwnPoint();
    const duplicate = state.points.find(
      (point) => point.deviceId === state.deviceId && point.id !== existing?.id,
    );
    if (duplicate) {
      state.ownPointId = duplicate.id;
      saveState();
      refresh();
      openCard(duplicate.id);
      showToast("С этого устройства уже есть активная точка.");
      return;
    }

    const point = {
      id: existing?.id || `own-${Date.now()}`,
      deviceId: state.deviceId,
      deviceOwned: true,
      cityId: state.cityId,
      name: formatFullName(fullName),
      phone: phoneFilled ? formatPhoneValue(phoneValue) : "",
      telegram: String(formData.get("telegram") || "").trim(),
      max: String(formData.get("max") || "").trim(),
      location: normalizeSpaces(formData.get("location")),
      status: String(formData.get("status")),
      comment: normalizeSpaces(formData.get("comment")),
      lat: Number(formData.get("lat")),
      lng: Number(formData.get("lng")),
      updatedAt: new Date().toISOString(),
    };
    saveLastLocation(L.latLng(point.lat, point.lng), 14);

    if (existing) {
      const index = state.points.findIndex((item) => item.id === existing.id);
      state.points[index] = point;
    } else {
      state.points.push(point);
      state.ownPointId = point.id;
    }

    saveState();
    refresh();
    openCard(point.id);
    showToast(existing ? "Ваша точка обновлена." : "Точка опубликована на карте.");
  }

  function openCard(pointId) {
    const point = state.points.find((item) => item.id === pointId);
    if (!point) return;

    const isOwn = point.id === state.ownPointId;
    const status = statuses[point.status] || statuses.search;
    const distance = getDistanceLabel(point);
    const openProposal = getActiveProposalWith(point.id);

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${escapeHtml(point.name)}</h2>
      <p class="sheet-subtitle">${escapeHtml(point.location)}${distance ? ` · ${distance}` : ""}</p>
      <div class="status-row">
        <span class="status-badge ${status.badgeClass}">${status.label}</span>
        ${isOwn ? '<span class="status-badge status-own">Моя точка</span>' : ""}
      </div>
      ${
        openProposal
          ? `<div class="proposal-note">Есть активное предложение: ${proposalStatuses[openProposal.status]}.</div>`
          : ""
      }
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Телефон</span>
          <span class="detail-value">${escapeHtml(point.phone || "Не указан")}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Telegram</span>
          <span class="detail-value">${escapeHtml(point.telegram || "Не указан")}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">MAX</span>
          <span class="detail-value">${escapeHtml(point.max || "Не указан")}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Комментарий</span>
          <span class="detail-value">${escapeHtml(point.comment || "Без комментария")}</span>
        </div>
      </div>
      <div class="button-grid">
        ${renderContactAction("phone", point.phone)}
        ${renderContactAction("telegram", point.telegram)}
        ${renderContactAction("max", point.max)}
        ${
          isOwn
            ? '<button class="action-button" id="moveOwnPoint" type="button">Изменить место</button>'
            : '<button class="action-button warn" id="offerExchange" type="button">Предложить обмен</button>'
        }
        <button class="action-button" id="showStatus" type="button">Посмотреть статус</button>
        ${
          isOwn
            ? '<button class="action-button" id="editOwn" type="button">Изменить данные</button><button class="action-button danger" id="deletePoint" type="button">Удалить</button>'
            : ""
        }
      </div>
    `;

    const offerExchange = document.getElementById("offerExchange");
    if (offerExchange) offerExchange.addEventListener("click", () => createProposal(point));

    document.getElementById("showStatus").addEventListener("click", () => {
      showToast(`Статус: ${status.label}. Обновлен сегодня.`);
    });

    const editOwn = document.getElementById("editOwn");
    if (editOwn) editOwn.addEventListener("click", () => openForm(point));

    const moveOwnPoint = document.getElementById("moveOwnPoint");
    if (moveOwnPoint) {
      moveOwnPoint.addEventListener("click", () => {
        moveMode = true;
        closeSheet();
        showToast("Тапните новое место на карте.");
      });
    }

    const deleteButton = document.getElementById("deletePoint");
    if (deleteButton) deleteButton.addEventListener("click", deleteOwnPoint);

    openSheet();
  }

  function renderContactAction(type, value) {
    const labels = {
      phone: "Позвонить",
      telegram: "Telegram",
      max: "MAX",
    };

    if (!value) {
      return `<button class="action-button is-disabled" type="button" disabled>${labels[type]}</button>`;
    }

    if (type === "phone") {
      return `<a class="action-button primary" href="${getTelHref(value)}">${labels[type]}</a>`;
    }

    if (type === "telegram") {
      return `<a class="action-button" href="${getTelegramHref(value)}" target="_blank" rel="noreferrer">${labels[type]}</a>`;
    }

    return `<a class="action-button" href="${getMaxHref(value)}" target="_blank" rel="noreferrer">${labels[type]}</a>`;
  }

  function createProposal(target) {
    const own = getOwnPoint();
    if (!own) {
      showToast("Сначала добавьте свою точку на карту.");
      return;
    }

    if (target.id === own.id) {
      showToast("Нельзя отправить предложение самому себе.");
      return;
    }

    if (target.status === "unavailable") {
      showToast("У коллеги статус «не готов меняться». Можно связаться вручную.");
      return;
    }

    const duplicate = state.proposals.find(
      (proposal) =>
        proposal.fromId === own.id && proposal.toId === target.id && proposal.status === "pending",
    );
    if (duplicate) {
      openProposalsScreen("outgoing");
      showToast("Такое предложение уже есть в исходящих.");
      return;
    }

    state.proposals.push({
      id: `proposal-${Date.now()}`,
      fromId: own.id,
      toId: target.id,
      cityId: state.cityId,
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: "",
    });

    saveState();
    refresh();
    openProposalsScreen("outgoing");
    showToast("Предложение обмена отправлено и сохранено в исходящих.");
  }

  function openProposalsScreen(activeTab) {
    const own = getOwnPoint();
    if (!own) {
      dom.sheetContent.innerHTML = `
        <h2 class="sheet-title">Заявки на обмен</h2>
        <p class="sheet-subtitle">Входящие и исходящие предложения появятся после публикации вашей точки.</p>
        <div class="empty-state">Сначала добавьте себя на карту.</div>
      `;
      openSheet();
      return;
    }

    const incoming = state.proposals.filter((proposal) => proposal.toId === own.id);
    const outgoing = state.proposals.filter((proposal) => proposal.fromId === own.id);
    const list = activeTab === "outgoing" ? outgoing : incoming;

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Заявки на обмен</h2>
      <p class="sheet-subtitle">В MVP без регистрации предложения хранятся внутри сайта и видны с этого устройства.</p>
      <div class="tabs" role="tablist" aria-label="Тип заявок">
        <button class="tab-button ${activeTab === "incoming" ? "is-active" : ""}" type="button" data-proposal-tab="incoming">
          Входящие <span>${incoming.length}</span>
        </button>
        <button class="tab-button ${activeTab === "outgoing" ? "is-active" : ""}" type="button" data-proposal-tab="outgoing">
          Исходящие <span>${outgoing.length}</span>
        </button>
      </div>
      <div class="nearby-list">
        ${
          list.length
            ? list.map((proposal) => renderProposalItem(proposal, activeTab)).join("")
            : '<div class="empty-state">Заявок пока нет.</div>'
        }
      </div>
    `;

    dom.sheetContent.querySelectorAll("[data-proposal-tab]").forEach((button) => {
      button.addEventListener("click", () => openProposalsScreen(button.dataset.proposalTab));
    });

    dom.sheetContent.querySelectorAll("[data-accept-proposal]").forEach((button) => {
      button.addEventListener("click", () => acceptProposal(button.dataset.acceptProposal, activeTab));
    });

    dom.sheetContent.querySelectorAll("[data-decline-proposal]").forEach((button) => {
      button.addEventListener("click", () => declineProposal(button.dataset.declineProposal, activeTab));
    });

    dom.sheetContent.querySelectorAll("[data-open-card]").forEach((button) => {
      button.addEventListener("click", () => openCard(button.dataset.openCard));
    });

    openSheet();
  }

  function renderProposalItem(proposal, activeTab) {
    const own = getOwnPoint();
    const from = getPoint(proposal.fromId);
    const to = getPoint(proposal.toId);
    const colleague = activeTab === "outgoing" ? to : from;
    const canAnswer = proposal.status === "pending" && activeTab === "incoming";
    const canSimulate = proposal.status === "pending" && activeTab === "outgoing";

    return `
      <article class="nearby-item">
        <div class="nearby-head">
          <strong>${escapeHtml(colleague?.name || "Сотрудник удален")}</strong>
          <span class="proposal-status proposal-${proposal.status}">${proposalStatuses[proposal.status]}</span>
        </div>
        <p class="nearby-meta">
          ${activeTab === "outgoing" ? "Вы предложили обмен" : "Вам предложили обмен"}
          ${own && colleague ? ` · ${escapeHtml(colleague.location)}` : ""}
        </p>
        <div class="proposal-route">
          <span>${escapeHtml(from?.location || "точка удалена")}</span>
          <span>меняется с</span>
          <span>${escapeHtml(to?.location || "точка удалена")}</span>
        </div>
        <div class="nearby-actions">
          ${colleague ? `<button type="button" data-open-card="${colleague.id}">Карточка</button>` : ""}
          ${canAnswer ? `<button type="button" data-accept-proposal="${proposal.id}">Принять</button>` : ""}
          ${canAnswer ? `<button type="button" data-decline-proposal="${proposal.id}">Отказаться</button>` : ""}
          ${canSimulate ? `<button type="button" data-accept-proposal="${proposal.id}">Смоделировать принятие</button>` : ""}
          ${canSimulate ? `<button type="button" data-decline-proposal="${proposal.id}">Смоделировать отказ</button>` : ""}
        </div>
      </article>
    `;
  }

  function acceptProposal(proposalId, activeTab) {
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.status !== "pending") return;

    const from = getPoint(proposal.fromId);
    const to = getPoint(proposal.toId);
    if (!from || !to) {
      showToast("Одна из точек уже удалена.");
      return;
    }

    const fromLat = from.lat;
    const fromLng = from.lng;
    from.lat = to.lat;
    from.lng = to.lng;
    to.lat = fromLat;
    to.lng = fromLng;
    from.status = "agreed";
    to.status = "agreed";
    from.updatedAt = new Date().toISOString();
    to.updatedAt = new Date().toISOString();
    proposal.status = "accepted";
    proposal.decidedAt = new Date().toISOString();

    saveState();
    refresh();
    openProposalsScreen(activeTab);
    showToast("Обмен принят. Пользователи автоматически поменялись местами.");
  }

  function declineProposal(proposalId, activeTab) {
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.status !== "pending") return;

    proposal.status = "declined";
    proposal.decidedAt = new Date().toISOString();
    saveState();
    refresh();
    openProposalsScreen(activeTab);
    showToast("Предложение отклонено. Результат виден в заявках.");
  }

  function openNearbyList() {
    const points = getVisiblePoints()
      .slice()
      .sort((a, b) => getDistanceMeters(a) - getDistanceMeters(b));

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Коллеги рядом</h2>
      <p class="sheet-subtitle">Список учитывает текущий фильтр и сортируется по расстоянию от вашей точки или центра города.</p>
      <div class="nearby-list">
        ${
          points.length
            ? points.map(renderNearbyItem).join("")
            : '<div class="empty-state">По выбранному фильтру активных точек нет.</div>'
        }
      </div>
    `;

    dom.sheetContent.querySelectorAll("[data-open-card]").forEach((button) => {
      button.addEventListener("click", () => openCard(button.dataset.openCard));
    });

    openSheet();
  }

  function openOwnerContacts() {
    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Контакты владельца</h2>
      <p class="sheet-subtitle">Связь по вопросам сервиса и доступа.</p>
      <div class="owner-contacts-links in-sheet">
        <a href="https://t.me/demidenca" target="_blank" rel="noreferrer">Telegram</a>
        <a href="https://xlink.achat.best/open/profile/492794fd-65fc-5f2c-9558-a77c7b043416" target="_blank" rel="noreferrer">А-Чат</a>
      </div>
    `;
    openSheet();
  }

  function renderNearbyItem(point) {
    const status = statuses[point.status] || statuses.search;
    return `
      <article class="nearby-item">
        <div class="nearby-head">
          <strong>${escapeHtml(point.name)}</strong>
          <span class="status-badge ${status.badgeClass}">${status.label}</span>
        </div>
        <p class="nearby-meta">${escapeHtml(point.location)} · ${getDistanceLabel(point) || "расстояние не задано"}</p>
        <div class="nearby-actions">
          <button type="button" data-open-card="${point.id}">Карточка</button>
          ${point.phone ? `<a href="${getTelHref(point.phone)}">Позвонить</a>` : ""}
        </div>
      </article>
    `;
  }

  function refresh() {
    const own = getOwnPoint();
    const pendingIncoming = own
      ? state.proposals.filter((proposal) => proposal.toId === own.id && proposal.status === "pending").length
      : 0;

    dom.ownPointButtonText.textContent = own ? "Моя точка" : "Добавить себя";
    dom.proposalBadge.hidden = pendingIncoming === 0;
    dom.proposalBadge.textContent = String(pendingIncoming);
    dom.mapHint.textContent = own
      ? "Ваша точка активна. Откройте «Моя точка», чтобы изменить данные или перенести место."
      : "Тапните по карте, чтобы поставить свою точку, или используйте геолокацию.";

    refreshMarkers();
  }

  function refreshMarkers() {
    if (!clusterLayer) return;
    clusterLayer.clearLayers();

    getVisiblePoints().forEach((point) => {
      const marker = L.marker([point.lat, point.lng], {
        icon: createPersonIcon(point),
        title: point.name,
      });
      marker.on("click", () => openCard(point.id));
      clusterLayer.addLayer(marker);
    });
  }

  function createPersonIcon(point) {
    const status = statuses[point.status] || statuses.search;
    const ownClass = point.id === state.ownPointId ? "marker-own" : "";
    return L.divIcon({
      html: "",
      className: `person-marker ${status.markerClass} ${ownClass}`,
      iconSize: [34, 40],
      iconAnchor: [17, 40],
    });
  }

  function getVisiblePoints() {
    return state.points.filter((point) => {
      if (point.cityId !== state.cityId) return false;
      return activeFilter === "all" || point.status === activeFilter;
    });
  }

  function getOwnPoint() {
    const byId = state.points.find((point) => point.id === state.ownPointId);
    if (byId) return byId;

    const byDevice = state.points.find((point) => point.deviceId === state.deviceId);
    if (byDevice) {
      state.ownPointId = byDevice.id;
      saveState();
      return byDevice;
    }

    return null;
  }

  function getPoint(pointId) {
    return state.points.find((point) => point.id === pointId) || null;
  }

  function getActiveProposalWith(pointId) {
    const own = getOwnPoint();
    if (!own) return null;

    return (
      state.proposals.find(
        (proposal) =>
          proposal.status === "pending" &&
          ((proposal.fromId === own.id && proposal.toId === pointId) ||
            (proposal.toId === own.id && proposal.fromId === pointId)),
      ) || null
    );
  }

  function updateOwnLocation(latLng, message) {
    const own = getOwnPoint();
    if (!own) return;

    own.lat = latLng.lat;
    own.lng = latLng.lng;
    own.updatedAt = new Date().toISOString();
    saveLastLocation(latLng, 14);
    moveMode = false;
    saveState();
    refresh();
    openCard(own.id);
    showToast(message);
  }

  function deleteOwnPoint() {
    const own = getOwnPoint();
    if (!own) return;

    const confirmed = window.confirm("Удалить вашу активную точку с карты?");
    if (!confirmed) return;

    state.points = state.points.filter((point) => point.id !== own.id);
    state.proposals = state.proposals.filter(
      (proposal) => proposal.fromId !== own.id && proposal.toId !== own.id,
    );
    state.ownPointId = null;
    pendingLatLng = null;
    moveMode = false;
    saveState();
    refresh();
    closeSheet();
    showToast("Ваша точка удалена.");
  }

  function loadState() {
    const cityId = "spb";
    const deviceId = ensureDeviceId();
    const dayKey = getDayKey(cities[cityId]);
    const fallback = {
      cityId,
      dayKey,
      deviceId,
      ownPointId: null,
      points: cloneDemoPoints(),
      proposals: [],
    };

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || saved.dayKey !== dayKey) {
        return fallback;
      }

      const normalized = {
        ...fallback,
        ...saved,
        deviceId,
        points: Array.isArray(saved.points)
          ? saved.points
              .filter((point) => !String(point.id || "").startsWith("demo-"))
              .map(normalizePoint)
          : cloneDemoPoints(),
        proposals: Array.isArray(saved.proposals) ? saved.proposals : [],
      };
      const validPointIds = new Set(normalized.points.map((point) => point.id));
      normalized.proposals = normalized.proposals.filter(
        (proposal) => validPointIds.has(proposal.fromId) && validPointIds.has(proposal.toId),
      );
      const own = normalized.points.find((point) => point.deviceId === deviceId);
      normalized.ownPointId = own?.id || null;
      return normalized;
    } catch {
      return fallback;
    }
  }

  function saveState() {
    state.dayKey = getDayKey(cities[state.cityId] || cities.spb);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setDeviceCookie(state.deviceId);
  }

  function ensureDeviceId() {
    const localId = localStorage.getItem(DEVICE_KEY);
    const cookieId = getCookie(DEVICE_COOKIE);
    const deviceId = localId || cookieId || createDeviceId();
    localStorage.setItem(DEVICE_KEY, deviceId);
    setDeviceCookie(deviceId);
    return deviceId;
  }

  function createDeviceId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `dev-${window.crypto.randomUUID()}`;
    }
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function setDeviceCookie(deviceId) {
    document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; max-age=2592000; path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`));
    if (!match) return "";
    return decodeURIComponent(match.split("=").slice(1).join("="));
  }

  function cloneDemoPoints() {
    return [];
  }

  function normalizePoint(point) {
    return {
      ...point,
      phone: point.phone || "",
      telegram: point.telegram || point.messenger || "",
      max: point.max || "",
      status: statuses[point.status] ? point.status : "unavailable",
    };
  }

  function updateCountdown() {
    const city = cities[state.cityId] || cities.spb;
    const now = Date.now();
    const end = getCityEndOfDay(city);
    const left = Math.max(0, end - now);
    const hours = Math.floor(left / 3600000);
    const minutes = Math.floor((left % 3600000) / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    dom.cleanupCountdown.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    if (left === 0) {
      state = {
        cityId: state.cityId,
        dayKey: getDayKey(city),
        deviceId: state.deviceId,
        ownPointId: null,
        points: cloneDemoPoints(),
        proposals: [],
      };
      saveState();
      refresh();
      showToast("Дневные точки очищены. На следующий день нужно добавить себя заново.");
    }
  }

  function getDayKey(city) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: city.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function getCityEndOfDay(city) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: city.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});

    return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 23, 59, 0, 0).getTime();
  }

  function getDistanceMeters(point) {
    const origin = getOwnPoint() || getCityCenterPoint();
    return haversine(origin.lat, origin.lng, point.lat, point.lng);
  }

  function getDistanceLabel(point) {
    const meters = getDistanceMeters(point);
    if (!Number.isFinite(meters)) return "";
    if (meters < 1000) return `${Math.round(meters)} м`;
    return `${(meters / 1000).toFixed(1)} км`;
  }

  function getCityCenterPoint() {
    const city = cities[state.cityId] || cities.spb;
    return { lat: city.center[0], lng: city.center[1] };
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const radius = 6371000;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  function isValidFullName(value) {
    if (containsForbiddenContent(value)) return false;

    const parts = normalizeSpaces(value).split(" ");
    if (parts.length !== 3) return false;

    const patronymic = parts[2].toLowerCase();
    const hasPatronymicEnding = /(вич|вна|ична|инична|оглы|кызы)$/iu.test(patronymic);
    return hasPatronymicEnding && parts.every(isLikelyNamePart);
  }

  function isLikelyNamePart(part) {
    const segments = String(part || "").split("-");
    return segments.every((segment) => {
      const normalized = segment.toLowerCase();
      const hasOnlyCyrillic = /^[а-яё]{2,32}$/iu.test(normalized);
      const hasVowel = /[аеёиоуыэюя]/iu.test(normalized);
      const hasConsonant = /[бвгджзйклмнпрстфхцчшщ]/iu.test(normalized);
      const hasTooManyRepeats = /(.)\1{2,}/iu.test(normalized);
      return hasOnlyCyrillic && hasVowel && hasConsonant && !hasTooManyRepeats;
    });
  }

  function ensurePhonePrefix(input) {
    if (!input.value.trim()) {
      input.value = "+7 ";
    }
  }

  function formatPhoneField(input) {
    input.value = formatPhoneValue(input.value);
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

  function isPhoneFilled(value) {
    return getPhoneDigits(value).length > 1;
  }

  function isValidRussianPhone(value) {
    return /^7\d{10}$/.test(getPhoneDigits(value));
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

  function setFieldError(input, message) {
    const field = input.closest(".field");
    if (!field) return;

    const error = field.querySelector(".field-error");
    if (error) {
      if (!error.dataset.defaultText) error.dataset.defaultText = error.textContent;
      if (message) error.textContent = message;
    }
    field.classList.add("is-invalid");
  }

  function clearFieldError(input) {
    const field = input.closest(".field");
    if (!field) return;

    const error = field.querySelector(".field-error");
    if (error?.dataset.defaultText) error.textContent = error.dataset.defaultText;
    field.classList.remove("is-invalid");
  }

  function openSheet() {
    dom.sheet.classList.add("is-open");
    dom.sheet.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    dom.sheet.classList.remove("is-open");
    dom.sheet.setAttribute("aria-hidden", "true");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, 3200);
  }

  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const isLight = theme === "light";
    dom.themeToggle.setAttribute("aria-pressed", String(isLight));
    dom.themeToggle.setAttribute(
      "aria-label",
      isLight ? "Включить темную тему" : "Включить светлую тему",
    );

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", isLight ? "#f3f5f7" : "#121416");
    if (baseTileLayer) baseTileLayer.setUrl(getTileUrl(theme));
  }

  function getTileUrl(theme) {
    return tileThemes[theme] || tileThemes.dark;
  }

  function getTelHref(phone) {
    return `tel:${String(phone).replace(/[^\d+]/g, "")}`;
  }

  function getTelegramHref(value) {
    const clean = String(value || "").trim();
    if (/^https?:\/\//i.test(clean)) return clean;
    return `https://t.me/${encodeURIComponent(clean.replace(/^@/, ""))}`;
  }

  function getMaxHref(value) {
    const clean = String(value || "").trim();
    if (/^https?:\/\//i.test(clean)) return clean;
    return `https://max.ru/${encodeURIComponent(clean.replace(/^@/, ""))}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
