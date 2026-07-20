(function () {
  const loadingScreen = document.getElementById("app-loading-screen");
  const mapView = document.getElementById("map-view");
  const searchForm = document.getElementById("search-form");

  function refreshMapLayout() {
    [0, 80, 220, 500].forEach((delay) => {
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, delay);
    });
  }

  function scrollElementToTop(element, offset = 0) {
    if (!element) {
      return;
    }

    const top = element.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function scrollToMap() {
    refreshMapLayout();
    scrollElementToTop(mapView, 70);
    setTimeout(refreshMapLayout, 360);
  }

  function scrollToSuggest() {
    scrollElementToTop(document.getElementById("suggest"), 8);
  }

  function scrollToNativeTabTarget(hash) {
    if (hash === "#home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (hash === "#search") {
      scrollElementToTop(searchForm, 110);
      return;
    }

    if (hash === "#map-view") {
      scrollToMap();
      return;
    }

    if (hash === "#suggest") {
      scrollToSuggest();
    }
  }

  function hideLoadingScreen() {
    if (!loadingScreen) {
      return;
    }

    loadingScreen.classList.add("is-hidden");
    setTimeout(() => {
      loadingScreen.remove();
    }, 520);
  }

  document.querySelectorAll(".native-tab-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToNativeTabTarget(link.getAttribute("href"));
    });
  });

  document.querySelectorAll('a[href="#map-view"]').forEach((link) => {
    link.addEventListener("click", refreshMapLayout);
  });

  const gridView = document.getElementById("grid-view");
  if (gridView) {
    gridView.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) {
        return;
      }

      const card = event.target.closest(".restaurant-card");
      if (!card) {
        return;
      }

      setTimeout(scrollToMap, 80);
    });
  }

  window.addEventListener("load", () => {
    setTimeout(hideLoadingScreen, 650);
    refreshMapLayout();
  });

  setTimeout(hideLoadingScreen, 1800);
})();
