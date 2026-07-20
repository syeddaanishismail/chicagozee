(function () {
  document.documentElement.classList.add("is-native-app");

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (resource, options) {
    if (typeof resource === "string" && resource.startsWith("/api/")) {
      return originalFetch(`https://chicagozee.vercel.app${resource}`, options);
    }

    return originalFetch(resource, options);
  };
})();
