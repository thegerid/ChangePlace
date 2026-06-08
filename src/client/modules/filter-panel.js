(function (global) {
  "use strict";

  function createFilterPanelController(options = {}) {
    const root = options.root || null;
    const toggleButton = options.toggleButton || null;
    const panel = options.panel || null;
    if (!root || !toggleButton || !panel) {
      return {
        isOpen: () => false,
        open() {},
        close() {},
        toggle() {},
      };
    }

    let open = false;

    const applyState = () => {
      root.classList.toggle("is-open", open);
      toggleButton.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
    };

    const close = () => {
      if (!open) return;
      open = false;
      applyState();
      root.dispatchEvent(new CustomEvent("changeplace:filters-panel-close"));
    };

    const openPanel = () => {
      if (open) return;
      open = true;
      applyState();
    };

    const toggle = () => {
      open ? close() : openPanel();
    };

    toggleButton.addEventListener("click", toggle);
    document.addEventListener("click", (event) => {
      if (!open) return;
      if (root.contains(event.target)) return;
      close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      close();
    });

    applyState();

    return {
      isOpen: () => open,
      open: openPanel,
      close,
      toggle,
    };
  }

  function createFilterSelectController(options = {}) {
    const root = options.root || document;
    const selects = Array.from(options.selects || root.querySelectorAll(".filter-select select"));
    const controllers = selects.map(createFilterSelect).filter(Boolean);

    const closeAll = (except = null) => {
      controllers.forEach((controller) => {
        if (controller !== except) controller.close();
      });
    };

    const sync = () => {
      controllers.forEach((controller) => controller.sync());
    };

    document.addEventListener("click", (event) => {
      if (root.contains(event.target)) return;
      closeAll();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeAll();
    });
    root.addEventListener("changeplace:filters-panel-close", () => {
      closeAll();
    });

    return {
      close: closeAll,
      sync,
    };
  }

  function createFilterSelect(select) {
    const field = select.closest(".filter-select");
    if (!field || select.dataset.customFilterSelect === "true") return null;

    select.dataset.customFilterSelect = "true";
    select.classList.add("filter-select__native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const label = field.querySelector("span")?.textContent?.trim() || select.getAttribute("aria-label") || "";
    const listId = `filter-select-list-${Math.random().toString(36).slice(2)}`;
    const value = document.createElement("span");
    const button = document.createElement("button");
    const menu = document.createElement("div");
    let open = false;
    let activeIndex = Math.max(select.selectedIndex, 0);
    let observerScheduled = false;

    value.className = "filter-select__value";
    button.className = "filter-select__button";
    button.type = "button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", listId);
    if (label) button.setAttribute("aria-label", label);

    menu.className = "filter-select__menu";
    menu.id = listId;
    menu.hidden = true;
    menu.setAttribute("role", "listbox");

    button.append(value);
    field.append(button, menu);

    const getOptions = () => Array.from(select.options).filter((option) => !option.disabled);

    const setOpen = (nextOpen) => {
      open = nextOpen;
      field.classList.toggle("is-select-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
      menu.hidden = !open;
      if (open) {
        sync();
        scrollActiveOptionIntoView();
      }
    };

    const setActiveIndex = (nextIndex) => {
      const options = getOptions();
      if (!options.length) return;
      activeIndex = Math.max(0, Math.min(nextIndex, options.length - 1));
      Array.from(menu.children).forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
      });
      scrollActiveOptionIntoView();
    };

    const commit = (index) => {
      const options = getOptions();
      const option = options[index];
      if (!option) return;
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
      setOpen(false);
      button.focus();
    };

    function sync() {
      const options = getOptions();
      const selectedOption = select.selectedOptions[0] || options[0] || null;
      const selectedIndex = Math.max(
        options.findIndex((option) => option === selectedOption),
        0,
      );

      activeIndex = selectedIndex;
      value.textContent = selectedOption?.textContent || "";
      button.disabled = select.disabled || !options.length || field.hidden;
      menu.innerHTML = "";

      options.forEach((option, index) => {
        const item = document.createElement("button");
        item.className = "filter-select__option";
        item.type = "button";
        item.textContent = option.textContent;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", option === selectedOption ? "true" : "false");
        item.classList.toggle("is-selected", option === selectedOption);
        item.classList.toggle("is-active", index === activeIndex);
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          commit(index);
        });
        menu.append(item);
      });
    }

    function scrollActiveOptionIntoView() {
      const activeItem = menu.children[activeIndex];
      if (!activeItem) return;
      activeItem.scrollIntoView({ block: "nearest" });
    }

    const scheduleObserverSync = () => {
      if (observerScheduled) return;
      observerScheduled = true;
      window.queueMicrotask(() => {
        observerScheduled = false;
        sync();
      });
    };

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent("changeplace:filter-select-open", { detail: { controller } }));
      setOpen(!open);
    });

    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex(activeIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex(activeIndex - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (open) {
          commit(activeIndex);
        } else {
          setOpen(true);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    });

    field.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    select.addEventListener("change", sync);

    if (window.MutationObserver) {
      const observer = new MutationObserver(scheduleObserverSync);
      observer.observe(select, { childList: true, subtree: true, attributes: true });
    }

    const controller = {
      close: () => setOpen(false),
      sync,
    };

    document.addEventListener("changeplace:filter-select-open", (event) => {
      if (event.detail?.controller === controller) return;
      setOpen(false);
    });

    sync();
    return controller;
  }

  global.ChangePlaceModules = global.ChangePlaceModules || {};
  global.ChangePlaceModules.filterPanel = {
    createFilterPanelController,
    createFilterSelectController,
  };
})(window);
