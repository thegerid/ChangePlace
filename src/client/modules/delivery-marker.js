(function (global) {
  "use strict";

  const DELIVERY_MARKER_ZOOM_MODES = {
    full: "full",
    product: "product",
    dot: "dot",
  };

  function formatShortDeliveryInterval(value) {
    const match = String(value || "").match(/^(\d{2}):\d{2}-(\d{2}):\d{2}$/);
    if (!match) return String(value || "");
    return `${Number(match[1])}-${Number(match[2])}`;
  }

  function getDeliveryMarkerMode(map) {
    if (!map) return DELIVERY_MARKER_ZOOM_MODES.full;
    const zoom = map.getZoom();
    if (zoom >= 14) return DELIVERY_MARKER_ZOOM_MODES.full;
    if (zoom >= 11) return DELIVERY_MARKER_ZOOM_MODES.product;
    return DELIVERY_MARKER_ZOOM_MODES.dot;
  }

  function syncDeliveryMarkerMode(marker, mode) {
    const element = marker?.getElement?.();
    if (!element) return;
    element.classList.remove(
      "delivery-marker--full",
      "delivery-marker--product",
      "delivery-marker--dot",
      "delivery-marker--mode-transition",
    );
    element.classList.add(`delivery-marker--${mode}`);
    global.requestAnimationFrame(() => {
      element.classList.add("delivery-marker--mode-transition");
    });
  }

  function createDeliveryIcon(options) {
    const {
      L,
      point,
      mode,
      escapeHtml,
      isOwnClassName = "delivery-marker-own",
      reservedClassName = "delivery-marker-reserved",
      introClassName = "marker-intro",
      intro = false,
    } = options;
    const ownClass = point.isOwn ? isOwnClassName : "";
    const introClass = intro ? introClassName : "";
    const reservedClass = point.deliveryAvailability === "available" ? "" : reservedClassName;
    return L.divIcon({
      html: `
        <span class="delivery-marker__pin" aria-hidden="true"></span>
        <span class="delivery-marker__body">
          <span class="delivery-marker__product">${escapeHtml(point.productType || "Доставка")}</span>
          <span class="delivery-marker__separator" aria-hidden="true">·</span>
          <span class="delivery-marker__interval">${escapeHtml(formatShortDeliveryInterval(point.deliveryInterval))}</span>
        </span>
      `,
      className: `delivery-marker delivery-marker--${mode} ${ownClass} ${introClass} ${reservedClass}`,
      iconSize: [108, 42],
      iconAnchor: [54, 42],
    });
  }

  global.ChangePlaceModules = global.ChangePlaceModules || {};
  global.ChangePlaceModules.deliveryMarker = {
    createDeliveryIcon,
    formatShortDeliveryInterval,
    getDeliveryMarkerMode,
    syncDeliveryMarkerMode,
    DELIVERY_MARKER_ZOOM_MODES,
  };
})(window);
