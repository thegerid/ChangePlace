(function (global) {
  "use strict";

  function initScrollableRows(root) {
    (root || document).querySelectorAll(".scroll-row").forEach((element) => {
      if (element.dataset.dragScrollReady === "true") return;
      element.dataset.dragScrollReady = "true";

      let pointerId = null;
      let startX = 0;
      let startScrollLeft = 0;
      let dragged = false;
      let velocity = 0;
      let lastClientX = 0;
      let lastMoveTime = 0;
      let inertiaFrame = 0;

      const stopInertia = () => {
        if (!inertiaFrame) return;
        global.cancelAnimationFrame(inertiaFrame);
        inertiaFrame = 0;
      };

      const startInertia = () => {
        stopInertia();
        if (Math.abs(velocity) < 0.01) return;
        const tick = () => {
          element.scrollLeft -= velocity * 18;
          velocity *= 0.92;
          if (Math.abs(velocity) < 0.01) {
            inertiaFrame = 0;
            return;
          }
          inertiaFrame = global.requestAnimationFrame(tick);
        };
        inertiaFrame = global.requestAnimationFrame(tick);
      };

      element.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        stopInertia();
        pointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = element.scrollLeft;
        lastClientX = event.clientX;
        lastMoveTime = performance.now();
        velocity = 0;
        dragged = false;
        element.classList.add("is-dragging");
        element.setPointerCapture?.(pointerId);
      });

      element.addEventListener("pointermove", (event) => {
        if (pointerId !== event.pointerId) return;
        const now = performance.now();
        const delta = event.clientX - startX;
        if (Math.abs(delta) > 4) dragged = true;
        element.scrollLeft = startScrollLeft - delta;

        const elapsed = Math.max(now - lastMoveTime, 1);
        velocity = (event.clientX - lastClientX) / elapsed;
        lastClientX = event.clientX;
        lastMoveTime = now;
      });

      const release = (event) => {
        if (pointerId !== event.pointerId) return;
        pointerId = null;
        element.classList.remove("is-dragging");
        element.releasePointerCapture?.(event.pointerId);
        startInertia();
      };

      element.addEventListener("pointerup", release);
      element.addEventListener("pointercancel", release);
      element.addEventListener(
        "wheel",
        (event) => {
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
          if (!delta) return;
          event.preventDefault();
          stopInertia();
          element.scrollBy({
            left: delta,
            behavior: "smooth",
          });
        },
        { passive: false },
      );
      element.addEventListener("click", (event) => {
        if (!dragged) return;
        event.preventDefault();
        event.stopPropagation();
        dragged = false;
      });
    });
  }

  global.ChangePlaceModules = global.ChangePlaceModules || {};
  global.ChangePlaceModules.scrollRow = {
    initScrollableRows,
  };
})(window);
