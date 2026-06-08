(function () {
  "use strict";

  const STORAGE_KEY = "changeplace:v3";
  const THEME_KEY = "changeplace:theme";
  const LAST_LOCATION_KEY = "changeplace:last_location";
  const APP_CONFIG = window.CHANGEPLACE_CONFIG || {};
  const apiBaseUrls = normalizeApiBaseUrls(APP_CONFIG.apiBaseUrl);
  let preferredApiBaseUrl = Array.isArray(apiBaseUrls) ? apiBaseUrls[0] ?? "" : apiBaseUrls;
  const apiClient = apiBaseUrls === null ? null : createApiClient(apiBaseUrls);
  const moduleRegistry = window.ChangePlaceModules || {};
  const initScrollableRowsFromModule = moduleRegistry.scrollRow?.initScrollableRows;
  const createFilterPanelControllerFromModule = moduleRegistry.filterPanel?.createFilterPanelController;
  const createFilterSelectControllerFromModule = moduleRegistry.filterPanel?.createFilterSelectController;
  const createDeliveryIconFromModule = moduleRegistry.deliveryMarker?.createDeliveryIcon;
  const getDeliveryMarkerModeFromModule = moduleRegistry.deliveryMarker?.getDeliveryMarkerMode;
  const syncDeliveryMarkerModeFromModule = moduleRegistry.deliveryMarker?.syncDeliveryMarkerMode;

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
      geocodeBounds: [
        [59.72, 29.5],
        [60.16, 30.9],
      ],
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
      geocodeBounds: [
        [55.48, 36.8],
        [56.02, 38.1],
      ],
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
      geocodeBounds: [
        [55.66, 48.85],
        [55.94, 49.32],
      ],
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

  const pointTypes = {
    swap: { label: "Обмен районами" },
    delivery: { label: "Доставка" },
  };

  const deliveryProducts = ["DC", "CC", "CC2", "RE", "Orange", "Orange PAY", "RKO"];
  const deliveryIntervals = buildDeliveryIntervals();
  const deliveryMeetingOptions = {
    yes: "Да",
    no: "Нет",
  };
  const deliveryMarkerZoomModes = {
    full: "full",
    product: "product",
    dot: "dot",
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
  const DISTRICT_SWAP_URL = "https://goswitch.ru/?v=20260607-01";
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
    header: document.querySelector(".app-header"),
    actionDock: document.querySelector(".action-dock"),
    filterBar: document.querySelector(".filter-bar"),
    filtersDropdown: document.getElementById("filtersDropdown"),
    filtersToggle: document.getElementById("filtersToggle"),
    filtersPanel: document.getElementById("filtersPanel"),
    filters: Array.from(document.querySelectorAll("[data-filter]")),
    deliveryProductFilterSelect: document.getElementById("deliveryProductFilterSelect"),
    deliveryIntervalFilterSelect: document.getElementById("deliveryIntervalFilterSelect"),
    deliveryAvailabilityFilterSelect: document.getElementById("deliveryAvailabilityFilterSelect"),
    logisticCenterFilterField: document.getElementById("logisticCenterFilterField"),
    logisticCenterFilterSelect: document.getElementById("logisticCenterFilterSelect"),
  };

  let state = loadState();
  let map;
  let baseTileLayer;
  let clusterLayer;
  let proposalLinkLayer;
  let markerRegistry = new Map();
  let markerIntroPointIds = new Set();
  let markerTravelQueue = new Map();
  let activeFilter = "all";
  let activeDeliveryProductFilter = "";
  let activeDeliveryIntervalFilter = "";
  let activeDeliveryAvailabilityFilter = "all";
  let activeLogisticCenterFilter = "";
  let pendingLatLng = null;
  let moveMode = false;
  let toastTimer = 0;
  let backendReloadTimer = 0;
  let backendPollTimer = 0;
  let avatarMenuOpen = false;
  let sideMenuOpen = false;
  let filtersPanelController = null;
  let filterSelectController = null;

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
    proposalLinkLayer = L.layerGroup().addTo(map);
    map.addLayer(clusterLayer);
    clusterLayer.on("animationend spiderfied unspiderfied", refreshPendingProposalLinksForCurrentView);
    try {
      localStorage.removeItem("changeplace:pending_focus");
    } catch {}

    map.on("click", handleMapClick);
    map.on("zoomstart", () => {
      proposalLinkLayer?.clearLayers();
    });
    map.on("moveend", () => {
      syncContextFilters();
      refreshPendingProposalLinksForCurrentView();
    });
    map.on("zoomend", () => {
      syncContextFilters();
      syncVisibleDeliveryMarkerModes();
      refreshPendingProposalLinksForCurrentView();
    });
    bindEvents();
    initScrollableRowsFromModule?.(document);
    renderDeliveryFilterOptions();
    refreshHeader();
    refresh();

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
      navigator.serviceWorker
        .register("./service-worker.js?v=20260608-15", { updateViaCache: "none" })
        .catch(() => {});
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

    filtersPanelController = createFilterPanelControllerFromModule?.({
      root: dom.filtersDropdown,
      toggleButton: dom.filtersToggle,
      panel: dom.filtersPanel,
    });
    filterSelectController = createFilterSelectControllerFromModule?.({
      root: dom.filtersDropdown,
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
      filterSelectController?.close?.();
      filtersPanelController?.close?.();
    });

    dom.filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        dom.filters.forEach((item) => item.classList.toggle("is-active", item === button));
        filterSelectController?.close?.();
        filtersPanelController?.close?.();
        refreshMarkers();
      });
    });

    if (dom.logisticCenterFilterSelect) {
      dom.logisticCenterFilterSelect.addEventListener("change", () => {
        activeLogisticCenterFilter = dom.logisticCenterFilterSelect.value;
        refreshMarkers();
      });
    }

    if (dom.deliveryProductFilterSelect) {
      dom.deliveryProductFilterSelect.addEventListener("change", () => {
        activeDeliveryProductFilter = dom.deliveryProductFilterSelect.value;
        refreshMarkers();
      });
    }

    if (dom.deliveryIntervalFilterSelect) {
      dom.deliveryIntervalFilterSelect.addEventListener("change", () => {
        activeDeliveryIntervalFilter = dom.deliveryIntervalFilterSelect.value;
        refreshMarkers();
      });
    }

    if (dom.deliveryAvailabilityFilterSelect) {
      dom.deliveryAvailabilityFilterSelect.addEventListener("change", () => {
        activeDeliveryAvailabilityFilter = dom.deliveryAvailabilityFilterSelect.value;
        refreshMarkers();
      });
    }
  }

  function renderDeliveryFilterOptions() {
    if (dom.deliveryProductFilterSelect) {
      dom.deliveryProductFilterSelect.innerHTML = ['<option value="">Все продукты</option>']
        .concat(deliveryProducts.map((item) => `<option value="${escapeAttr(item)}">${escapeHtml(item)}</option>`))
        .join("");
    }
    if (dom.deliveryIntervalFilterSelect) {
      dom.deliveryIntervalFilterSelect.innerHTML = ['<option value="">Все интервалы</option>']
        .concat(deliveryIntervals.map((item) => `<option value="${escapeAttr(item)}">${escapeHtml(item)}</option>`))
        .join("");
    }
    filterSelectController?.sync?.();
  }

  async function initBackend() {
    await loadSession({ recenter: true });
    await loadRemoteState();
    focusPendingProposalsOnLoad();
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
      reservePoint(pointId) {
        return apiRequest(baseUrls, `/api/points/${encodeURIComponent(pointId)}/reserve`, {
          method: "POST",
          body: {},
        });
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
    const previousPointsById = new Map(state.points.map((point) => [point.id, point]));
    const remoteState = await apiClient.getState({
      city_id: state.cityId,
      day_key: dayKey,
    });

    const remotePoints = (remoteState.points || []).map(normalizeRemotePoint);
    queueExchangeTravelAnimations(previousPointsById, remotePoints);
    state.dayKey = dayKey;
    state.points = remotePoints;
    state.proposals = (remoteState.proposals || []).map(normalizeRemoteProposal);
    const own = state.points.find((point) => point.isOwn && point.pointType === "swap");
    state.ownPointId = own?.id || null;
    if (!state.proposals.some((proposal) => proposal.status === "pending")) {
      clearPendingProposalFocusSnapshot();
    }
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
      pointType: row.point_type || "swap",
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
      deliveryNumber: row.delivery_number || "",
      productType: row.product_type || "",
      deliveryInterval: row.delivery_interval || "",
      deliveryAddress: row.delivery_address || "",
      meetingAgreed: row.meeting_agreed || "",
      deliveryDetailsVisible: Boolean(row.delivery_details_visible),
      deliveryReservedByMe: Boolean(row.delivery_reserved_by_me),
      deliveryAvailability: row.delivery_availability || "available",
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
      pointType: point.pointType === "delivery" ? "delivery" : "swap",
      phone: point.phone || "",
      telegram: point.telegram || "",
      logisticCenter: point.logisticCenter || "",
      attachments: normalizeAttachments(point.attachments),
      hasPrivateContacts: Boolean(point.hasPrivateContacts ?? Boolean(point.phone || point.telegram)),
      contactsVisible: Boolean(point.isOwn || point.contactsVisible),
      avatarId: point.avatarId || "",
      deliveryNumber: point.deliveryNumber || "",
      productType: point.productType || "",
      deliveryInterval: point.deliveryInterval || "",
      deliveryAddress: point.deliveryAddress || "",
      meetingAgreed: point.meetingAgreed || "",
      deliveryDetailsVisible: Boolean(point.isOwn || point.deliveryDetailsVisible),
      deliveryReservedByMe: Boolean(point.deliveryReservedByMe),
      deliveryAvailability: point.deliveryAvailability || "available",
      status: statuses[point.status] ? point.status : "search",
    };
  }

  function getInitialView(city) {
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
      openSwapForm(own);
      return;
    }

    pendingLatLng = map.getCenter();
    openSwapForm();
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

    openPointTypePicker(event.latlng);
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
        if (!(silent && hasActivePendingProposals())) {
          map.setView(latLng, 15);
        }
        if (!silent) dom.geoButton.classList.remove("is-active");

        if (getOwnPoint() && updateOwnPoint) {
          updateOwnLocation(latLng, "Геолокация определена.");
        } else if (getOwnPoint() && !silent) {
          showToast("Геолокация определена.");
        } else if (!getOwnPoint() && openFormOnNewPoint && isAuthenticated()) {
          openPointTypePicker(latLng);
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
    initScrollableRowsFromModule?.(dom.sheetContent);

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

  function openPointTypePicker(latLng) {
    pendingLatLng = latLng || pendingLatLng || map.getCenter();
    const ownSwapPoint = getOwnPoint();

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Выберите тип метки</h2>
      <p class="sheet-subtitle">Обмен районами работает по старому сценарию. Для доставки откроется отдельная карточка заявки.</p>
      <div class="button-grid">
        <button class="action-button primary" id="openSwapPointFlow" type="button">${ownSwapPoint ? "Моя метка обмена" : "Обмен районами"}</button>
        <button class="action-button" id="openDeliveryPointFlow" type="button">Доставка</button>
      </div>
    `;

    document.getElementById("openSwapPointFlow")?.addEventListener("click", () => {
      if (ownSwapPoint) {
        openCard(ownSwapPoint.id);
        return;
      }
      openSwapForm();
    });
    document.getElementById("openDeliveryPointFlow")?.addEventListener("click", () => openDeliveryForm());
    initScrollableRowsFromModule?.(dom.sheetContent);
    openSheet();
  }

  function openSwapForm(existingPoint) {
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
      <form class="form-grid" id="swapPointForm" novalidate>
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

    const form = document.getElementById("swapPointForm");
    form.addEventListener("submit", handleSwapFormSubmit);
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
      deleteButton.addEventListener("click", () => deletePoint(own));
    }

    openSheet();
  }

  function openDeliveryForm(existingPoint) {
    if (!isAuthenticated()) {
      openAuthScreen("register");
      return;
    }

    const user = state.user;
    const point = existingPoint && existingPoint.pointType === "delivery" ? existingPoint : null;
    const latLng = pendingLatLng || (point ? L.latLng(point.lat, point.lng) : map.getCenter());
    const isEdit = Boolean(point);
    const initialDrafts = isEdit
      ? [
          createDeliveryDraft({
            deliveryNumber: point?.deliveryNumber || "",
            productType: point?.productType || "",
            deliveryAddress: point?.deliveryAddress || "",
            deliveryInterval: point?.deliveryInterval || "",
            meetingAgreed: point?.meetingAgreed || "",
            comment: point?.comment || "",
          }),
        ]
      : [createDeliveryDraft()];

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${isEdit ? "\u0417\u0430\u044f\u0432\u043a\u0430 \u043d\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0443" : "\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430 \u043d\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0443"}</h2>
      <p class="sheet-subtitle">\u0422\u043e\u0447\u043a\u0430 \u0440\u0430\u0437\u043c\u0435\u0449\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u043a\u0430\u0440\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 \u0442\u0430\u043f, \u0430 \u0430\u0434\u0440\u0435\u0441 \u0438\u0437 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0434\u043b\u044f \u0442\u043e\u0447\u043d\u043e\u0433\u043e \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f \u0437\u0430\u044f\u0432\u043a\u0438 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435.</p>
      <div class="profile-lock-card">
        <div class="profile-lock-card__head">
          <img src="${escapeAttr(getAvatarById(user.avatarId).src)}" alt="" />
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(user.email)}</span>
          </div>
        </div>
      </div>
      <form class="form-grid" id="deliveryPointForm" data-point-id="${escapeAttr(point?.id || "")}" novalidate>
        <div class="delivery-drafts" id="deliveryDrafts"></div>
        ${
          !isEdit
            ? '<button class="action-button action-button-inline" id="addDeliveryDraft" type="button">\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0435\u0449\u0435 \u0437\u0430\u044f\u0432\u043a\u0443</button>'
            : ""
        }
        <small class="field-hint">${
          isEdit
            ? "\u041e\u0442\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439\u0442\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u044d\u0442\u043e\u0439 \u0437\u0430\u044f\u0432\u043a\u0438 \u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f."
            : "\u041c\u043e\u0436\u043d\u043e \u0441\u043e\u0431\u0440\u0430\u0442\u044c \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0437\u0430\u044f\u0432\u043e\u043a \u0438 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c \u0438\u0445 \u0437\u0430 \u043e\u0434\u0438\u043d \u0440\u0430\u0437."
        }</small>
        <input type="hidden" name="lat" value="${latLng.lat}" />
        <input type="hidden" name="lng" value="${latLng.lng}" />
        <div class="button-grid">
          <button class="action-button primary" type="submit">${isEdit ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443" : "\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0438"}</button>
          <button class="action-button" id="repickDeliveryOnMap" type="button">\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043d\u0430 \u043a\u0430\u0440\u0442\u0435</button>
          ${isEdit ? '<button class="action-button danger" id="deleteDeliveryPoint" type="button">\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043c\u0435\u0442\u043a\u0443</button>' : ""}
        </div>
      </form>
    `;

    const form = document.getElementById("deliveryPointForm");
    bindDeliveryDraftEditor(form, {
      drafts: initialDrafts,
      isEdit,
      clearFieldError,
      escapeAttr,
      escapeHtml,
      intervals: deliveryIntervals,
    });
    form.addEventListener("submit", handleDeliveryFormSubmit);

    document.getElementById("repickDeliveryOnMap")?.addEventListener("click", () => {
      closeSheet();
      showToast("\u0422\u0430\u043f\u043d\u0438\u0442\u0435 \u043c\u0435\u0441\u0442\u043e \u043d\u0430 \u043a\u0430\u0440\u0442\u0435, \u0437\u0430\u0442\u0435\u043c \u0432\u0435\u0440\u043d\u0438\u0442\u0435\u0441\u044c \u043a \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044e \u0437\u0430\u044f\u0432\u043a\u0438.");
    });
    document.getElementById("deleteDeliveryPoint")?.addEventListener("click", () => deletePoint(point));
    openSheet();
  }

  function createDeliveryDraft(values = {}) {
    return {
      deliveryNumber: normalizeSpaces(values.deliveryNumber || ""),
      productType: String(values.productType || "").trim(),
      deliveryAddress: normalizeSpaces(values.deliveryAddress || ""),
      deliveryInterval: String(values.deliveryInterval || "").trim(),
      meetingAgreed: String(values.meetingAgreed || "").trim(),
      comment: normalizeSpaces(values.comment || ""),
    };
  }

  function getDeliveryDraftSummary(draft) {
    const parts = [draft.productType, draft.deliveryInterval, draft.deliveryAddress].filter(Boolean);
    return parts.length ? parts.join(" \u2022 ") : "\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430";
  }

  function renderDeliveryDraftCard(draft, index, options = {}) {
    const escapeAttr = options.escapeAttr || ((input) => String(input ?? ""));
    const escapeHtml = options.escapeHtml || ((input) => String(input ?? ""));
    const intervals = Array.isArray(options.intervals) ? options.intervals : [];
    const expanded = Boolean(options.expanded);
    const canRemove = Boolean(options.canRemove);
    return `
      <section class="delivery-draft ${expanded ? "is-expanded" : "is-collapsed"}" data-delivery-draft="${index}">
        <div class="delivery-draft__head">
          <button class="delivery-draft__toggle" type="button" data-toggle-delivery-draft="${index}" aria-expanded="${expanded ? "true" : "false"}">
            <span class="delivery-draft__title">\u0417\u0430\u044f\u0432\u043a\u0430 ${index + 1}</span>
            <span class="delivery-draft__summary" data-delivery-draft-summary>${escapeHtml(getDeliveryDraftSummary(draft))}</span>
          </button>
          ${canRemove ? `<button class="delivery-draft__remove" type="button" data-remove-delivery-draft="${index}" aria-label="\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443">&times;</button>` : ""}
        </div>
        <div class="delivery-draft__content" ${expanded ? "" : "hidden"}>
          <label class="field" data-field="deliveryNumber">
            <span>\u041d\u043e\u043c\u0435\u0440 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438 *</span>
            <input name="deliveryNumber" autocomplete="off" placeholder="\u0421\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 \u043d\u043e\u043c\u0435\u0440 \u0438\u0437 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0437\u0430\u044f\u0432\u043a\u0438 \u0432 Go" value="${escapeAttr(draft.deliveryNumber)}" />
            <small class="field-error">\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u043e\u043c\u0435\u0440 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438.</small>
          </label>
          <label class="field" data-field="productType">
            <span>\u041f\u0440\u043e\u0434\u0443\u043a\u0442 *</span>
            <select name="productType">
              <option value="">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u043e\u0434\u0443\u043a\u0442</option>
              ${deliveryProducts
                .map(
                  (item) => `<option value="${escapeAttr(item)}" ${draft.productType === item ? "selected" : ""}>${escapeHtml(item)}</option>`,
                )
                .join("")}
            </select>
            <small class="field-error">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u043e\u0434\u0443\u043a\u0442.</small>
          </label>
          <div class="field" data-field="deliveryAddress">
            <span>\u0410\u0434\u0440\u0435\u0441 *</span>
            <div class="address-item__row address-item__row--single">
              <input
                name="deliveryAddress"
                autocomplete="off"
                placeholder="\u0421\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0438\u0437 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0437\u0430\u044f\u0432\u043a\u0438 \u0432 Go"
                value="${escapeAttr(draft.deliveryAddress)}"
              />
              <select name="deliveryIntervalRow" aria-label="\u0418\u043d\u0442\u0435\u0440\u0432\u0430\u043b \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438">
                <option value="">\u0418\u043d\u0442\u0435\u0440\u0432\u0430\u043b</option>
                ${intervals
                  .map(
                    (item) => `<option value="${escapeAttr(item)}" ${draft.deliveryInterval === item ? "selected" : ""}>${escapeHtml(item)}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <small class="field-error">\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438.</small>
          </div>
          <div class="field" data-field="meetingAgreed">
            <span>\u0412\u0441\u0442\u0440\u0435\u0447\u0430 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0430? *</span>
            <div class="choice-row">
              ${Object.entries(deliveryMeetingOptions)
                .map(
                  ([value, label]) => `
                    <button class="choice-pill ${draft.meetingAgreed === value ? "is-active" : ""}" type="button" data-meeting-choice="${value}">
                      ${escapeHtml(label)}
                    </button>
                  `,
                )
                .join("")}
            </div>
            <input type="hidden" name="meetingAgreed" value="${escapeAttr(draft.meetingAgreed)}" />
            <small class="field-error">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435, \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0430 \u043b\u0438 \u0432\u0441\u0442\u0440\u0435\u0447\u0430.</small>
          </div>
          <label class="field" data-field="comment">
            <span>\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439</span>
            <textarea name="comment" placeholder="\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f \u0434\u043b\u044f \u043a\u043e\u043b\u043b\u0435\u0433\u0438">${escapeHtml(draft.comment)}</textarea>
            <small class="field-error">\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u043d\u0435 \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043d\u0435\u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u044b\u0439 \u0442\u0435\u043a\u0441\u0442.</small>
          </label>
        </div>
      </section>
    `;
  }

  function collectDeliveryDraftsFromForm(form) {
    return Array.from(form.querySelectorAll("[data-delivery-draft]"))
      .map((section) => ({
        deliveryNumber: normalizeSpaces(section.querySelector('[name="deliveryNumber"]')?.value),
        productType: String(section.querySelector('[name="productType"]')?.value || "").trim(),
        deliveryAddress: normalizeSpaces(section.querySelector('[name="deliveryAddress"]')?.value),
        deliveryInterval: String(section.querySelector('[name="deliveryIntervalRow"]')?.value || "").trim(),
        meetingAgreed: String(section.querySelector('[name="meetingAgreed"]')?.value || "").trim(),
        comment: normalizeSpaces(section.querySelector('[name="comment"]')?.value),
      }))
      .map((draft) => createDeliveryDraft(draft));
  }

  function bindDeliveryDraftEditor(form, options = {}) {
    const list = form.querySelector("#deliveryDrafts");
    const addButton = form.querySelector("#addDeliveryDraft");
    const clearFieldError = options.clearFieldError || (() => {});
    const escapeAttr = options.escapeAttr || ((input) => String(input ?? ""));
    const escapeHtml = options.escapeHtml || ((input) => String(input ?? ""));
    const intervals = Array.isArray(options.intervals) ? options.intervals : [];
    const isEdit = Boolean(options.isEdit);
    if (!list) return;

    let expandedStates = [];

    const updateSectionSummary = (section) => {
      const summary = section.querySelector("[data-delivery-draft-summary]");
      if (!summary) return;
      const draft = createDeliveryDraft({
        deliveryNumber: section.querySelector('[name="deliveryNumber"]')?.value,
        productType: section.querySelector('[name="productType"]')?.value,
        deliveryAddress: section.querySelector('[name="deliveryAddress"]')?.value,
        deliveryInterval: section.querySelector('[name="deliveryIntervalRow"]')?.value,
        meetingAgreed: section.querySelector('[name="meetingAgreed"]')?.value,
        comment: section.querySelector('[name="comment"]')?.value,
      });
      summary.textContent = getDeliveryDraftSummary(draft);
    };

    const applyExpandedStates = () => {
      Array.from(list.querySelectorAll("[data-delivery-draft]")).forEach((section, index) => {
        const expanded = Boolean(expandedStates[index]);
        section.classList.toggle("is-expanded", expanded);
        section.classList.toggle("is-collapsed", !expanded);
        section.querySelector(".delivery-draft__content")?.toggleAttribute("hidden", !expanded);
        section.querySelector("[data-toggle-delivery-draft]")?.setAttribute("aria-expanded", expanded ? "true" : "false");
      });
    };

    const setExpanded = (index, expanded) => {
      expandedStates[index] = Boolean(expanded);
      applyExpandedStates();
    };

    const toggleExpanded = (index) => {
      setExpanded(index, !expandedStates[index]);
    };

    const bindSection = (section, index) => {
      section.querySelectorAll("input, textarea, select").forEach((field) => {
        field.addEventListener("input", () => {
          clearFieldError(field);
          updateSectionSummary(section);
        });
        field.addEventListener("change", () => {
          clearFieldError(field);
          updateSectionSummary(section);
        });
      });
      section.querySelectorAll("[data-meeting-choice]").forEach((button) => {
        button.addEventListener("click", () => {
          section.querySelector('[name="meetingAgreed"]').value = button.dataset.meetingChoice;
          section.querySelectorAll("[data-meeting-choice]").forEach((item) => item.classList.toggle("is-active", item === button));
          clearFieldError(section.querySelector('[name="meetingAgreed"]'));
          updateSectionSummary(section);
        });
      });
      section.querySelector("[data-toggle-delivery-draft]")?.addEventListener("click", () => toggleExpanded(index));
      section.querySelector("[data-remove-delivery-draft]")?.addEventListener("click", () => {
        const drafts = collectDeliveryDraftsFromForm(form);
        const nextExpandedStates = expandedStates.filter((_, draftIndex) => draftIndex !== index);
        drafts.splice(index, 1);
        renderDrafts(drafts, nextExpandedStates);
      });
      updateSectionSummary(section);
    };

    const renderDrafts = (drafts, nextExpandedStates = []) => {
      expandedStates = drafts.map((_, index) => Boolean(nextExpandedStates[index]));
      list.innerHTML = drafts
        .map((draft, index) =>
          renderDeliveryDraftCard(draft, index, {
            escapeAttr,
            escapeHtml,
            intervals,
            expanded: expandedStates[index],
            canRemove: !isEdit && drafts.length > 1,
          }),
        )
        .join("");
      Array.from(list.querySelectorAll("[data-delivery-draft]")).forEach((section, index) => bindSection(section, index));
      applyExpandedStates();
    };

    addButton?.addEventListener("click", () => {
      const drafts = collectDeliveryDraftsFromForm(form);
      const nextExpandedStates = drafts.map(() => false);
      drafts.push(createDeliveryDraft());
      nextExpandedStates.push(true);
      renderDrafts(drafts, nextExpandedStates);
      list.querySelector('[data-delivery-draft]:last-child [name="deliveryNumber"]')?.focus();
    });

    const initialDrafts = Array.isArray(options.drafts) && options.drafts.length ? options.drafts : [createDeliveryDraft()];
    renderDrafts(initialDrafts, initialDrafts.map((_, index) => index === 0));
    form.__setDeliveryDraftExpanded = setExpanded;
  }


  async function handleSwapFormSubmit(event) {
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
      pointType: "swap",
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

  async function handleDeliveryFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const existingPoint = state.points.find((item) => item.id === event.currentTarget.dataset.pointId) || null;
    const draftSections = Array.from(form.querySelectorAll("[data-delivery-draft]"));
    const draftPayloads = draftSections.map((section, index) => ({
      index,
      section,
      deliveryNumber: normalizeSpaces(section.querySelector('[name="deliveryNumber"]')?.value),
      productType: String(section.querySelector('[name="productType"]')?.value || "").trim(),
      deliveryAddress: normalizeSpaces(section.querySelector('[name="deliveryAddress"]')?.value),
      deliveryInterval: String(section.querySelector('[name="deliveryIntervalRow"]')?.value || "").trim(),
      meetingAgreed: String(section.querySelector('[name="meetingAgreed"]')?.value || "").trim(),
      comment: normalizeSpaces(section.querySelector('[name="comment"]')?.value),
      deliveryNumberInput: section.querySelector('[name="deliveryNumber"]'),
      productTypeInput: section.querySelector('[name="productType"]'),
      deliveryAddressInput: section.querySelector('[name="deliveryAddress"]'),
      deliveryIntervalInput: section.querySelector('[name="deliveryIntervalRow"]'),
      meetingAgreedInput: section.querySelector('[name="meetingAgreed"]'),
      commentInput: section.querySelector('[name="comment"]'),
    }));

    let firstInvalid = null;
    const expandDraft = (draft) => {
      form.__setDeliveryDraftExpanded?.(draft.index, true);
    };

    draftPayloads.forEach((draft) => {
      if (!draft.deliveryNumber) {
        setFieldError(draft.deliveryNumberInput, "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u043e\u043c\u0435\u0440 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438.");
        firstInvalid = firstInvalid || draft.deliveryNumberInput;
        expandDraft(draft);
      }
      if (!draft.productType) {
        setFieldError(draft.productTypeInput, "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u043e\u0434\u0443\u043a\u0442.");
        firstInvalid = firstInvalid || draft.productTypeInput;
        expandDraft(draft);
      }
      if (!draft.deliveryAddress) {
        setFieldError(draft.deliveryAddressInput, "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438.");
        firstInvalid = firstInvalid || draft.deliveryAddressInput;
        expandDraft(draft);
      }
      if (!draft.deliveryInterval) {
        setFieldError(draft.deliveryIntervalInput, "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u043d\u0442\u0435\u0440\u0432\u0430\u043b \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438.");
        firstInvalid = firstInvalid || draft.deliveryIntervalInput;
        expandDraft(draft);
      }
      if (!draft.meetingAgreed) {
        setFieldError(draft.meetingAgreedInput, "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435, \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0430 \u043b\u0438 \u0432\u0441\u0442\u0440\u0435\u0447\u0430.");
        firstInvalid = firstInvalid || draft.meetingAgreedInput;
        expandDraft(draft);
      }
      if (draft.deliveryAddress && containsForbiddenContent(draft.deliveryAddress)) {
        setFieldError(draft.deliveryAddressInput, "\u041d\u0435\u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u043e\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u043c\u043e\u0435: \u0443\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u0430\u0442 \u0438\u043b\u0438 \u043f\u043e\u0448\u043b\u044b\u0439 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442.");
        firstInvalid = firstInvalid || draft.deliveryAddressInput;
        expandDraft(draft);
      }
      if (draft.comment && containsForbiddenContent(draft.comment)) {
        setFieldError(draft.commentInput, "\u041d\u0435\u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u043e\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u043c\u043e\u0435: \u0443\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u0430\u0442 \u0438\u043b\u0438 \u043f\u043e\u0448\u043b\u044b\u0439 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442.");
        firstInvalid = firstInvalid || draft.commentInput;
        expandDraft(draft);
      }
    });

    if (firstInvalid) {
      firstInvalid.focus?.();
      showToast("\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435 \u0444\u043e\u0440\u043c\u044b.");
      return;
    }

    const deliveryPoints = [];
    for (const draft of draftPayloads) {
      const resolvedLatLng = await geocodeDeliveryAddress(draft.deliveryAddress).catch(() => null);
      if (!resolvedLatLng) {
        setFieldError(draft.deliveryAddressInput, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0439\u0442\u0438 \u0430\u0434\u0440\u0435\u0441 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435. \u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0438\u043b\u0438 \u0434\u043e\u043c.");
        expandDraft(draft);
        draft.deliveryAddressInput?.focus();
        showToast("\u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438. \u041c\u0435\u0442\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u0451\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e \u043d\u0430\u0439\u0434\u0435\u043d\u043d\u043e\u043c\u0443 \u0430\u0434\u0440\u0435\u0441\u0443.");
        return;
      }
      deliveryPoints.push({
        pointType: "delivery",
        id: existingPoint?.id || "",
        cityId: state.cityId,
        lat: resolvedLatLng.lat,
        lng: resolvedLatLng.lng,
        deliveryNumber: draft.deliveryNumber,
        productType: draft.productType,
        deliveryInterval: draft.deliveryInterval,
        deliveryAddress: draft.deliveryAddress,
        meetingAgreed: draft.meetingAgreed,
        comment: draft.comment,
      });
    }

    try {
      if (existingPoint) {
        await saveRemotePoint(deliveryPoints[0], existingPoint);
        saveLastLocation(L.latLng(deliveryPoints[0].lat, deliveryPoints[0].lng), 14);
      } else {
        await saveRemotePointsBatch(deliveryPoints);
        saveLastLocation(L.latLng(deliveryPoints[0].lat, deliveryPoints[0].lng), 14);
      }
    } catch (error) {
      console.error(error);
      showToast(error.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443.");
    }
  }

  function buildPointUpsertPayload(point, existing) {
    return point.pointType === "delivery"
      ? {
          point_id: existing?.id || null,
          point_type: "delivery",
          city_id: point.cityId,
          day_key: getDayKey(getActiveCity()),
          delivery_number: point.deliveryNumber,
          product_type: point.productType,
          delivery_interval: point.deliveryInterval,
          delivery_address: point.deliveryAddress,
          meeting_agreed: point.meetingAgreed,
          comment: point.comment || null,
          lat: point.lat,
          lng: point.lng,
        }
      : {
          point_id: existing?.id || null,
          point_type: "swap",
          city_id: point.cityId,
          day_key: getDayKey(getActiveCity()),
          preferred_location: point.location,
          logistic_center: point.logisticCenter || null,
          comment: point.comment || null,
          attachments: point.attachments || [],
          lat: point.lat,
          lng: point.lng,
        };
  }

  async function saveRemotePoint(point, existing, options = {}) {
    const { silentToast = false } = options;
    const payload = buildPointUpsertPayload(point, existing);
    const result = await apiClient.upsertPoint(payload);

    if (!existing && result.point?.id) {
      markerIntroPointIds.add(result.point.id);
    }
    await loadRemoteState();
    const savedPoint = normalizeRemotePoint(result.point);
    if (existing) {
      openCard(savedPoint.id);
    } else {
      closeSheet();
    }
    if (!silentToast) {
      showToast(
        existing
          ? point.pointType === "delivery"
            ? "Заявка на доставку обновлена."
            : "Ваша точка обновлена."
          : point.pointType === "delivery"
            ? "Метка доставки опубликована на карте."
            : "Точка опубликована на общей карте.",
      );
    }
  }

  async function saveRemotePointsBatch(points) {
    if (!Array.isArray(points) || !points.length) return;
    for (const point of points) {
      const result = await apiClient.upsertPoint(buildPointUpsertPayload(point, null));
      if (result.point?.id) {
        markerIntroPointIds.add(result.point.id);
      }
    }
    await loadRemoteState();
    closeSheet();
    showToast(
      points.length === 1
        ? "Метка доставки опубликована на карте."
        : `Опубликовано ${points.length} меток доставки.`,
    );
  }

  function openCard(pointId) {
    const point = getPoint(pointId);
    if (!point) return;
    if (point.pointType === "delivery") {
      if (!point.isOwn && point.deliveryAvailability === "reserved" && !point.deliveryReservedByMe) {
        showToast("Метка уже забронирована, дождитесь пока она станет доступна или выберите другую.");
        return;
      }
      openDeliveryCard(point);
      return;
    }

    const isOwn = point.id === state.ownPointId;
    const status = statuses[point.status] || statuses.search;
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
      <p class="sheet-subtitle">${escapeHtml(exchangeLabel)}</p>
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
    if (editOwn) editOwn.addEventListener("click", () => openSwapForm(point));

    const moveOwnPoint = document.getElementById("moveOwnPoint");
    if (moveOwnPoint) {
      moveOwnPoint.addEventListener("click", () => {
        moveMode = true;
        closeSheet();
        showToast("Тапните новое место на карте.");
      });
    }

    const deleteButton = document.getElementById("deletePoint");
    if (deleteButton) deleteButton.addEventListener("click", () => deletePoint(point));

    openSheet();
  }

  function openDeliveryCard(point) {
    const isOwn = Boolean(point.isOwn);
    const detailsVisible = Boolean(point.deliveryDetailsVisible || point.deliveryReservedByMe || isOwn);
    const availabilityLabel =
      point.deliveryAvailability === "available"
        ? "Доступна"
        : point.deliveryReservedByMe || isOwn
          ? "Забронирована вами"
          : "Забронирована";
    const detailItems = detailsVisible
      ? [
          renderDetailItem("Номер доставки", point.deliveryNumber),
          renderDetailItem("Адрес", point.deliveryAddress),
          renderDetailItem("Встреча согласована", formatMeetingAgreed(point.meetingAgreed)),
          renderDetailItem("Телефон", canViewPointContacts(point) ? point.phone : ""),
          renderDetailItem("Telegram", canViewPointContacts(point) ? point.telegram : ""),
          renderDetailItem("Комментарий", point.comment),
        ].filter(Boolean)
      : [];

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">${isOwn ? "Моя заявка на доставку" : "Заявка на доставку"}</h2>
      <p class="sheet-subtitle">${escapeHtml(point.productType)} • ${escapeHtml(point.deliveryInterval)}</p>
      <div class="status-row">
        <span class="status-badge ${point.deliveryAvailability === "available" ? "status-search" : "status-unavailable"}">${escapeHtml(availabilityLabel)}</span>
        ${isOwn ? '<span class="status-badge status-own">Моя метка</span>' : ""}
      </div>
      ${
        !detailsVisible && !isOwn
          ? '<div class="public-warning">Чтобы открыть полную информацию и контакты автора, сначала забронируйте метку.</div>'
          : ""
      }
      ${detailItems.length ? `<div class="detail-grid">${detailItems.join("")}</div>` : ""}
      <div class="button-grid">
        ${
          !isOwn && !detailsVisible
            ? '<button class="action-button primary" id="reserveDeliveryPoint" type="button">Забронировать</button>'
            : ""
        }
        ${!isOwn && detailsVisible ? renderContactAction("phone", point.phone) : ""}
        ${!isOwn && detailsVisible ? renderContactAction("telegram", point.telegram) : ""}
        ${isOwn ? '<button class="action-button" id="editDeliveryPoint" type="button">Изменить данные</button>' : ""}
        ${isOwn ? '<button class="action-button danger" id="deleteDeliveryPoint" type="button">Удалить</button>' : ""}
      </div>
    `;

    document.getElementById("reserveDeliveryPoint")?.addEventListener("click", () => reserveDeliveryPoint(point.id));
    document.getElementById("editDeliveryPoint")?.addEventListener("click", () => openDeliveryForm(point));
    document.getElementById("deleteDeliveryPoint")?.addEventListener("click", () => deletePoint(point));
    openSheet();
  }

  function getPointExchangeLabel(point) {
    const location = normalizeSpaces(point?.location || "");
    if (!location) return "Меняюсь на:";
    return `Меняюсь на: ${location}`;
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

  async function reserveDeliveryPoint(pointId) {
    try {
      const result = await apiClient.reservePoint(pointId);
      await loadRemoteState();
      const point = normalizeRemotePoint(result.point);
      openDeliveryCard(point);
      showToast("Метка забронирована за вами.");
    } catch (error) {
      showToast(error.message || "Не удалось забронировать метку.");
    }
  }

  async function geocodeDeliveryAddress(address) {
    const normalized = normalizeSpaces(address);
    if (!normalized) return null;

    const city = getActiveCity();
    const geocodeBounds = city.geocodeBounds || city.bounds || null;
    const requestVariants = buildGeocodeAddressQueries(normalized, city);

    for (const requestVariant of requestVariants) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "5");
      url.searchParams.set("countrycodes", "ru");
      url.searchParams.set("addressdetails", "1");
      if (geocodeBounds) {
        const [[minLat, minLng], [maxLat, maxLng]] = geocodeBounds;
        url.searchParams.set("viewbox", `${minLng},${maxLat},${maxLng},${minLat}`);
        url.searchParams.set("bounded", "1");
      }
      Object.entries(requestVariant).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
      });
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "ru",
        },
      });
      if (!response.ok) continue;
      const data = await response.json().catch(() => []);
      const match = pickBestGeocodeCandidate(Array.isArray(data) ? data : [], normalized, city);
      const lat = Number(match?.lat);
      const lng = Number(match?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng) && isAllowedMapPoint({ lat, lng })) {
        return { lat, lng };
      }
    }
    return null;
  }

  function buildGeocodeAddressQueries(address, city) {
    const fallbackCityName = city?.name || getActiveCityName();
    const parsed = parseDeliveryAddressComponents(address, fallbackCityName);
    const cityName = parsed.cityName || fallbackCityName;
    const countryName = "\u0420\u043e\u0441\u0441\u0438\u044f";
    const citySuffix = cityName ? `, ${cityName}, ${countryName}` : `, ${countryName}`;
    const queryValues = [
      parsed.structuredStreet ? `${parsed.structuredStreet}${citySuffix}` : "",
      parsed.structuredStreet && parsed.district ? `${parsed.structuredStreet}, ${parsed.district}${citySuffix}` : "",
      parsed.streetWithHouse ? `${parsed.streetWithHouse}${citySuffix}` : "",
      parsed.streetWithHouse && parsed.district ? `${parsed.streetWithHouse}, ${parsed.district}${citySuffix}` : "",
      parsed.tailThree ? `${parsed.tailThree}${includesGeocodeFragment(parsed.tailThree, cityName) ? `, ${countryName}` : citySuffix}` : "",
      parsed.tailTwo ? `${parsed.tailTwo}${includesGeocodeFragment(parsed.tailTwo, cityName) ? `, ${countryName}` : citySuffix}` : "",
      parsed.withoutUnit
        ? `${parsed.withoutUnit}${includesGeocodeFragment(parsed.withoutUnit, cityName) ? `, ${countryName}` : citySuffix}`
        : "",
      `${parsed.expanded}${includesGeocodeFragment(parsed.expanded, cityName) ? `, ${countryName}` : citySuffix}`,
    ];
    const variants = [];
    const seen = new Set();

    const pushVariant = (variant) => {
      const entries = Object.entries(variant).filter(([, value]) => value);
      if (!entries.length) return;
      const key = entries
        .map(([entryKey, value]) => `${entryKey}:${normalizeGeocodeAddressInput(String(value))}`)
        .join("|");
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(variant);
    };

    if (parsed.structuredStreet) {
      pushVariant({
        street: parsed.structuredStreet,
        city: cityName,
        county: parsed.district || "",
        postalcode: parsed.postalCode || "",
        country: countryName,
      });
    }

    queryValues
      .map((value) => normalizeGeocodeAddressInput(value))
      .filter(Boolean)
      .forEach((value) => pushVariant({ q: value }));

    return variants;
  }

  function parseDeliveryAddressComponents(address, fallbackCityName) {
    const expanded = expandGeocodeAddressText(address);
    const postalCode = (expanded.match(/^\d{5,6}\b/u) || [""])[0];
    const withoutPostal = expanded.replace(/^\d{5,6}\s*,?\s*/u, "");
    const withoutUnit = removeTrailingUnitSegment(withoutPostal);
    const segments = withoutUnit.split(/\s*,\s*/).filter(Boolean);
    const fallbackCityFragment = normalizeGeocodeFragment(fallbackCityName);
    const citySegment =
      segments.find((segment) => /\b(?:\u0433\u043e\u0440\u043e\u0434|\u0433)\b/iu.test(segment)) ||
      segments.find((segment) => fallbackCityFragment && includesGeocodeFragment(segment, fallbackCityName)) ||
      "";
    const cityName = normalizeCitySegment(citySegment) || fallbackCityName;
    const cityFragment = normalizeGeocodeFragment(cityName);
    const filteredSegments = segments.filter((segment) => {
      const normalizedSegment = normalizeGeocodeFragment(segment);
      if (!normalizedSegment) return false;
      if (cityFragment && normalizedSegment === cityFragment) return false;
      return !/^\d{5,6}$/u.test(normalizedSegment);
    });

    const district =
      filteredSegments.find((segment) => /\b(?:\u0440\u0430\u0439\u043e\u043d|\u043e\u043a\u0440\u0443\u0433|\u043f\u043e\u0441\u0435\u043b\u0435\u043d\u0438\u0435)\b/iu.test(segment)) ||
      "";
    const street =
      filteredSegments.find((segment) =>
        /\b(?:\u0443\u043b\u0438\u0446\u0430|\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442|\u043f\u0435\u0440\u0435\u0443\u043b\u043e\u043a|\u043f\u0440\u043e\u0435\u0437\u0434|\u0448\u043e\u0441\u0441\u0435|\u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0430\u044f|\u0431\u0443\u043b\u044c\u0432\u0430\u0440|\u043f\u043b\u043e\u0449\u0430\u0434\u044c|\u0430\u043b\u043b\u0435\u044f|\u043f\u0440\u043e\u0441\u0435\u043a)\b/iu.test(
          segment,
        ),
      ) ||
      "";
    const house =
      filteredSegments.find((segment) =>
        /\b(?:\u0434\u043e\u043c|\u043a\u043e\u0440\u043f\u0443\u0441|\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u0435|\u0432\u043b\u0430\u0434\u0435\u043d\u0438\u0435|\u043b\u0438\u0442\u0435\u0440\u0430)\b/iu.test(
          segment,
        ),
      ) ||
      "";
    const streetWithHouse = [street, house].filter(Boolean).join(", ");
    const structuredStreet = normalizeStructuredStreet(street, house);
    return {
      expanded,
      postalCode,
      withoutPostal,
      withoutUnit,
      cityName,
      district,
      street,
      house,
      streetWithHouse,
      structuredStreet,
      tailTwo: filteredSegments.slice(-2).join(", "),
      tailThree: filteredSegments.slice(-3).join(", "),
    };
  }

  function expandGeocodeAddressText(address) {
    return normalizeGeocodeAddressInput(
      String(address || "")
        .replace(/\b\u0433\.?\s+/giu, "\u0433\u043e\u0440\u043e\u0434 ")
        .replace(/\b\u0440-?\u043d\b/giu, "\u0440\u0430\u0439\u043e\u043d")
        .replace(/\b\u0443\u043b\.?\s+/giu, "\u0443\u043b\u0438\u0446\u0430 ")
        .replace(/\b\u043f\u0440-?\u0442\.?\s+/giu, "\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442 ")
        .replace(/\b\u043f\u0435\u0440\.?\s+/giu, "\u043f\u0435\u0440\u0435\u0443\u043b\u043e\u043a ")
        .replace(/\b\u043f\u0440-?\u0434\.?\s+/giu, "\u043f\u0440\u043e\u0435\u0437\u0434 ")
        .replace(/\b\u0448\.?\s+/giu, "\u0448\u043e\u0441\u0441\u0435 ")
        .replace(/\b\u043d\u0430\u0431\.?\s+/giu, "\u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0430\u044f ")
        .replace(/\b\u0431-?\u0440\.?\s+/giu, "\u0431\u0443\u043b\u044c\u0432\u0430\u0440 ")
        .replace(/\b\u043f\u043b\.?\s+/giu, "\u043f\u043b\u043e\u0449\u0430\u0434\u044c ")
        .replace(/\b\u0434\.?\s+/giu, "\u0434\u043e\u043c ")
        .replace(/\b\u043a\u043e\u0440\u043f\.?\s+/giu, "\u043a\u043e\u0440\u043f\u0443\u0441 ")
        .replace(/\b\u0441\u0442\u0440\.?\s+/giu, "\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u0435 ")
        .replace(/\b\u043a\u0432\.?\s+/giu, "\u043a\u0432\u0430\u0440\u0442\u0438\u0440\u0430 "),
    );
  }

  function normalizeStructuredStreet(street, house) {
    const normalizedStreet = normalizeSpaces(String(street || "").replace(/^\d{5,6}\s*,?\s*/u, ""));
    const normalizedHouse = normalizeSpaces(String(house || "").replace(/^(?:\u0434\u043e\u043c)\s*/iu, ""));
    if (!normalizedStreet) return "";
    return normalizedHouse ? `${normalizedStreet}, ${normalizedHouse}` : normalizedStreet;
  }

  function normalizeGeocodeAddressInput(address) {
    return normalizeSpaces(String(address || "").replace(/[\r\n]+/g, ", ").replace(/\s*,\s*/g, ", "));
  }

  function removeTrailingUnitSegment(address) {
    return normalizeSpaces(
      String(address || "").replace(
        /(?:,|\s)+(?:\u043a\u0432(?:\u0430\u0440\u0442\u0438\u0440\u0430)?|\u0430\u043f(?:\u0430\u0440\u0442\u0430\u043c\u0435\u043d\u0442)?|apt|\u043f\u043e\u0434(?:\u044a|\u044c)\u0435\u0437\u0434|\u044d\u0442\u0430\u0436|\u044d\u0442\.?|\u043e\u0444\u0438\u0441|\u043f\u043e\u043c(?:\u0435\u0449\u0435\u043d\u0438\u0435)?)\.?\s*[\p{L}\d\-\/]+.*$/iu,
        "",
      ),
    );
  }

  function normalizeCitySegment(segment) {
    return normalizeSpaces(
      String(segment || "")
        .replace(/^\d{5,6}\s*,?\s*/u, "")
        .replace(/^(?:\u0433\u043e\u0440\u043e\u0434|\u0433)\.?\s*/iu, ""),
    );
  }

  function includesGeocodeFragment(value, fragment) {
    return normalizeGeocodeFragment(value).includes(normalizeGeocodeFragment(fragment));
  }

  function normalizeGeocodeFragment(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\u0451/g, "\u0435")
      .replace(/[^\p{L}\d]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickBestGeocodeCandidate(candidates, address, city) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    const cityName = city?.name || getActiveCityName();
    const parsed = parseDeliveryAddressComponents(address, cityName);
    const houseSource = parsed.house || parsed.streetWithHouse || parsed.withoutUnit || "";
    const houseNumber = (houseSource.match(/\b\d+[\p{L}\d\-\/]*\b/iu) || [""])[0].toLowerCase();
    const postalHint = normalizeGeocodeFragment(parsed.postalCode || "");
    const roadHint = normalizeGeocodeFragment(parsed.street || parsed.tailTwo || parsed.withoutUnit || "");
    const districtHint = normalizeGeocodeFragment(parsed.district || "");
    const cityHint = normalizeGeocodeFragment(parsed.cityName || cityName);
    const center = city.center || [0, 0];

    return candidates
      .filter((item) => {
        const lat = Number(item?.lat);
        const lng = Number(item?.lon);
        return Number.isFinite(lat) && Number.isFinite(lng) && isPointInsideGeocodeBounds(lat, lng, city);
      })
      .map((item) => {
        const label = normalizeGeocodeFragment(String(item?.display_name || ""));
        const addressParts = item?.address || {};
        const candidateHouseNumber = normalizeGeocodeFragment(String(addressParts.house_number || ""));
        const candidateRoad = normalizeGeocodeFragment(
          String(addressParts.road || addressParts.pedestrian || addressParts.residential || addressParts.street || ""),
        );
        const candidatePostalCode = normalizeGeocodeFragment(String(addressParts.postcode || ""));
        const candidateDistrict = normalizeGeocodeFragment(
          String(addressParts.city_district || addressParts.suburb || addressParts.borough || ""),
        );
        const candidateCity = normalizeGeocodeFragment(
          String(addressParts.city || addressParts.town || addressParts.state || ""),
        );
        const houseMatch = houseNumber
          ? candidateHouseNumber === houseNumber || candidateHouseNumber.startsWith(houseNumber)
          : false;
        const houseMismatchPenalty = houseNumber && candidateHouseNumber && !houseMatch ? 32000 : 0;
        const postalMatch = postalHint ? label.includes(postalHint) || candidatePostalCode === postalHint : false;
        const roadMatch = roadHint ? label.includes(roadHint) || candidateRoad.includes(roadHint) : false;
        const districtMatch = districtHint ? label.includes(districtHint) || candidateDistrict.includes(districtHint) : false;
        const cityMatch = cityHint ? label.includes(cityHint) || candidateCity.includes(cityHint) : false;
        const categoryPenalty = ["railway", "public_transport", "amenity"].includes(String(item?.category || "")) ? 5000 : 0;
        const distance = getApproxDistanceMeters(center[0], center[1], Number(item.lat), Number(item.lon));
        const importanceBoost = Math.round(Number(item?.importance || 0) * 1000);
        return {
          item,
          score:
            (cityMatch ? 80000 : 0) +
            (houseMatch ? 60000 : 0) +
            (postalMatch ? 25000 : 0) +
            (roadMatch ? 35000 : 0) +
            (districtMatch ? 15000 : 0) +
            importanceBoost -
            houseMismatchPenalty -
            categoryPenalty -
            distance,
        };
      })
      .sort((left, right) => right.score - left.score)[0]?.item || null;
  }

  function isPointInsideGeocodeBounds(lat, lng, city) {
    const bounds = city.geocodeBounds || city.bounds;
    if (!Array.isArray(bounds)) return true;
    const [[minLat, minLng], [maxLat, maxLng]] = bounds;
    return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
  }

  function formatMeetingAgreed(value) {
    return deliveryMeetingOptions[value] || "";
  }

  async function createProposal(target) {
    const own = getOwnPoint();
    if (!own) {
      showToast("Сначала добавьте свою точку на карту.");
      return;
    }

    if (target.pointType !== "swap") {
      showToast("Обмен доступен только для меток обмена районами.");
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
      focusProposalRoute(getPoint(own.id), getPoint(target.id));
      closeSheet();
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

    const incoming = state.proposals.filter((proposal) => proposal.toId === own.id && proposal.status === "pending");
    const outgoing = state.proposals.filter((proposal) => proposal.fromId === own.id && proposal.status === "pending");
    const completed = state.proposals.filter(
      (proposal) => (proposal.toId === own.id || proposal.fromId === own.id) && proposal.status !== "pending",
    );
    const list = activeTab === "outgoing" ? outgoing : activeTab === "completed" ? completed : incoming;
    const emptyMessage =
      activeTab === "completed" ? "Завершенных обменов пока нет." : "Активных заявок пока нет.";

    dom.sheetContent.innerHTML = `
      <h2 class="sheet-title">Заявки на обмен</h2>
      <p class="sheet-subtitle">Контакты откроются обеим сторонам после принятия обмена.</p>
      <div class="tabs scroll-row" role="tablist" aria-label="Тип заявок">
        <button class="tab-button ${activeTab === "incoming" ? "is-active" : ""}" type="button" data-proposal-tab="incoming">
          <span class="tab-button__label">Входящие</span>
          <span class="tab-button__count">${incoming.length}</span>
        </button>
        <button class="tab-button ${activeTab === "outgoing" ? "is-active" : ""}" type="button" data-proposal-tab="outgoing">
          <span class="tab-button__label">Исходящие</span>
          <span class="tab-button__count">${outgoing.length}</span>
        </button>
        <button class="tab-button ${activeTab === "completed" ? "is-active" : ""}" type="button" data-proposal-tab="completed">
          <span class="tab-button__label">Завершенные</span>
          <span class="tab-button__count">${completed.length}</span>
        </button>
      </div>
      <div class="nearby-list">
        ${list.length ? list.map((proposal) => renderProposalItem(proposal, activeTab)).join("") : `<div class="empty-state">${emptyMessage}</div>`}
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
    initScrollableRowsFromModule?.(dom.sheetContent);

    openSheet();
  }

  function renderProposalItem(proposal, activeTab) {
    const own = getOwnPoint();
    const from = getPoint(proposal.fromId);
    const to = getPoint(proposal.toId);
    const colleague =
      activeTab === "completed"
        ? proposal.fromId === own?.id
          ? to
          : from
        : activeTab === "outgoing"
          ? to
          : from;
    const displayName = colleague ? getPointDisplayName(colleague) : "Сотрудник удален";
    const canAnswer = proposal.status === "pending" && activeTab === "incoming";
    const canDecline = proposal.status === "pending" && (activeTab === "incoming" || activeTab === "outgoing");
    const proposalMeta =
      activeTab === "completed"
        ? proposal.status === "accepted"
          ? "Обмен завершен"
          : "Заявка закрыта"
        : activeTab === "outgoing"
          ? "Вы предложили обмен"
          : "Вам предложили обмен";

    return `
      <article class="nearby-item">
        <div class="nearby-head">
          <strong>${escapeHtml(displayName)}</strong>
          <span class="proposal-status proposal-${proposal.status}">${proposalStatuses[proposal.status]}</span>
        </div>
        <p class="nearby-meta">
          ${proposalMeta}
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
          ${canDecline ? `<button type="button" data-decline-proposal="${proposal.id}">Отклонить</button>` : ""}
        </div>
      </article>
    `;
  }

  async function acceptProposal(proposalId, activeTab) {
    try {
      const proposal = state.proposals.find((item) => item.id === proposalId);
      const fromBefore = proposal ? getPoint(proposal.fromId) : null;
      const toBefore = proposal ? getPoint(proposal.toId) : null;
      await apiClient.acceptOffer(proposalId);
      if (proposal && fromBefore && toBefore) {
        queuePointTravelAnimation(proposal.fromId, fromBefore, toBefore);
        queuePointTravelAnimation(proposal.toId, toBefore, fromBefore);
      }
      await loadRemoteState();
      closeSheet();
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
      .filter((point) => point.pointType === "swap")
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
      dom.logisticCenterFilterSelect.innerHTML = '<option value="">Все ЛЦ</option>';
      dom.logisticCenterFilterSelect.value = "";
      dom.logisticCenterFilterField.hidden = true;
      filterSelectController?.sync?.();
      return;
    }

    if (activeLogisticCenterFilter && !region.options.includes(activeLogisticCenterFilter)) {
      activeLogisticCenterFilter = "";
    }

    dom.logisticCenterFilterSelect.innerHTML = ['<option value="">Все ЛЦ</option>']
      .concat(
        region.options.map(
          (option) =>
            `<option value="${escapeAttr(option)}" ${activeLogisticCenterFilter === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
        ),
      )
      .join("");
    dom.logisticCenterFilterSelect.value = activeLogisticCenterFilter;
    dom.logisticCenterFilterField.hidden = false;
    filterSelectController?.sync?.();
  }

  function refreshMarkers() {
    if (!clusterLayer) return;
    const visiblePoints = getVisiblePoints();
    const visibleIds = new Set(visiblePoints.map((point) => point.id));

    visiblePoints.forEach((point) => {
      const signature = getMarkerSignature(point);
      let marker = markerRegistry.get(point.id);

      if (!marker || marker.__cpSignature !== signature) {
        const shouldPlayIntro = markerIntroPointIds.has(point.id);
        if (marker) clusterLayer.removeLayer(marker);
        marker = buildPointMarker(point);
        marker.__cpSignature = signature;
        markerRegistry.set(point.id, marker);
        clusterLayer.addLayer(marker);
        if (shouldPlayIntro) {
          playMarkerIntro(marker, point.id);
        }
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
    refreshPendingProposalLinks(visibleIds);
    playQueuedMarkerTravelAnimations();
    syncVisibleDeliveryMarkerModes();
  }

  function syncVisibleDeliveryMarkerModes() {
    const mode = getDeliveryMarkerModeFromModule?.(map);
    markerRegistry.forEach((marker, pointId) => {
      const point = getPoint(pointId);
      if (!point || point.pointType !== "delivery") return;
      syncDeliveryMarkerModeFromModule?.(marker, mode);
    });
  }

  function buildPointMarker(point) {
    const marker = L.marker([point.lat, point.lng], {
      icon:
        point.pointType === "delivery"
          ? createDeliveryIconFromModule?.({
              L,
              point,
              mode: getDeliveryMarkerModeFromModule?.(map),
              escapeHtml,
              intro: markerIntroPointIds.has(point.id),
            })
          : createPersonIcon(point),
      title: getPointDisplayName(point),
    });
    if (point.pointType === "delivery") {
      marker.on("add", () => syncDeliveryMarkerModeFromModule?.(marker, getDeliveryMarkerModeFromModule?.(map)));
    }
    marker.on("click", () => openCard(point.id));
    return marker;
  }

  function createPersonIcon(point) {
    const status = statuses[point.status] || statuses.search;
    const ownClass = point.isOwn ? "marker-own" : "";
    const introClass = markerIntroPointIds.has(point.id) ? "marker-intro" : "";
    const pendingState = getPendingProposalState(point.id);
    const pendingClass =
      pendingState === "outgoing"
        ? "marker-pending marker-pending-outgoing"
        : pendingState === "incoming"
          ? "marker-pending marker-pending-incoming"
          : pendingState === "both"
            ? "marker-pending marker-pending-both"
            : "";
    return L.divIcon({
      html: `
        <span class="person-marker__figure" aria-hidden="true">
          <span class="person-marker__head"></span>
          <span class="person-marker__body"></span>
          <span class="person-marker__card"></span>
          <span class="person-marker__docs"></span>
        </span>
      `,
      className: `person-marker ${status.markerClass} ${ownClass} ${introClass} ${pendingClass}`,
      iconSize: [34, 40],
      iconAnchor: [17, 40],
    });
  }

  function getPendingProposalState(pointId) {
    let hasOutgoing = false;
    let hasIncoming = false;
    state.proposals.forEach((proposal) => {
      if (proposal.status !== "pending") return;
      if (proposal.fromId === pointId) hasOutgoing = true;
      if (proposal.toId === pointId) hasIncoming = true;
    });
    if (hasOutgoing && hasIncoming) return "both";
    if (hasOutgoing) return "outgoing";
    if (hasIncoming) return "incoming";
    return "none";
  }

  function refreshPendingProposalLinks(visibleIds) {
    if (!proposalLinkLayer) return;
    proposalLinkLayer.clearLayers();
    state.proposals.forEach((proposal) => {
      if (proposal.status !== "pending") return;
      const fromPoint = getPoint(proposal.fromId);
      const toPoint = getPoint(proposal.toId);
      if (!fromPoint || !toPoint) return;
      if (!visibleIds.has(fromPoint.id) || !visibleIds.has(toPoint.id)) return;
      if (!isPersonMarkerVisibleOnMap(fromPoint.id) || !isPersonMarkerVisibleOnMap(toPoint.id)) return;
      const latLngs = [
        [fromPoint.lat, fromPoint.lng],
        [toPoint.lat, toPoint.lng],
      ];
      const baseLine = L.polyline(
        latLngs,
        {
          className: "proposal-link-base",
          color: "#f59e0b",
          weight: 2,
          opacity: 0.35,
          lineCap: "round",
          interactive: false,
        },
      ).addTo(proposalLinkLayer);
      const shotLine = L.polyline(
        latLngs,
        {
          className: "proposal-link-shot",
          color: "#f59e0b",
          weight: 3,
          opacity: 1,
          lineCap: "round",
          interactive: false,
        },
      ).addTo(proposalLinkLayer);
      baseLine.getElement()?.setAttribute("pathLength", "100");
      shotLine.getElement()?.setAttribute("pathLength", "100");
    });
  }

  function refreshPendingProposalLinksForCurrentView() {
    if (!proposalLinkLayer || !map) return;
    const visibleIds = new Set(getVisiblePoints().map((point) => point.id));
    refreshPendingProposalLinks(visibleIds);
  }

  function isPersonMarkerVisibleOnMap(pointId) {
    if (!map || !clusterLayer) return false;
    const point = getPoint(pointId);
    if (!point || point.pointType !== "swap") return false;

    const marker = markerRegistry.get(pointId);
    if (!marker || !clusterLayer.hasLayer(marker)) return false;
    if (!map.getBounds().pad(0.02).contains(marker.getLatLng())) return false;

    const visibleParent = clusterLayer.getVisibleParent?.(marker);
    if (visibleParent !== marker) return false;

    const iconElement = marker.getElement?.() || marker._icon;
    return Boolean(iconElement && iconElement.classList?.contains("person-marker"));
  }

  function focusProposalRoute(fromPoint, toPoint) {
    if (!map || !fromPoint || !toPoint) return;
    const fromLat = Number(fromPoint.lat);
    const fromLng = Number(fromPoint.lng);
    const toLat = Number(toPoint.lat);
    const toLng = Number(toPoint.lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return;
    const fromLatLng = L.latLng(fromLat, fromLng);
    const toLatLng = L.latLng(toLat, toLng);
    const bounds = L.latLngBounds([fromLatLng, toLatLng]);
    if (!bounds.isValid()) return;
    if (Math.abs(fromLat - toLat) < 0.000001 && Math.abs(fromLng - toLng) < 0.000001) {
      map.setView(fromLatLng, Math.max(map.getZoom(), 14), { animate: true });
      return;
    }
    fitProposalBounds(bounds, { animate: true });
  }

  function focusPendingProposalsOnLoad() {
    if (!map) return;
    const own = getOwnPoint();
    if (!own) return;
    const pendingProposals = state.proposals.filter(
      (proposal) => proposal.status === "pending" && (proposal.fromId === own.id || proposal.toId === own.id),
    );
    if (!pendingProposals.length) return;

    const boundsPoints = new Map();
    boundsPoints.set(own.id, own);
    pendingProposals.forEach((proposal) => {
      const fromPoint = getPoint(proposal.fromId);
      const toPoint = getPoint(proposal.toId);
      if (fromPoint) boundsPoints.set(fromPoint.id, fromPoint);
      if (toPoint) boundsPoints.set(toPoint.id, toPoint);
    });

    const latLngs = Array.from(boundsPoints.values())
      .map((point) => {
        const lat = Number(point.lat);
        const lng = Number(point.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
      })
      .filter(Boolean);

    if (!latLngs.length) return;
    if (latLngs.length === 1) {
      map.setView(latLngs[0], Math.max(map.getZoom(), 14), { animate: true });
      return;
    }

    const bounds = L.latLngBounds(latLngs);
    if (!bounds.isValid()) return;
    fitProposalBounds(bounds, { animate: true });
  }

  function clearPendingProposalFocusSnapshot() {
    try {
      localStorage.removeItem("changeplace:pending_focus");
    } catch {}
  }

  function hasActivePendingProposals() {
    const own = getOwnPoint();
    if (!own) return false;
    return state.proposals.some(
      (proposal) => proposal.status === "pending" && (proposal.fromId === own.id || proposal.toId === own.id),
    );
  }

  function fitProposalBounds(bounds, options = {}) {
    if (!map || !bounds?.isValid?.()) return;
    map.fitBounds(bounds.pad(0.38), {
      paddingTopLeft: [28, 86],
      paddingBottomRight: [28, 150],
      maxZoom: 13,
      animate: options.animate !== false,
    });
  }

  function queueExchangeTravelAnimations(previousPointsById, nextPoints) {
    nextPoints.forEach((nextPoint) => {
      const previousPoint = previousPointsById.get(nextPoint.id);
      if (!previousPoint || nextPoint.status !== "agreed") return;
      queuePointTravelAnimation(nextPoint.id, previousPoint, nextPoint);
    });
  }

  function queuePointTravelAnimation(pointId, fromPoint, toPoint) {
    if (!pointId || !hasPointMoved(fromPoint, toPoint)) return;
    markerTravelQueue.set(pointId, {
      from: { lat: Number(fromPoint.lat), lng: Number(fromPoint.lng) },
      to: { lat: Number(toPoint.lat), lng: Number(toPoint.lng) },
    });
  }

  function hasPointMoved(fromPoint, toPoint) {
    const fromLat = Number(fromPoint?.lat);
    const fromLng = Number(fromPoint?.lng);
    const toLat = Number(toPoint?.lat);
    const toLng = Number(toPoint?.lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return false;
    return Math.abs(fromLat - toLat) > 0.000001 || Math.abs(fromLng - toLng) > 0.000001;
  }

  function playMarkerIntro(marker, pointId) {
    markerIntroPointIds.delete(pointId);
    window.setTimeout(() => {
      marker.getElement()?.classList.remove("marker-intro");
    }, 950);
  }

  function playQueuedMarkerTravelAnimations() {
    markerTravelQueue.forEach((route, pointId) => {
      const marker = markerRegistry.get(pointId);
      if (!marker) return;
      markerTravelQueue.delete(pointId);
      animateMarkerTravel(marker, route);
    });
  }

  function animateMarkerTravel(marker, route) {
    const fromLatLng = L.latLng(route.from.lat, route.from.lng);
    const toLatLng = L.latLng(route.to.lat, route.to.lng);
    const element = marker.getElement();
    if (marker.__cpAnimationFrame) {
      window.cancelAnimationFrame(marker.__cpAnimationFrame);
    }
    marker.setLatLng(fromLatLng);
    element?.classList.add("marker-running");

    const duration = 1600;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      marker.setLatLng([
        fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * eased,
        fromLatLng.lng + (toLatLng.lng - fromLatLng.lng) * eased,
      ]);
      if (progress < 1) {
        marker.__cpAnimationFrame = window.requestAnimationFrame(tick);
        return;
      }
      marker.setLatLng(toLatLng);
      marker.__cpAnimationFrame = 0;
      marker.getElement()?.classList.remove("marker-running");
    };

    marker.__cpAnimationFrame = window.requestAnimationFrame(tick);
  }

  function getMarkerSignature(point) {
    return [
      point.id,
      point.pointType,
      getPointDisplayName(point),
      point.status,
      point.lat,
      point.lng,
      point.isOwn ? "own" : "other",
      getPendingProposalState(point.id),
      point.productType,
      point.deliveryInterval,
      point.deliveryAvailability,
    ].join("|");
  }
  function getVisiblePoints() {
    const hasDeliveryFilters =
      Boolean(activeDeliveryProductFilter) ||
      Boolean(activeDeliveryIntervalFilter) ||
      activeDeliveryAvailabilityFilter !== "all";

    return state.points.filter((point) => {
      if (point.cityId !== state.cityId) return false;
      if (activeFilter === "delivery") {
        if (point.pointType !== "delivery") return false;
      } else if (activeFilter !== "all") {
        if (point.pointType !== "swap" || point.status !== activeFilter) return false;
      }

      if (point.pointType === "delivery") {
        if (activeDeliveryProductFilter && point.productType !== activeDeliveryProductFilter) return false;
        if (activeDeliveryIntervalFilter && point.deliveryInterval !== activeDeliveryIntervalFilter) return false;
        if (activeDeliveryAvailabilityFilter === "available" && point.deliveryAvailability !== "available") return false;
        if (
          activeDeliveryAvailabilityFilter === "reserved" &&
          !["reserved", "reserved_by_me"].includes(point.deliveryAvailability)
        ) {
          return false;
        }
      } else {
        if (hasDeliveryFilters) return false;
        if (activeLogisticCenterFilter && point.logisticCenter !== activeLogisticCenterFilter) return false;
      }
      return true;
    });
  }

  function getOwnPoint() {
    const own = state.points.find((point) => point.isOwn && point.pointType === "swap");
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
    if (point.pointType === "delivery") {
      return point.isOwn || point.deliveryDetailsVisible || point.deliveryReservedByMe ? point.name : "Заявка на доставку";
    }
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

  async function deletePoint(point = getOwnPoint()) {
    if (!point) return;
    const label = point.pointType === "delivery" ? "эту метку доставки" : "вашу активную точку";
    const confirmed = window.confirm(`Удалить ${label} с карты?`);
    if (!confirmed) return;

    try {
      await apiClient.deletePoint(point.id);
      if (point.pointType === "swap") {
        state.ownPointId = null;
      }
      pendingLatLng = null;
      moveMode = false;
      await loadRemoteState();
      closeSheet();
      showToast(point.pointType === "delivery" ? "Метка доставки удалена." : "Ваша точка удалена.");
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

  function buildDeliveryIntervals() {
    const values = [];
    for (let hour = 9; hour <= 21; hour += 2) {
      const nextHour = hour + 2;
      values.push(`${String(hour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`);
    }
    return values;
  }

  function getApproxDistanceMeters(fromLat, fromLng, toLat, toLng) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(toLat - fromLat);
    const dLng = toRad(toLng - fromLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
