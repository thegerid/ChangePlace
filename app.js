(function () {
  "use strict";

  const STORAGE_KEY = "changeplace:v3";
  const THEME_KEY = "changeplace:theme";
  const LAST_LOCATION_KEY = "changeplace:last_location";
  const APP_CONFIG = window.CHANGEPLACE_CONFIG || {};
  const apiBaseUrls = normalizeApiBaseUrls(APP_CONFIG.apiBaseUrl);
  let preferredApiBaseUrl = Array.isArray(apiBaseUrls) ? apiBaseUrls[0] ?? "" : apiBaseUrls;
  const apiClient = apiBaseUrls === null ? null : createApiClient(apiBaseUrls);

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
    msk: {
      id: "msk",
      name: "Москва",
      timeZone: "Europe/Moscow",
      center: [55.7558, 37.6173],
      zoom: 11,
      minZoom: 3,
      bounds: [
        [41.15, -180],
        [82.25, 180],
      ],
    },
    kzn: {
      id: "kzn",
      name: "Казань",
      timeZone: "Europe/Moscow",
      center: [55.796127, 49.106405],
      zoom: 11,
      minZoom: 3,
      bounds: [
        [41.15, -180],
        [82.25, 180],
      ],
    },
  };

  const profileAvatars = [
    { id: "cat-1", label: "Рыжий кот", src: "./assets/avatars/cat-1.svg" },
    { id: "cat-2", label: "Кот в шоке", src: "./assets/avatars/cat-2.svg" },
    { id: "cat-3", label: "Кокетливый кот", src: "./assets/avatars/cat-3.svg" },
    { id: "cat-4", label: "Улыбчивый кот", src: "./assets/avatars/cat-4.svg" },
    { id: "cat-5", label: "Деловой кот", src: "./assets/avatars/cat-5.svg" },
  ];

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

  const logisticCenterRegions = [
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

  const MODERATED_TEXT_FIELDS = ["location", "comment"];
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

  const NEARBY_MAX_DISTANCE_METERS = 60000;
  const MAX_ATTACHMENTS = 3;
  const MAX_ATTACHMENT_DIMENSION = 1280;
  const MAX_ATTACHMENT_BYTES = 380000;
  const DISTRICT_SWAP_URL = "https://goswitch.ru/";
  const DELIVERY_TRAINING_URL = "https://обучениедоставки.рф/";

  const dom = {
    map: document.getElementById("map"),
    sheet: document.getElementById("sheet"),
    sheetContent: document.getElementById("sheetContent"),
    sheetClose: document.getElementById("sheetClose"),
    sideMenuToggle: document.getElementById("sideMenuToggle"),
    sideMenu: document.getElementById("sideMenu"),
    sideMenuClose: document.getElementById("sideMenuClose"),
    brandBlock: document.getElementById("brandBlock"),
    brandAvatarButton: document.getElementById("brandAvatarButton"),
    brandAvatarImage: document.getElementById("brandAvatarImage"),
    brandMark: document.getElementById("brandMark"),
    brandProfileButton: document.getElementById("brandProfileButton"),
    brandTitle: document.getElementById("brandTitle"),
    brandSubtitle: document.getElementById("brandSubtitle"),
    avatarMenu: document.getElementById("avatarMenu"),
    ownPointButton: document.getElementById("ownPointButton"),
    ownPointButtonText: document.getElementById("ownPointButtonText"),
    listButton: document.getElementById("listButton"),
    proposalsButton: document.getElementById("proposalsButton"),
    proposalBadge: document.getElementById("proposalBadge"),
    geoButton: document.getElementById("geoButton"),
    ownerContactsButton: document.getElementById("ownerContactsButton"),
    themeToggle: document.getElementById("themeToggle"),
    cleanupCountdown: document.getElementById("cleanupCountdown"),
    toast: document.getElementById("toast"),
    filterBar: document.querySelector(".filter-bar"),
    filters: Array.from(document.querySelectorAll("[data-filter]")),
    logisticCenterFilterField: document.getElementById("logisticCenterFilterField"),
    logisticCenterFilterSelect: document.getElementById("logisticCenterFilterSelect"),
  };

  let state = loadState();
  let map;
  let baseTileLayer;
  let clusterLayer;
  let markerRegistry = new Map();
  let activeFilter = "all";
  let activeLogisticCenterFilter = "";
  let pendingLatLng = null;
  let moveMode = false;
  let toastTimer = 0;
  let backendReloadTimer = 0;
  let backendPollTimer = 0;
  let avatarMenuOpen = false;
  let sideMenuOpen = false;

  init();

  function init() {
    applyTheme(loadTheme());

    if (!window.L) {
      dom.map.innerHTML = '<div class="empty-state">Карта не загрузилась. Проверьте подключение Leaflet.</div>';
      return;
    }

    const city = getActiveCity();
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
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
      maxZoom: 19,
      noWrap: true,
      bounds: worldBounds,
    }).addTo(map);

    clusterLayer = L.markerClusterGroup({
      animate: true,
      animateAddingMarkers: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      maxClusterRadius: 46,
      removeOutsideVisibleBounds: false,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          html: `<span class="cluster-marker__count">${cluster.getChildCount()}</span>`,
          className: "cluster-marker",
          iconSize: L.point(52, 52),
          iconAnchor: L.point(26, 26),
        }),
    });
    map.addLayer(clusterLayer);

    map.on("click", handleMapClick);
    map.on("moveend zoomend", syncContextFilters);
    bindEvents();
    refreshHeader();
    refresh();
    tryUseGrantedGeolocation();

    if (!apiClient) {
      showToast("Сервер недоступен. Для регистрации и обмена нужен backend.");
      return;
    }

    initBackend().catch((error) => {
      console.error(error);
      showToast(error.message || "Не удалось подключиться к серверу.");
    });
    updateCountdown();
    setInterval(updateCountdown, 1000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).catch(() => {});
    }
  }

  function bindEvents() {
    dom.sheetClose.addEventListener("click", closeSheet);
    dom.ownPointButton.addEventListener("click", handleOwnPointClick);
    dom.listButton.addEventListener("click", openNearbyList);
    dom.proposalsButton.addEventListener("click", () => openProposalsScreen("incoming"));
    dom.geoButton.addEventListener("click", locateUser);
    dom.ownerContactsButton.addEventListener("click", openOwnerContacts);
    dom.themeToggle.addEventListener("click", toggleTheme);
    dom.sideMenuToggle.addEventListener("click", toggleSideMenu);
    dom.sideMenuClose.addEventListener("click", closeSideMenu);
    dom.brandProfileButton.addEventListener("click", () => {
      if (isAuthenticated()) {
        openProfileScreen();
      } else {
        openAuthScreen("register");
      }
    });
    dom.brandAvatarButton.addEventListener("click", () => {
      if (isAuthenticated()) {
        toggleAvatarMenu();
      } else {
        openAuthScreen("register");
      }
    });

    document.addEventListener("click", (event) => {
      if (!avatarMenuOpen) return;
      if (dom.brandBlock.contains(event.target)) return;
      closeAvatarMenu();
    });

    dom.sideMenu.addEventListener("click", (event) => {
      if (event.target.closest("[data-side-menu-close]")) {
        closeSideMenu();
        return;
      }

      const button = event.target.closest("[data-side-menu-action]");
      if (!button) return;
      handleSideMenuAction(button.dataset.sideMenuAction);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (avatarMenuOpen) {
        closeAvatarMenu();
      }
      if (sideMenuOpen) {
        closeSideMenu();
      }
    });

    dom.filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        dom.filters.forEach((item) => item.classList.toggle("is-active", item === button));
        refreshMarkers();
      });
    });

    if (dom.logisticCenterFilterSelect) {
      dom.logisticCenterFilterSelect.addEventListener("change", () => {
        activeLogisticCenterFilter = dom.logisticCenterFilterSelect.value;
        refreshMarkers();
      });
    }
  }

  async function initBackend() {
    await loadSession({ recenter: true });
    await loadRemoteState();
    startBackendPolling();
  }

  function createApiClient(baseUrls) {
    return {
      getSession() {
        return apiRequest(baseUrls, "/api/auth/session");
      },
      register(payload) {
        return apiRequest(baseUrls, "/api/auth/register", { method: "POST", body: payload });
      },
      login(payload) {
        return apiRequest(baseUrls, "/api/auth/login", { method: "POST", body: payload });
      },
      logout() {
        return apiRequest(baseUrls, "/api/auth/logout", { method: "POST", body: {} });
      },
      updateProfile(payload) {
        return apiRequest(baseUrls, "/api/profile", { method: "PATCH", body: payload });
      },
      changePassword(payload) {
        return apiRequest(baseUrls, "/api/profile/password", { method: "POST", body: payload });
      },
      getState(params) {
        return apiRequest(baseUrls, "/api/state", { params });
      },
      upsertPoint(payload) {
        return apiRequest(baseUrls, "/api/points", { method: "POST", body: payload });
      },
      deletePoint(pointId) {
        return apiRequest(baseUrls, `/api/points/${encodeURIComponent(pointId)}`, {
          method: "DELETE",
        });
      },
      createOffer(payload) {
        return apiRequest(baseUrls, "/api/offers", { method: "POST", body: payload });
      },
      acceptOffer(offerId) {
        return apiRequest(baseUrls, `/api/offers/${encodeURIComponent(offerId)}/accept`, {
          method: "POST",
          body: {},
        });
      },
      declineOffer(offerId) {
        return apiRequest(baseUrls, `/api/offers/${encodeURIComponent(offerId)}/decline`, {
          method: "POST",
          body: {},
        });
      },
    };
  }

  async function apiRequest(baseUrl, path, options = {}) {
    if (Array.isArray(baseUrl)) {
      let lastError = null;
      for (const candidateBaseUrl of getOrderedApiBaseUrls(baseUrl)) {
        try {
          return await apiRequest(candidateBaseUrl, path, options);
        } catch (error) {
          lastError = error;
          const status = Number(error?.status || 0);
          if (!(error instanceof TypeError) && ![404, 502, 503, 504].includes(status)) {
            throw error;
          }
        }
      }
      throw lastError || new Error("Сервер временно недоступен.");
    }

    const url = new URL(`${baseUrl}${path}`, window.location.origin);
    Object.entries(options.params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });

    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || "Сервер временно недоступен.");
      error.status = response.status;
      throw error;
    }

    preferredApiBaseUrl = baseUrl;
    return data;
  }

  function normalizeApiBaseUrls(value) {
    if (Array.isArray(value)) {
      const normalized = [];
      value.forEach((item) => {
        if (item === null || item === undefined) return;
        const rawValue = typeof item === "string" ? item.trim() : String(item);
        if (!rawValue && item !== "") return;
        normalized.push(rawValue.replace(/\/+$/, ""));
      });
      return normalized.length ? normalized.filter((item, index) => normalized.indexOf(item) === index) : null;
    }
    if (typeof value === "string") {
      const normalized = value.trim().replace(/\/+$/, "");
      return normalized || value === "" ? normalized : null;
    }
    return null;
  }

  function getOrderedApiBaseUrls(baseUrls) {
    if (!preferredApiBaseUrl) return baseUrls;
    return [preferredApiBaseUrl].concat(baseUrls.filter((item) => item !== preferredApiBaseUrl));
  }

  async function loadSession(options = {}) {
    if (!apiClient) return;
    const { recenter = false } = options;
    const result = await apiClient.getSession();
    state.user = result.authenticated ? normalizeRemoteUser(result.user) : null;
    if (state.user) {
      syncCityWithProfile({ recenter });
    }
    refreshHeader();
    saveState();
  }

  async function loadRemoteState() {
    if (!apiClient) return;

    const city = getActiveCity();
    const dayKey = getDayKey(city);
    const remoteState = await apiClient.getState({
      city_id: state.cityId,
      day_key: dayKey,
    });

    state.dayKey = dayKey;
    state.points = (remoteState.points || []).map(normalizeRemotePoint);
    state.proposals = (remoteState.proposals || []).map(normalizeRemoteProposal);
    const own = state.points.find((point) => point.isOwn);
    state.ownPointId = own?.id || null;
    saveState();
    refresh();
  }

  function scheduleRemoteReload() {
    if (!apiClient) return;
    window.clearTimeout(backendReloadTimer);
    backendReloadTimer = window.setTimeout(() => {
      loadRemoteState().catch((error) => console.error(error));
    }, 250);
  }

  function startBackendPolling() {
    if (backendPollTimer) return;
    backendPollTimer = window.setInterval(scheduleRemoteReload, 15000);
  }

  function normalizeRemoteUser(row) {
    return {
      id: row.id,
      email: row.email,
      name: row.full_name,
      phone: row.phone || "",
      telegram: row.telegram || "",
      cityId: row.city_id,
      avatarId: row.avatar_id || profileAvatars[0].id,
    };
  }

  function normalizeRemotePoint(row) {
    return normalizePoint({
      id: row.id,
      isOwn: Boolean(row.is_own),
      cityId: row.city_id,
      dayKey: row.day_key,
      name: row.full_name,
      phone: row.phone || "",
      telegram: row.telegram || "",
      location: row.preferred_location,
      logisticCenter: row.logistic_center || "",
      comment: row.comment || "",
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      hasPrivateContacts: Boolean(row.has_private_contacts),
      contactsVisible: Boolean(row.contacts_visible),
      avatarId: row.avatar_id || "",
      status: row.status,
      lat: row.lat,
      lng: row.lng,
      updatedAt: row.updated_at,
    });
  }

  function normalizeRemoteProposal(row) {
    return {
      id: row.id,
      fromId: row.from_point_id,
      toId: row.to_point_id,
      cityId: state.cityId,
      dayKey: row.day_key,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.responded_at || "",
    };
  }

  function normalizePoint(point) {
    return {
      ...point,
      phone: point.phone || "",
      telegram: point.telegram || "",
      logisticCenter: point.logisticCenter || "",
      attachments: normalizeAttachments(point.attachments),
      hasPrivateContacts: Boolean(point.hasPrivateContacts ?? Boolean(point.phone || point.telegram)),
      contactsVisible: Boolean(point.contactsVisible ?? point.isOwn),
      avatarId: point.avatarId || "",
      status: statuses[point.status] ? point.status : "search",
    };
  }

  function getInitialView(city) {
    const savedLocation = loadLastLocation();
    if (savedLocation && isAllowedMapPoint(savedLocation)) {
      return { center: [savedLocation.lat, savedLocation.lng], zoom: savedLocation.zoom || 13 };
    }
    return { center: city.center, zoom: city.zoom };
  }

  function loadLastLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "null");
      if (!saved) return null;
      const lat = Number(saved.lat);
      const lng = Number(saved.lng);
      const zoom = Number(saved.zoom);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, zoom: Number.isFinite(zoom) ? zoom : 13 };
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

  function handleOwnPointClick() {
    if (!isAuthenticated()) {
      openAuthScreen("register");
      return;
    }

    const own = getOwnPoint();
    if (own) {
      pendingLatLng = L.latLng(own.lat, own.lng);
      openForm(own);
      return;
    }

    pendingLatLng = map.getCenter();
    openForm();
    showToast("Сначала подтвердите локацию точки, затем заполните карточку.");
  }

  function handleMapClick(event) {
    pendingLatLng = event.latlng;

    if (!isAuthenticated()) {
      openAuthScreen("register");
      showToast("Поставить отметку на карту можно только после регистрации.");
      return;
    }

    const own = getOwnPoint();
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
    const { silent = false, openFormOnNewPoint = true, updateOwnPoint = false } = options;

    if (!navigator.geolocation) {
      if (!silent) showToast("Геолокация не определена.");
      return;
    }

    if (!silent) dom.geoButton.classList.add("is-active");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = L.latLng(position.coords.latitude, position.coords.longitude);
        if (!isAllowedMapPoint(latLng)) {
          if (!silent) {
            dom.geoButton.classList.remove("is-active");
            showToast("Геолокация не определена.");
          }
          return;
        }

        pendingLatLng = latLng;
        saveLastLocation(latLng, 15);
        map.setView(latLng, 15);
        if (!silent) dom.geoButton.classList.remove("is-active");

        if (getOwnPoint() && updateOwnPoint) {
          updateOwnLocation(latLng, "Геолокация определена.");
        } else if (getOwnPoint() && !silent) {
          showToast("Геолокация определена.");
        } else if (!getOwnPoint() && openFormOnNewPoint && isAuthenticated()) {
          openForm();
          if (!silent) showToast("Геолокация определена.");
        }
      },
      () => {
        if (!silent) {
          dom.geoButton.classList.remove("is-active");
          showToast("Геолокация не определена.");
        }
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
    );
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

  function openAuthScreen(activeTab = "register") {
    const registerCityId = state.user?.cityId || state.cityId || "spb";
    const registerAvatarId = state.user?.avatarId || profileAvatars[0].id;

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Регистрация и вход</h2>
      <p class="sheet-subtitle">Точку на карте можно разместить только после регистрации в системе.</p>
      <div class="tabs" role="tablist" aria-label="Регистрация и вход">
        <button class="tab-button ${activeTab === "register" ? "is-active" : ""}" type="button" data-auth-tab="register">Регистрация</button>
        <button class="tab-button ${activeTab === "login" ? "is-active" : ""}" type="button" data-auth-tab="login">Вход</button>
      </div>
      <div id="authPanel">
        ${
          activeTab === "register"
            ? renderRegisterForm(registerCityId, registerAvatarId)
            : renderLoginForm()
        }
      </div>
    `;

    dom.sheetContent.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => openAuthScreen(button.dataset.authTab));
    });

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
      bindAvatarSelector(registerForm, registerAvatarId);
      const phoneInput = registerForm.elements.phone;
      ensurePhonePrefix(phoneInput);
      phoneInput.addEventListener("focus", () => ensurePhonePrefix(phoneInput));
      phoneInput.addEventListener("input", () => formatPhoneField(phoneInput));
      registerForm.addEventListener("submit", handleRegisterSubmit);
      registerForm.querySelectorAll("input, select").forEach((field) => {
        field.addEventListener("input", () => clearFieldError(field));
        field.addEventListener("change", () => clearFieldError(field));
      });
    }

    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", handleLoginSubmit);
      loginForm.querySelectorAll("input").forEach((field) => {
        field.addEventListener("input", () => clearFieldError(field));
      });
      loginForm.querySelectorAll("[data-auth-tab]").forEach((button) => {
        button.addEventListener("click", () => openAuthScreen(button.dataset.authTab));
      });
    }

    openSheet();
  }

  function renderRegisterForm(cityId, avatarId) {
    return `
      <form class="form-grid" id="registerForm" novalidate>
        <label class="field" data-field="full_name">
          <span>ФИО *</span>
          <input name="full_name" autocomplete="name" placeholder="Иванов Иван" />
          <small class="field-error">Введите Фамилию и Имя кириллицей. Отчество можно не указывать.</small>
        </label>
        <label class="field" data-field="phone">
          <span>Телефон *</span>
          <input name="phone" inputmode="tel" autocomplete="tel" maxlength="18" placeholder="+7 999 123-45-67" value="+7 " />
          <small class="field-error">Введите номер по шаблону +7 999 123-45-67.</small>
        </label>
        <label class="field" data-field="telegram">
          <span>Telegram *</span>
          <input name="telegram" autocomplete="off" placeholder="@username" />
          <small class="field-error">Укажите корректный ник Telegram.</small>
        </label>
        <label class="field" data-field="city_id">
          <span>Город работы *</span>
          <select name="city_id">${renderCityOptions(cityId)}</select>
          <small class="field-error">Выберите город работы.</small>
        </label>
        <label class="field" data-field="email">
          <span>Email *</span>
          <input name="email" type="email" autocomplete="email" placeholder="name@alfabank.ru" />
          <small class="field-error">Можно использовать только корпоративный email.</small>
        </label>
        <label class="field" data-field="password">
          <span>Пароль *</span>
          <input name="password" type="password" autocomplete="new-password" placeholder="Минимум 8 символов" />
          <small class="field-error">Пароль должен содержать минимум 8 символов.</small>
        </label>
        <div class="field avatar-field" data-field="avatar_id">
          <span>Аватар *</span>
          <input type="hidden" name="avatar_id" value="${escapeAttr(avatarId)}" />
          <div class="avatar-grid" data-avatar-grid>${renderAvatarChoices(avatarId)}</div>
          <small class="field-error">Выберите один из аватаров.</small>
        </div>
        <div class="button-grid">
          <button class="action-button primary" type="submit">Создать аккаунт</button>
          <button class="action-button" type="button" data-auth-tab="login">У меня уже есть аккаунт</button>
        </div>
      </form>
    `;
  }

  function renderLoginForm() {
    return `
      <form class="form-grid" id="loginForm" novalidate>
        <label class="field" data-field="email">
          <span>Email *</span>
          <input name="email" type="email" autocomplete="email" placeholder="name@alfabank.ru" />
          <small class="field-error">Можно использовать только корпоративный email.</small>
        </label>
        <label class="field" data-field="password">
          <span>Пароль *</span>
          <input name="password" type="password" autocomplete="current-password" />
          <small class="field-error">Введите пароль.</small>
        </label>
        <div class="button-grid">
          <button class="action-button primary" type="submit">Войти</button>
          <button class="action-button" type="button" data-auth-tab="register">Создать аккаунт</button>
        </div>
      </form>
    `;
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      full_name: normalizeSpaces(formData.get("full_name")),
      phone: String(formData.get("phone") || "").trim(),
      telegram: String(formData.get("telegram") || "").trim(),
      city_id: String(formData.get("city_id") || "").trim(),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: String(formData.get("password") || ""),
      avatar_id: String(formData.get("avatar_id") || "").trim(),
    };

    const firstInvalid = validateAuthProfileForm(form, payload, { passwordRequired: true, emailRequired: true });
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    try {
      await apiClient.register(payload);
      await loadSession({ recenter: true });
      await loadRemoteState();
      closeSheet();
      showToast("Аккаунт создан. Теперь можно добавить себя на карту.");
    } catch (error) {
      applyServerFormError(form, error);
      showToast(error.message || "Не удалось создать аккаунт.");
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");

    let firstInvalid = null;
    if (!isValidAlfaEmail(email)) {
      setFieldError(form.elements.email, "Можно использовать только корпоративный email.");
      firstInvalid = form.elements.email;
    }
    if (password.length < 8) {
      setFieldError(form.elements.password, "Введите пароль.");
      firstInvalid = firstInvalid || form.elements.password;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    try {
      await apiClient.login({ email, password });
      await loadSession({ recenter: true });
      await loadRemoteState();
      closeSheet();
      showToast("Вход выполнен.");
    } catch (error) {
      setFieldError(form.elements.password, error.message || "Неверный email или пароль.");
      form.elements.password.focus();
      showToast(error.message || "Не удалось войти.");
    }
  }

  function openProfileScreen() {
    const user = state.user;
    if (!user) {
      openAuthScreen("register");
      return;
    }

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Личный кабинет</h2>
      <p class="sheet-subtitle">Изменения ФИО, телефона и Telegram применяются и к вашей активной точке на карте.</p>
      <form class="form-grid" id="profileForm" novalidate>
        <label class="field" data-field="full_name">
          <span>ФИО *</span>
          <input name="full_name" autocomplete="name" value="${escapeAttr(user.name)}" />
          <small class="field-error">Введите Фамилию и Имя кириллицей. Отчество можно не указывать.</small>
        </label>
        <label class="field" data-field="phone">
          <span>Телефон *</span>
          <input name="phone" inputmode="tel" autocomplete="tel" maxlength="18" value="${escapeAttr(formatPhoneValue(user.phone))}" />
          <small class="field-error">Введите номер по шаблону +7 999 123-45-67.</small>
        </label>
        <label class="field" data-field="telegram">
          <span>Telegram *</span>
          <input name="telegram" autocomplete="off" value="${escapeAttr(user.telegram)}" />
          <small class="field-error">Укажите корректный ник Telegram.</small>
        </label>
        <label class="field" data-field="city_id">
          <span>Город работы *</span>
          <select name="city_id">${renderCityOptions(user.cityId)}</select>
          <small class="field-error">Выберите город работы.</small>
        </label>
        <label class="field">
          <span>Email</span>
          <input value="${escapeAttr(user.email)}" readonly />
        </label>
        <div class="field avatar-field" data-field="avatar_id">
          <span>Аватар *</span>
          <input type="hidden" name="avatar_id" value="${escapeAttr(user.avatarId)}" />
          <div class="avatar-grid" data-avatar-grid>${renderAvatarChoices(user.avatarId)}</div>
          <small class="field-error">Выберите один из аватаров.</small>
        </div>
        <div class="button-grid">
          <button class="action-button primary" type="submit">Сохранить профиль</button>
          <button class="action-button danger" id="logoutButton" type="button">Выйти из аккаунта</button>
        </div>
      </form>
      <form class="form-grid profile-password-form" id="passwordForm" novalidate>
        <h3 class="sheet-title sheet-title-sm">Смена пароля</h3>
        <label class="field" data-field="current_password">
          <span>Текущий пароль *</span>
          <input name="current_password" type="password" autocomplete="current-password" />
          <small class="field-error">Введите текущий пароль.</small>
        </label>
        <label class="field" data-field="new_password">
          <span>Новый пароль *</span>
          <input name="new_password" type="password" autocomplete="new-password" />
          <small class="field-error">Новый пароль должен содержать минимум 8 символов.</small>
        </label>
        <div class="button-grid">
          <button class="action-button" type="submit">Сменить пароль</button>
        </div>
      </form>
    `;

    const profileForm = document.getElementById("profileForm");
    bindAvatarSelector(profileForm, user.avatarId);
    const phoneInput = profileForm.elements.phone;
    ensurePhonePrefix(phoneInput);
    phoneInput.addEventListener("focus", () => ensurePhonePrefix(phoneInput));
    phoneInput.addEventListener("input", () => formatPhoneField(phoneInput));
    profileForm.addEventListener("submit", handleProfileSubmit);
    profileForm.querySelectorAll("input, select").forEach((field) => {
      field.addEventListener("input", () => clearFieldError(field));
      field.addEventListener("change", () => clearFieldError(field));
    });
    document.getElementById("logoutButton").addEventListener("click", handleLogout);

    const passwordForm = document.getElementById("passwordForm");
    passwordForm.addEventListener("submit", handlePasswordSubmit);
    passwordForm.querySelectorAll("input").forEach((field) => {
      field.addEventListener("input", () => clearFieldError(field));
    });

    openSheet();
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      full_name: normalizeSpaces(formData.get("full_name")),
      phone: String(formData.get("phone") || "").trim(),
      telegram: String(formData.get("telegram") || "").trim(),
      city_id: String(formData.get("city_id") || "").trim(),
      avatar_id: String(formData.get("avatar_id") || "").trim(),
    };
    const firstInvalid = validateAuthProfileForm(form, payload, { passwordRequired: false, emailRequired: false });
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    try {
      const result = await apiClient.updateProfile(payload);
      state.user = normalizeRemoteUser(result.user);
      syncCityWithProfile({ recenter: true });
      refreshHeader();
      await loadRemoteState();
      openProfileScreen();
      showToast("Профиль обновлен.");
    } catch (error) {
      applyServerFormError(form, error);
      showToast(error.message || "Не удалось обновить профиль.");
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("current_password") || "");
    const newPassword = String(formData.get("new_password") || "");

    let firstInvalid = null;
    if (currentPassword.length < 8) {
      setFieldError(form.elements.current_password, "Введите текущий пароль.");
      firstInvalid = form.elements.current_password;
    }
    if (newPassword.length < 8) {
      setFieldError(form.elements.new_password, "Новый пароль должен содержать минимум 8 символов.");
      firstInvalid = firstInvalid || form.elements.new_password;
    }
    if (currentPassword && newPassword && currentPassword === newPassword) {
      setFieldError(form.elements.new_password, "Новый пароль должен отличаться от текущего.");
      firstInvalid = firstInvalid || form.elements.new_password;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    try {
      await apiClient.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      form.reset();
      showToast("Пароль обновлен.");
    } catch (error) {
      setFieldError(form.elements.current_password, error.message || "Не удалось сменить пароль.");
      form.elements.current_password.focus();
      showToast(error.message || "Не удалось сменить пароль.");
    }
  }

  async function handleLogout() {
    try {
      await apiClient.logout();
    } catch (error) {
      console.error(error);
    }

    state.user = null;
    state.points = [];
    state.proposals = [];
    state.ownPointId = null;
    closeAvatarMenu();
    refreshHeader();
    await loadRemoteState().catch(() => {
      refresh();
    });
    closeSheet();
    showToast("Сессия завершена.");
  }

  function validateAuthProfileForm(form, payload, options) {
    const { passwordRequired, emailRequired } = options;
    let firstInvalid = null;

    if (!payload.full_name || !isValidFullName(payload.full_name)) {
      setFieldError(form.elements.full_name, "Введите Фамилию и Имя кириллицей. Отчество можно не указывать.");
      firstInvalid = firstInvalid || form.elements.full_name;
    }
    if (!isValidRussianPhone(payload.phone)) {
      setFieldError(form.elements.phone, "Введите номер по шаблону +7 999 123-45-67.");
      firstInvalid = firstInvalid || form.elements.phone;
    }
    if (!isValidTelegram(payload.telegram)) {
      setFieldError(form.elements.telegram, "Укажите корректный ник Telegram.");
      firstInvalid = firstInvalid || form.elements.telegram;
    }
    if (!cities[payload.city_id]) {
      setFieldError(form.elements.city_id, "Выберите город работы.");
      firstInvalid = firstInvalid || form.elements.city_id;
    }
    if (!profileAvatars.some((avatar) => avatar.id === payload.avatar_id)) {
      const avatarInput = form.querySelector('[name="avatar_id"]');
      setFieldError(avatarInput, "Выберите один из аватаров.");
      firstInvalid = firstInvalid || avatarInput;
    }
    if (emailRequired && !isValidAlfaEmail(payload.email)) {
      setFieldError(form.elements.email, "Можно использовать только корпоративный email.");
      firstInvalid = firstInvalid || form.elements.email;
    }
    if (passwordRequired && String(payload.password || "").length < 8) {
      setFieldError(form.elements.password, "Пароль должен содержать минимум 8 символов.");
      firstInvalid = firstInvalid || form.elements.password;
    }

    ["full_name", "telegram"].forEach((name) => {
      if (!payload[name]) return;
      if (!containsForbiddenContent(payload[name])) return;
      setFieldError(form.elements[name], "Недопустимое содержимое: уберите мат или оскорбительные выражения.");
      firstInvalid = firstInvalid || form.elements[name];
    });

    return firstInvalid;
  }

  function syncCityWithProfile(options = {}) {
    const { recenter = false } = options;
    if (!state.user || !cities[state.user.cityId]) return;
    state.cityId = state.user.cityId;
    state.dayKey = getDayKey(getActiveCity());
    saveState();
    if (map && recenter && !getOwnPoint()) {
      const city = getActiveCity();
      map.setView(city.center, city.zoom);
    }
  }

  function toggleAvatarMenu() {
    if (avatarMenuOpen) {
      closeAvatarMenu();
      return;
    }
    renderAvatarMenu();
  }

  function renderAvatarMenu() {
    const user = state.user;
    if (!user) return;
    dom.avatarMenu.innerHTML = `
      <div class="avatar-menu__title">Выберите аватар</div>
      <div class="avatar-menu__grid">
        ${profileAvatars
          .map(
            (avatar) => `
              <button
                class="avatar-choice avatar-choice-small ${avatar.id === user.avatarId ? "is-selected" : ""}"
                type="button"
                data-avatar-pick="${avatar.id}"
                aria-label="${escapeAttr(avatar.label)}"
              >
                <img src="${escapeAttr(avatar.src)}" alt="" />
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    dom.avatarMenu.hidden = false;
    avatarMenuOpen = true;
    dom.avatarMenu.querySelectorAll("[data-avatar-pick]").forEach((button) => {
      button.addEventListener("click", async () => {
        const avatarId = button.dataset.avatarPick;
        if (!avatarId || avatarId === state.user.avatarId) {
          closeAvatarMenu();
          return;
        }
        try {
          const result = await apiClient.updateProfile({
            full_name: state.user.name,
            phone: state.user.phone,
            telegram: state.user.telegram,
            city_id: state.user.cityId,
            avatar_id: avatarId,
          });
          state.user = normalizeRemoteUser(result.user);
          refreshHeader();
          await loadRemoteState();
          closeAvatarMenu();
          showToast("Аватар обновлен.");
        } catch (error) {
          showToast(error.message || "Не удалось обновить аватар.");
        }
      });
    });
  }

  function closeAvatarMenu() {
    avatarMenuOpen = false;
    dom.avatarMenu.hidden = true;
    dom.avatarMenu.innerHTML = "";
  }

  function openSideMenu() {
    closeAvatarMenu();
    sideMenuOpen = true;
    dom.sideMenu.classList.add("open");
    dom.sideMenu.setAttribute("aria-hidden", "false");
  }

  function closeSideMenu() {
    sideMenuOpen = false;
    dom.sideMenu.classList.remove("open");
    dom.sideMenu.setAttribute("aria-hidden", "true");
  }

  function toggleSideMenu() {
    if (sideMenuOpen) {
      closeSideMenu();
      return;
    }
    openSideMenu();
  }

  function handleSideMenuAction(action) {
    closeSideMenu();
    const targetUrl = action === "district-swap" ? DISTRICT_SWAP_URL : DELIVERY_TRAINING_URL;
    window.setTimeout(() => {
      window.location.href = targetUrl;
    }, 180);
  }

  function refreshHeader() {
    const user = state.user;
    if (!user) {
      dom.brandAvatarImage.hidden = true;
      dom.brandAvatarImage.alt = "";
      if (dom.brandMark) dom.brandMark.hidden = true;
      dom.brandTitle.textContent = "Альфа-Банк";
      dom.brandSubtitle.textContent = "Сервис обмена районами";
      closeAvatarMenu();
      return;
    }

    const avatar = getAvatarById(user.avatarId);
    dom.brandAvatarImage.src = avatar.src;
    dom.brandAvatarImage.alt = HEADER_AVATAR_ALT(user);
    dom.brandAvatarImage.hidden = false;
    if (dom.brandMark) dom.brandMark.hidden = true;
    dom.brandTitle.textContent = formatShortName(user.name);
    dom.brandSubtitle.textContent = "Сервис обмена районами";
  }

  function HEADER_AVATAR_ALT(user) {
    return `${formatShortName(user.name)}: аватар`;
  }

  function getAvatarById(avatarId) {
    return profileAvatars.find((avatar) => avatar.id === avatarId) || profileAvatars[0];
  }

  function formatShortName(fullName) {
    const parts = normalizeSpaces(fullName).split(" ").filter(Boolean);
    if (!parts.length) return "Альфа-Банк";
    const surname = parts[0] || "";
    const initials = parts
      .slice(1)
      .map((part) => `${part.charAt(0).toUpperCase()}.`)
      .join(" ");
    return initials ? `${surname} ${initials}` : surname;
  }

  function renderCityOptions(selectedCityId) {
    return Object.values(cities)
      .map(
        (city) =>
          `<option value="${escapeAttr(city.id)}" ${city.id === selectedCityId ? "selected" : ""}>${escapeHtml(city.name)}</option>`,
      )
      .join("");
  }

  function renderAvatarChoices(selectedId) {
    return profileAvatars
      .map(
        (avatar) => `
          <button
            class="avatar-choice ${avatar.id === selectedId ? "is-selected" : ""}"
            type="button"
            data-avatar-choice="${avatar.id}"
            aria-label="${escapeAttr(avatar.label)}"
          >
            <img src="${escapeAttr(avatar.src)}" alt="" />
          </button>
        `,
      )
      .join("");
  }

  function bindAvatarSelector(form, selectedId) {
    const hiddenInput = form.querySelector('[name="avatar_id"]');
    const grid = form.querySelector("[data-avatar-grid]");
    if (!hiddenInput || !grid) return;
    hiddenInput.value = selectedId;
    grid.querySelectorAll("[data-avatar-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        hiddenInput.value = button.dataset.avatarChoice;
        grid.querySelectorAll("[data-avatar-choice]").forEach((item) => {
          item.classList.toggle("is-selected", item === button);
        });
        clearFieldError(hiddenInput);
      });
    });

    form.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => openAuthScreen(button.dataset.authTab));
    });
  }

  function openForm(existingPoint) {
    if (!isAuthenticated()) {
      openAuthScreen("register");
      return;
    }

    const user = state.user;
    const own = existingPoint || getOwnPoint();
    const latLng = pendingLatLng || (own ? L.latLng(own.lat, own.lng) : map.getCenter());
    const isEdit = Boolean(own);
    let currentAttachments = normalizeAttachments(own?.attachments);
    const logisticCenterRegion = getLogisticCenterRegion(latLng);
    const logisticCenterField = logisticCenterRegion
      ? `
        <label class="field" data-field="logisticCenter">
          <span>Логистический центр *</span>
          <select name="logisticCenter">
            <option value="">Выберите ЛЦ</option>
            ${logisticCenterRegion.options
              .map(
                (option) =>
                  `<option value="${escapeAttr(option)}" ${own?.logisticCenter === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
              )
              .join("")}
          </select>
          <small class="field-error">Выберите логистический центр для ${logisticCenterRegion.label}.</small>
        </label>
      `
      : "";

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${isEdit ? "Моя точка" : "Добавить себя на карту"}</h2>
      <p class="sheet-subtitle">
        ${isEdit ? "Контакты и ФИО подтягиваются из личного кабинета и редактируются только там." : "Сначала отметка сохранится со статусом «Ищу обмен»."}
      </p>
      <div class="profile-lock-card">
        <div class="profile-lock-card__head">
          <img src="${escapeAttr(getAvatarById(user.avatarId).src)}" alt="" />
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(user.email)}</span>
          </div>
        </div>
        <div class="detail-grid detail-grid-compact">
          ${renderDetailItem("Телефон", formatPhoneValue(user.phone))}
          ${renderDetailItem("Telegram", user.telegram)}
          ${renderDetailItem("Город работы", getActiveCityName())}
        </div>
      </div>
      <form class="form-grid" id="pointForm" novalidate>
        <label class="field" data-field="location">
          <span>Предпочтительная локация для обмена *</span>
          <input name="location" autocomplete="off" placeholder="Например, район, метро или часть города" value="${escapeAttr(own?.location || "")}" />
          <small class="field-error">Укажите желаемую локацию.</small>
        </label>
        ${logisticCenterField}
        <label class="field" data-field="comment">
          <span>Комментарий</span>
          <textarea name="comment">${escapeHtml(own?.comment || "")}</textarea>
          <small class="field-error">Комментарий не должен содержать мат или пошлый контекст.</small>
        </label>
        <label class="field" data-field="attachments">
          <span>Фото из галереи</span>
          <input id="attachmentsInput" name="attachments" type="file" accept="image/*" multiple />
          <small class="field-hint">Можно прикрепить до ${MAX_ATTACHMENTS} фото. Подойдет и скриншот распреда.</small>
          <small class="field-error">Проверьте выбранные изображения.</small>
        </label>
        <div class="photo-grid photo-grid-edit" id="attachmentPreview"></div>
        <input type="hidden" name="lat" value="${latLng.lat}" />
        <input type="hidden" name="lng" value="${latLng.lng}" />
        <div class="button-grid">
          <button class="action-button primary" type="submit">${isEdit ? "Сохранить изменения" : "Опубликовать точку"}</button>
          <button class="action-button" id="pickOnMap" type="button">Выбрать на карте</button>
          <button class="action-button" id="useGeoInForm" type="button">Показать меня</button>
          <button class="action-button" id="openProfileFromPoint" type="button">Изменить данные профиля</button>
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

    const attachmentsInput = document.getElementById("attachmentsInput");
    const attachmentPreview = document.getElementById("attachmentPreview");
    renderAttachmentEditor(attachmentPreview, currentAttachments);
    attachmentsInput.addEventListener("change", async () => {
      clearFieldError(attachmentsInput);
      try {
        const prepared = await prepareAttachments(Array.from(attachmentsInput.files || []), currentAttachments.length);
        currentAttachments = currentAttachments.concat(prepared).slice(0, MAX_ATTACHMENTS);
        renderAttachmentEditor(attachmentPreview, currentAttachments);
      } catch (error) {
        setFieldError(attachmentsInput, error.message || "Проверьте выбранные изображения.");
        showToast(error.message || "Не удалось подготовить изображения.");
      } finally {
        attachmentsInput.value = "";
      }
    });
    attachmentPreview.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-attachment]");
      if (!button) return;
      const index = Number(button.dataset.removeAttachment);
      if (!Number.isInteger(index)) return;
      currentAttachments = currentAttachments.filter((_, itemIndex) => itemIndex !== index);
      renderAttachmentEditor(attachmentPreview, currentAttachments);
    });

    document.getElementById("pickOnMap").addEventListener("click", () => {
      closeSheet();
      showToast(isEdit ? "Тапните новое место точки на карте." : "Тапните место на карте, затем заполните карточку.");
    });
    document.getElementById("useGeoInForm")?.remove();
    document.getElementById("openProfileFromPoint")?.remove();

    const deleteButton = document.getElementById("deletePoint");
    if (deleteButton) {
      deleteButton.addEventListener("click", deleteOwnPoint);
    }

    openSheet();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const pointLat = Number(formData.get("lat"));
    const pointLng = Number(formData.get("lng"));
    const logisticCenterRegion = getLogisticCenterRegion({ lat: pointLat, lng: pointLng });
    const location = normalizeSpaces(formData.get("location"));
    const comment = normalizeSpaces(formData.get("comment"));
    const logisticCenter = logisticCenterRegion ? String(formData.get("logisticCenter") || "").trim() : "";

    let firstInvalid = null;
    if (!location) {
      setFieldError(form.elements.location, "Укажите желаемую локацию.");
      firstInvalid = form.elements.location;
    }
    if (logisticCenterRegion && !logisticCenter) {
      setFieldError(form.elements.logisticCenter, `Выберите логистический центр для ${logisticCenterRegion.label}.`);
      firstInvalid = firstInvalid || form.elements.logisticCenter;
    }
    MODERATED_TEXT_FIELDS.forEach((name) => {
      const value = name === "location" ? location : comment;
      if (!value || !containsForbiddenContent(value)) return;
      const input = name === "location" ? form.elements.location : form.elements.comment;
      setFieldError(input, "Недопустимое содержимое: уберите мат или пошлый контекст.");
      firstInvalid = firstInvalid || input;
    });

    if (firstInvalid) {
      firstInvalid.focus();
      showToast("Проверьте заполнение формы.");
      return;
    }

    const existing = getOwnPoint();
    const point = {
      id: existing?.id || "",
      cityId: state.cityId,
      location,
      logisticCenter,
      comment,
      attachments: normalizeAttachments(form.__attachmentState || []),
      lat: pointLat,
      lng: pointLng,
    };

    try {
      await saveRemotePoint(point, existing);
      saveLastLocation(L.latLng(point.lat, point.lng), 14);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Не удалось сохранить точку.");
    }
  }

  async function saveRemotePoint(point, existing, options = {}) {
    const { silentToast = false } = options;
    const result = await apiClient.upsertPoint({
      point_id: existing?.id || null,
      city_id: point.cityId,
      day_key: getDayKey(getActiveCity()),
      preferred_location: point.location,
      logistic_center: point.logisticCenter || null,
      comment: point.comment || null,
      attachments: point.attachments || [],
      lat: point.lat,
      lng: point.lng,
    });

    await loadRemoteState();
    const savedPoint = normalizeRemotePoint(result.point);
    openCard(savedPoint.id);
    if (!silentToast) {
      showToast(existing ? "Ваша точка обновлена." : "Точка опубликована на общей карте.");
    }
  }

  function openCard(pointId) {
    const point = getPoint(pointId);
    if (!point) return;

    const isOwn = point.id === state.ownPointId;
    const status = statuses[point.status] || statuses.search;
    const distance = getDistanceLabel(point);
    const exchangeLabel = getPointExchangeLabel(point);
    const openProposal = getActiveProposalWith(point.id);
    const displayName = getPointDisplayName(point);
    const contactsVisible = canViewPointContacts(point);
    const blockedByCity = isExchangeBlockedByCity(point);
    const blockedByLogisticCenter = isExchangeBlockedByLogisticCenter(point);
    const detailItems = [
      renderDetailItem("Логистический центр", point.logisticCenter),
      renderDetailItem("Телефон", contactsVisible ? point.phone : ""),
      renderDetailItem("Telegram", contactsVisible ? point.telegram : ""),
      renderDetailItem("Комментарий", point.comment),
    ].filter(Boolean);
    const attachments = normalizeAttachments(point.attachments);

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${escapeHtml(displayName)}</h2>
      <p class="sheet-subtitle">${escapeHtml(exchangeLabel)}${distance ? ` · ${distance}` : ""}</p>
      <div class="status-row">
        <span class="status-badge ${status.badgeClass}">${status.label}</span>
        ${isOwn ? '<span class="status-badge status-own">Моя точка</span>' : ""}
      </div>
      ${
        openProposal
          ? `<div class="proposal-note">Есть активное предложение: ${proposalStatuses[openProposal.status]}.</div>`
          : ""
      }
      ${!isOwn && !contactsVisible && point.hasPrivateContacts ? '<div class="public-warning">ФИО и контакты откроются после принятия предложения об обмене.</div>' : ""}
      ${!isOwn && blockedByLogisticCenter ? '<div class="public-warning">Поменяться районами с коллегой из другого ЛЦ нельзя.</div>' : ""}
      ${!isOwn && blockedByCity ? '<div class="public-warning">Поменяться районами с коллегой из другого города нельзя.</div>' : ""}
      ${detailItems.length ? `<div class="detail-grid">${detailItems.join("")}</div>` : ""}
      ${attachments.length ? renderAttachmentGallery(attachments) : ""}
      <div class="button-grid">
        ${!isOwn && contactsVisible ? renderContactAction("phone", point.phone) : ""}
        ${!isOwn && contactsVisible ? renderContactAction("telegram", point.telegram) : ""}
        ${
          isOwn
            ? '<button class="action-button" id="moveOwnPoint" type="button">Изменить место</button>'
            : blockedByCity || blockedByLogisticCenter
              ? '<button class="action-button is-disabled" type="button" disabled>Обмен недоступен</button>'
              : '<button class="action-button warn" id="offerExchange" type="button">Предложить обмен</button>'
        }
        ${
          isOwn
            ? '<button class="action-button" id="editOwn" type="button">Изменить данные</button><button class="action-button danger" id="deletePoint" type="button">Удалить</button>'
            : ""
        }
      </div>
    `;

    const offerExchange = document.getElementById("offerExchange");
    if (offerExchange) offerExchange.addEventListener("click", () => createProposal(point));

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

  function getPointExchangeLabel(point) {
    const location = normalizeSpaces(point?.location || "");
    if (!location) return "Меняюсь на район";
    return `Меняюсь на ${location}`;
  }

  function renderContactAction(type, value) {
    if (!value) return "";
    if (type === "phone") {
      return `<a class="action-button primary" href="${getTelHref(value)}">Позвонить</a>`;
    }
    return `<a class="action-button" href="${getTelegramHref(value)}" target="_blank" rel="noreferrer">Telegram</a>`;
  }

  function renderDetailItem(label, value) {
    if (!value) return "";
    return `<div class="detail-item">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(value)}</span>
    </div>`;
  }

  function renderAttachmentGallery(attachments) {
    const normalized = normalizeAttachments(attachments);
    if (!normalized.length) return "";
    return `
      <div class="photo-grid">
        ${normalized
          .map(
            (attachment, index) => `
              <figure class="photo-card">
                <img src="${escapeAttr(attachment)}" alt="Вложение ${index + 1}" loading="lazy" />
              </figure>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderAttachmentEditor(container, attachments) {
    const normalized = normalizeAttachments(attachments);
    container.innerHTML = normalized.length
      ? normalized
          .map(
            (attachment, index) => `
              <figure class="photo-card photo-card-editable">
                <img src="${escapeAttr(attachment)}" alt="Вложение ${index + 1}" loading="lazy" />
                <button class="photo-remove" type="button" data-remove-attachment="${index}" aria-label="Удалить фото">×</button>
              </figure>
            `,
          )
          .join("")
      : '<div class="photo-empty">Фото пока не добавлены.</div>';
    if (container.closest("form")) {
      container.closest("form").__attachmentState = normalized;
    }
  }

  async function createProposal(target) {
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
      showToast("Коллега сейчас не принимает предложения об обмене.");
      return;
    }

    if (isExchangeBlockedByCity(target, own)) {
      showToast("Поменяться районами с коллегой из другого города нельзя.");
      return;
    }

    if (isExchangeBlockedByLogisticCenter(target, own)) {
      showToast("Поменяться районами с коллегой из другого ЛЦ нельзя.");
      return;
    }

    const duplicate = state.proposals.find(
      (proposal) => proposal.fromId === own.id && proposal.toId === target.id && proposal.status === "pending",
    );
    if (duplicate) {
      openProposalsScreen("outgoing");
      showToast("Такое предложение уже есть в исходящих.");
      return;
    }

    try {
      await apiClient.createOffer({
        to_point_id: target.id,
        day_key: getDayKey(getActiveCity()),
      });
      await loadRemoteState();
      openProposalsScreen("outgoing");
      showToast("Предложение обмена отправлено.");
    } catch (error) {
      showToast(error.message || "Не удалось отправить предложение.");
    }
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
      <p class="sheet-subtitle">Контакты откроются обеим сторонам после принятия обмена.</p>
      <div class="tabs" role="tablist" aria-label="Тип заявок">
        <button class="tab-button ${activeTab === "incoming" ? "is-active" : ""}" type="button" data-proposal-tab="incoming">
          Входящие <span>${incoming.length}</span>
        </button>
        <button class="tab-button ${activeTab === "outgoing" ? "is-active" : ""}" type="button" data-proposal-tab="outgoing">
          Исходящие <span>${outgoing.length}</span>
        </button>
      </div>
      <div class="nearby-list">
        ${list.length ? list.map((proposal) => renderProposalItem(proposal, activeTab)).join("") : '<div class="empty-state">Заявок пока нет.</div>'}
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
    const from = getPoint(proposal.fromId);
    const to = getPoint(proposal.toId);
    const colleague = activeTab === "outgoing" ? to : from;
    const displayName = colleague ? getPointDisplayName(colleague) : "Сотрудник удален";
    const canAnswer = proposal.status === "pending" && activeTab === "incoming";

    return `
      <article class="nearby-item">
        <div class="nearby-head">
          <strong>${escapeHtml(displayName)}</strong>
          <span class="proposal-status proposal-${proposal.status}">${proposalStatuses[proposal.status]}</span>
        </div>
        <p class="nearby-meta">
          ${activeTab === "outgoing" ? "Вы предложили обмен" : "Вам предложили обмен"}
          ${colleague ? ` · ${escapeHtml(colleague.location)}` : ""}
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
        </div>
      </article>
    `;
  }

  async function acceptProposal(proposalId, activeTab) {
    try {
      await apiClient.acceptOffer(proposalId);
      await loadRemoteState();
      openProposalsScreen(activeTab);
      showToast("Обмен принят. Точки автоматически поменялись местами.");
    } catch (error) {
      showToast(error.message || "Не удалось принять обмен.");
    }
  }

  async function declineProposal(proposalId, activeTab) {
    try {
      await apiClient.declineOffer(proposalId);
      await loadRemoteState();
      openProposalsScreen(activeTab);
      showToast("Предложение отклонено.");
    } catch (error) {
      showToast(error.message || "Не удалось отклонить предложение.");
    }
  }

  function openNearbyList() {
    const points = getVisiblePoints()
      .filter((point) => point.id !== state.ownPointId)
      .filter((point) => getDistanceMeters(point) <= NEARBY_MAX_DISTANCE_METERS)
      .slice()
      .sort((a, b) => getDistanceMeters(a) - getDistanceMeters(b));

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Коллеги рядом</h2>
      <p class="sheet-subtitle">Список сортируется от ближайшего и показывает точки в радиусе до 60 км от вашей точки или центра города.</p>
      <div class="nearby-list">
        ${points.length ? points.map(renderNearbyItem).join("") : '<div class="empty-state">В радиусе 60 км по выбранному фильтру активных точек нет.</div>'}
      </div>
    `;

    dom.sheetContent.querySelectorAll("[data-open-card]").forEach((button) => {
      button.addEventListener("click", () => openCard(button.dataset.openCard));
    });

    openSheet();
  }

  function renderNearbyItem(point) {
    const status = statuses[point.status] || statuses.search;
    const contactsVisible = canViewPointContacts(point);
    const displayName = getPointDisplayName(point);
    return `
      <article class="nearby-item">
        <div class="nearby-head">
          <strong>${escapeHtml(displayName)}</strong>
          <span class="status-badge ${status.badgeClass}">${status.label}</span>
        </div>
        <p class="nearby-meta">${escapeHtml(point.location)} · ${getDistanceLabel(point) || "расстояние не задано"}</p>
        <div class="nearby-actions">
          <button type="button" data-open-card="${point.id}">Карточка</button>
          ${contactsVisible && point.phone ? `<a href="${getTelHref(point.phone)}">Позвонить</a>` : ""}
        </div>
      </article>
    `;
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

  function refresh() {
    const own = getOwnPoint();
    const pendingIncoming = own
      ? state.proposals.filter((proposal) => proposal.toId === own.id && proposal.status === "pending").length
      : 0;

    dom.ownPointButtonText.textContent = own ? "Моя точка" : isAuthenticated() ? "Добавить себя" : "Регистрация";
    dom.proposalBadge.hidden = pendingIncoming === 0;
    dom.proposalBadge.textContent = String(pendingIncoming);

    syncContextFilters();
    refreshMarkers();
  }

  function syncContextFilters() {
    if (!dom.logisticCenterFilterField || !dom.logisticCenterFilterSelect || !map) return;

    const region = getLogisticCenterRegion(map.getCenter());
    if (!region) {
      activeLogisticCenterFilter = "";
      dom.logisticCenterFilterSelect.innerHTML = '<option value="">Все логистические центры</option>';
      dom.logisticCenterFilterSelect.value = "";
      dom.logisticCenterFilterField.hidden = true;
      return;
    }

    if (activeLogisticCenterFilter && !region.options.includes(activeLogisticCenterFilter)) {
      activeLogisticCenterFilter = "";
    }

    dom.logisticCenterFilterSelect.innerHTML = ['<option value="">Все логистические центры</option>']
      .concat(
        region.options.map(
          (option) =>
            `<option value="${escapeAttr(option)}" ${activeLogisticCenterFilter === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
        ),
      )
      .join("");
    dom.logisticCenterFilterSelect.value = activeLogisticCenterFilter;
    dom.logisticCenterFilterField.hidden = false;
  }

  function refreshMarkers() {
    if (!clusterLayer) return;
    const visiblePoints = getVisiblePoints();
    const visibleIds = new Set(visiblePoints.map((point) => point.id));

    visiblePoints.forEach((point) => {
      const signature = getMarkerSignature(point);
      let marker = markerRegistry.get(point.id);

      if (!marker || marker.__cpSignature !== signature) {
        if (marker) clusterLayer.removeLayer(marker);
        marker = buildPointMarker(point);
        marker.__cpSignature = signature;
        markerRegistry.set(point.id, marker);
        clusterLayer.addLayer(marker);
        return;
      }

      if (!clusterLayer.hasLayer(marker)) {
        clusterLayer.addLayer(marker);
      }
    });

    Array.from(markerRegistry.entries()).forEach(([pointId, marker]) => {
      if (visibleIds.has(pointId)) return;
      clusterLayer.removeLayer(marker);
      markerRegistry.delete(pointId);
    });
  }

  function buildPointMarker(point) {
    const marker = L.marker([point.lat, point.lng], {
      icon: createPersonIcon(point),
      title: getPointDisplayName(point),
    });
    marker.on("click", () => openCard(point.id));
    return marker;
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

  function getMarkerSignature(point) {
    return [point.id, getPointDisplayName(point), point.status, point.lat, point.lng, point.id === state.ownPointId ? "own" : "other"].join("|");
  }

  function getVisiblePoints() {
    return state.points.filter((point) => {
      if (point.cityId !== state.cityId) return false;
      if (activeFilter !== "all" && point.status !== activeFilter) return false;
      if (activeLogisticCenterFilter && point.logisticCenter !== activeLogisticCenterFilter) return false;
      return true;
    });
  }

  function getOwnPoint() {
    const own = state.points.find((point) => point.isOwn);
    state.ownPointId = own?.id || null;
    return own || null;
  }

  function getPoint(pointId) {
    return state.points.find((point) => point.id === pointId) || null;
  }

  function isExchangeBlockedByCity(target, source = getOwnPoint()) {
    if (!target || !source) return false;
    return target.cityId !== source.cityId;
  }

  function isExchangeBlockedByLogisticCenter(target, source = getOwnPoint()) {
    if (!target || !source) return false;
    if (target.cityId !== source.cityId) return false;
    if (!isMultiLogisticCenterCity(target.cityId)) return false;
    const sourceCenter = String(source.logisticCenter || "").trim();
    const targetCenter = String(target.logisticCenter || "").trim();
    if (!sourceCenter || !targetCenter) return false;
    return sourceCenter !== targetCenter;
  }

  function isMultiLogisticCenterCity(cityId) {
    const region = logisticCenterRegions.find((item) => item.id === cityId);
    return Boolean(region && Array.isArray(region.options) && region.options.length > 1);
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

  function canViewPointContacts(point) {
    return Boolean(point && (point.isOwn || point.contactsVisible));
  }

  function getPointDisplayName(point) {
    if (!point) return "Мобильный Банкир";
    return canViewPointContacts(point) ? point.name : "Мобильный Банкир";
  }

  async function updateOwnLocation(latLng, message) {
    const own = getOwnPoint();
    if (!own) return;
    const moved = {
      ...own,
      lat: latLng.lat,
      lng: latLng.lng,
      location: own.location,
      logisticCenter: own.logisticCenter,
      comment: own.comment,
      attachments: own.attachments,
    };
    saveLastLocation(latLng, 14);
    moveMode = false;
    await saveRemotePoint(moved, own, { silentToast: true });
    showToast(message);
  }

  async function deleteOwnPoint() {
    const own = getOwnPoint();
    if (!own) return;
    const confirmed = window.confirm("Удалить вашу активную точку с карты?");
    if (!confirmed) return;

    try {
      await apiClient.deletePoint(own.id);
      state.ownPointId = null;
      pendingLatLng = null;
      moveMode = false;
      await loadRemoteState();
      closeSheet();
      showToast("Ваша точка удалена.");
    } catch (error) {
      showToast(error.message || "Не удалось удалить точку.");
    }
  }

  function loadState() {
    const cityId = "spb";
    const dayKey = getDayKey(cities[cityId]);
    const fallback = {
      cityId,
      dayKey,
      ownPointId: null,
      user: null,
      points: [],
      proposals: [],
    };

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return fallback;
      return {
        ...fallback,
        cityId: cities[saved.cityId] ? saved.cityId : cityId,
      };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cityId: state.cityId,
      }),
    );
  }

  function getActiveCity() {
    return cities[state.cityId] || cities.spb;
  }

  function getActiveCityName() {
    return getActiveCity().name;
  }

  function updateCountdown() {
    const city = getActiveCity();
    const now = Date.now();
    const end = getCityEndOfDay(city);
    const left = Math.max(0, end - now);
    const hours = Math.floor(left / 3600000);
    const minutes = Math.floor((left % 3600000) / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    dom.cleanupCountdown.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
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
    const city = getActiveCity();
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

  function getLogisticCenterRegion(point) {
    if (!point) return null;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return (
      logisticCenterRegions.find((region) =>
        L.latLngBounds(region.bounds).contains(L.latLng(lat, lng)),
      ) || null
    );
  }

  function isAllowedMapPoint(point) {
    const city = getActiveCity();
    if (!city.bounds) return true;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return L.latLngBounds(city.bounds).contains(L.latLng(lat, lng));
  }

  function normalizeSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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

  function isValidAlfaEmail(value) {
    return /^[a-z0-9._%+-]+@alfabank\.ru$/i.test(String(value || "").trim());
  }

  function isValidTelegram(value) {
    return /^@?[a-z0-9_]{3,32}$/i.test(String(value || "").trim());
  }

  function getPhoneDigits(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (!digits.startsWith("7")) digits = `7${digits}`;
    return digits.slice(0, 11);
  }

  function isPhoneFilled(value) {
    return getPhoneDigits(value).length > 1;
  }

  function isValidRussianPhone(value) {
    return /^7\d{10}$/.test(getPhoneDigits(value));
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

  function ensurePhonePrefix(input) {
    if (!input.value.trim()) input.value = "+7 ";
  }

  function formatPhoneField(input) {
    input.value = formatPhoneValue(input.value);
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

  function normalizeAttachments(attachments) {
    return Array.isArray(attachments)
      ? attachments.filter((attachment) => /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(String(attachment || "")))
      : [];
  }

  async function prepareAttachments(files, existingCount) {
    if (!files.length) return [];
    if (existingCount + files.length > MAX_ATTACHMENTS) {
      throw new Error(`Можно прикрепить не более ${MAX_ATTACHMENTS} фото.`);
    }
    const prepared = [];
    for (const file of files) {
      if (!String(file.type || "").startsWith("image/")) {
        throw new Error("Можно прикреплять только изображения из галереи.");
      }
      prepared.push(await compressImageFile(file));
    }
    return prepared;
  }

  async function compressImageFile(file) {
    const image = await loadImageFile(file);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const maxSide = Math.max(width, height);
    if (maxSide > MAX_ATTACHMENT_DIMENSION) {
      const scale = MAX_ATTACHMENT_DIMENSION / maxSide;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить изображение.");
    context.drawImage(image, 0, 0, width, height);

    let quality = 0.86;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (estimateDataUrlBytes(dataUrl) > MAX_ATTACHMENT_BYTES && quality > 0.48) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (estimateDataUrlBytes(dataUrl) > MAX_ATTACHMENT_BYTES) {
      throw new Error("Одно из фото слишком большое. Выберите изображение поменьше.");
    }

    return dataUrl;
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Не удалось обработать изображение."));
        image.onload = () => resolve(image);
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function estimateDataUrlBytes(dataUrl) {
    const base64 = String(dataUrl || "").split(",")[1] || "";
    return Math.ceil((base64.length * 3) / 4);
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

  function applyServerFormError(form, error) {
    const message = String(error.message || "");
    if (/email/i.test(message) && form.elements.email) {
      setFieldError(form.elements.email, message);
      return;
    }
    if (/парол/i.test(message) && form.elements.password) {
      setFieldError(form.elements.password, message);
      return;
    }
    if (/telegram/i.test(message) && form.elements.telegram) {
      setFieldError(form.elements.telegram, message);
      return;
    }
    if (/телефон|номер/i.test(message) && form.elements.phone) {
      setFieldError(form.elements.phone, message);
      return;
    }
    if (/город/i.test(message) && form.elements.city_id) {
      setFieldError(form.elements.city_id, message);
      return;
    }
    if (/аватар/i.test(message)) {
      const avatarInput = form.querySelector('[name="avatar_id"]');
      if (avatarInput) setFieldError(avatarInput, message);
    }
  }

  function isAuthenticated() {
    return Boolean(state.user);
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
    return saved === "dark" ? "dark" : "light";
  }

  function toggleTheme() {
    applyTheme(loadTheme() === "dark" ? "light" : "dark");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    if (dom.themeToggle) {
      dom.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
      dom.themeToggle.setAttribute(
        "aria-label",
        theme === "dark" ? "Включить светлую тему" : "Включить темную тему",
      );
    }
    if (baseTileLayer) {
      baseTileLayer.setUrl(getTileUrl(theme));
    }
  }

  function getTileUrl(theme) {
    return tileThemes[theme === "dark" ? "dark" : "light"];
  }

  function getTelHref(value) {
    return `tel:+${getPhoneDigits(value)}`;
  }

  function getTelegramHref(value) {
    const normalized = String(value || "").trim().replace(/^@/, "");
    return `https://t.me/${normalized}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
