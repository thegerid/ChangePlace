(() => {
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  window.CHANGEPLACE_CONFIG = {
    apiBaseUrl: isLocalHost ? "" : "https://backend.example.ru",
  };
})();
