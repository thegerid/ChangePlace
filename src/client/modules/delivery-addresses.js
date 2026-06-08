(function (global) {
  "use strict";

  function renderDeliveryAddressField(value, index, options = {}) {
    const isEdit = Boolean(options.isEdit);
    const escapeAttr = options.escapeAttr || ((input) => String(input ?? ""));
    const escapeHtml = options.escapeHtml || ((input) => String(input ?? ""));
    const intervals = Array.isArray(options.intervals) ? options.intervals : [];
    const canRemove = !isEdit && index > 0;
    const row = typeof value === "object" && value ? value : { address: value || "", interval: "" };
    return `
      <div class="address-item" data-address-item="${index}">
        <div class="address-item__row">
          <input
            name="deliveryAddress"
            autocomplete="off"
            placeholder="Скопируйте адрес из карточки заявки в Go"
            value="${escapeAttr(row.address || "")}"
          />
          <select name="deliveryIntervalRow" aria-label="Интервал доставки">
            <option value="">Интервал</option>
            ${intervals
              .map(
                (item) =>
                  `<option value="${escapeAttr(item)}" ${row.interval === item ? "selected" : ""}>${escapeHtml(item)}</option>`,
              )
              .join("")}
          </select>
          ${
            canRemove
              ? '<button class="icon-button address-remove" type="button" data-remove-address aria-label="Удалить адрес">×</button>'
              : ""
          }
        </div>
      </div>
    `;
  }

  function bindDeliveryAddressEditor(form, options = {}) {
    const isEdit = Boolean(options.isEdit);
    const clearFieldError = options.clearFieldError || (() => {});
    const escapeAttr = options.escapeAttr || ((input) => String(input ?? ""));
    const escapeHtml = options.escapeHtml || ((input) => String(input ?? ""));
    const intervals = Array.isArray(options.intervals) ? options.intervals : [];
    const list = form.querySelector("#deliveryAddressList");
    const addButton = form.querySelector("#addDeliveryAddress");
    if (!list) return;

    const bindInputHandlers = () => {
      list.querySelectorAll('input[name="deliveryAddress"], select[name="deliveryIntervalRow"]').forEach((input) => {
        input.addEventListener("input", () => clearFieldError(input));
        input.addEventListener("change", () => clearFieldError(input));
      });
    };

    const getRows = () =>
      Array.from(list.querySelectorAll(".address-item")).map((item) => ({
        address: item.querySelector('input[name="deliveryAddress"]')?.value || "",
        interval: item.querySelector('select[name="deliveryIntervalRow"]')?.value || "",
      }));

    const rebuild = (values) => {
      list.innerHTML = values
        .map((value, index) => renderDeliveryAddressField(value, index, { isEdit, escapeAttr, escapeHtml, intervals }))
        .join("");
      bindInputHandlers();
    };

    bindInputHandlers();

    addButton?.addEventListener("click", () => {
      const values = getRows();
      values.push({ address: "", interval: "" });
      rebuild(values);
      list.querySelector('.address-item:last-child input[name="deliveryAddress"]')?.focus();
    });

    list.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-address]");
      if (!removeButton) return;
      const values = getRows();
      if (values.length <= 1) return;
      const currentItem = removeButton.closest(".address-item");
      const itemIndex = Number(currentItem?.dataset.addressItem);
      if (!Number.isInteger(itemIndex)) return;
      values.splice(itemIndex, 1);
      rebuild(values.length ? values : [{ address: "", interval: "" }]);
      clearFieldError(list.querySelector('input[name="deliveryAddress"]'));
    });
  }

  global.ChangePlaceModules = global.ChangePlaceModules || {};
  global.ChangePlaceModules.deliveryAddresses = {
    bindDeliveryAddressEditor,
    renderDeliveryAddressField,
  };
})(window);
