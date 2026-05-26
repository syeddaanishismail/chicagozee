const restaurants = Array.isArray(window.RESTAURANTS) ? [...window.RESTAURANTS] : [];

const state = {
  query: "",
  alphabetical: true,
};

const gridView = document.getElementById("grid-view");
const template = document.getElementById("restaurant-card-template");
const resultsCopy = document.getElementById("results-copy");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const sortButton = document.getElementById("sort-button");
const mobileMenuButton = document.getElementById("mobile-menu-button");
const mobileNavMenu = document.getElementById("mobile-nav-menu");
const mobileNavLinks = Array.from(document.querySelectorAll(".mobile-nav-link"));
const resultsSection = document.querySelector(".results-section");
const mapCanvas = document.getElementById("map");
const areaFilter = document.getElementById("area-filter");
const statusFilter = document.getElementById("status-filter");
const filtersResetButton = document.getElementById("filters-reset-button");
const resultsFilters = document.querySelector(".results-filters");
const searchDockSlot = document.getElementById("search-dock-slot");

let leafletMap = null;
let leafletLayer = null;
let leafletMarkers = [];
let markerByKey = new Map();
let activeCard = null;

function searchText(restaurant) {
  return [restaurant.name, restaurant.subtitle, restaurant.address]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getSortedRestaurants(items) {
  const sorted = [...items];

  if (state.alphabetical) {
    sorted.sort((left, right) => left.name.localeCompare(right.name));
  }

  return sorted;
}

function getFilteredRestaurants() {
  const query = state.query.trim().toLowerCase();
  const areaValue = areaFilter ? areaFilter.value : "";
  const statusValue = statusFilter ? statusFilter.value : "";

  const filtered = restaurants.filter((restaurant) => {
    const matchesQuery = !query || searchText(restaurant).includes(query);
    const matchesArea = !areaValue || (restaurant.subtitle || "") === areaValue;
    const matchesStatus = !statusValue || (restaurant.badge || "Zabihah Halal") === statusValue;
    return matchesQuery && matchesArea && matchesStatus;
  });

  return getSortedRestaurants(filtered);
}

function renderEmptyState() {
  gridView.innerHTML = '<div class="empty-state">No restaurants match that search yet. Try a different restaurant name, street, or area.</div>';
}

function renderGrid() {
  const filtered = getFilteredRestaurants();

  resultsCopy.textContent = `Showing ${filtered.length} of ${restaurants.length} Chicago restaurants.`;
  gridView.innerHTML = "";

  if (!filtered.length) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach((restaurant, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const title = card.querySelector(".card-title");
    const subtitle = card.querySelector(".card-subtitle");
    const badge = card.querySelector(".card-badge");
    const credit = card.querySelector(".card-photo-credit");

    title.textContent = restaurant.name;
    subtitle.textContent = restaurant.subtitle || restaurant.address || "Chicago";
    badge.textContent = restaurant.badge || "Zabihah Halal";
    credit.remove();

    if (restaurant.badgeClass) {
      badge.classList.add(restaurant.badgeClass);
    }

    card.setAttribute("title", restaurant.address || restaurant.name);
    card.dataset.restaurantKey = `${restaurant.name}__${restaurant.address || ""}`;
    fragment.appendChild(card);
  });

  gridView.appendChild(fragment);
  attachCardMapInteractions();
}

function initMap() {
  if (!mapCanvas || typeof L === "undefined") {
    return;
  }

  if (!leafletMap) {
    leafletMap = L.map(mapCanvas, {
      zoomControl: true,
      scrollWheelZoom: false,
    });

    leafletLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(leafletMap);
  }

  leafletMarkers.forEach((marker) => marker.remove());
  leafletMarkers = [];
  markerByKey.clear();

  const withCoords = getFilteredRestaurants().filter(
    (restaurant) =>
      typeof restaurant.lat === "number" &&
      typeof restaurant.lng === "number" &&
      !Number.isNaN(restaurant.lat) &&
      !Number.isNaN(restaurant.lng)
  );
  const bounds = [];

  withCoords.forEach((restaurant) => {
    const marker = L.marker([restaurant.lat, restaurant.lng]).addTo(leafletMap);
    marker.bindPopup(`<strong>${restaurant.name}</strong><br>${restaurant.address || ""}`);
    leafletMarkers.push(marker);
    markerByKey.set(`${restaurant.name}__${restaurant.address || ""}`, marker);
    bounds.push([restaurant.lat, restaurant.lng]);
  });

  if (bounds.length) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
  } else {
    leafletMap.setView([41.8781, -87.6298], 11);
  }

  setTimeout(() => leafletMap.invalidateSize(), 0);
}

function attachCardMapInteractions() {
  const cards = Array.from(gridView.querySelectorAll(".restaurant-card"));

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const marker = markerByKey.get(card.dataset.restaurantKey);
      if (!marker || !leafletMap) {
        return;
      }

      if (activeCard) {
        activeCard.classList.remove("is-selected");
      }

      card.classList.add("is-selected");
      activeCard = card;

      const latLng = marker.getLatLng();
      leafletMap.flyTo(latLng, Math.max(leafletMap.getZoom(), 14), {
        duration: 0.55,
      });
      marker.openPopup();
    });
  });
}

function getUniqueValues(fieldAccessor) {
  return [...new Set(restaurants.map(fieldAccessor).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function populateFilters() {
  if (!areaFilter || !statusFilter) {
    return;
  }

  const areas = getUniqueValues((restaurant) => restaurant.subtitle);
  const statuses = getUniqueValues((restaurant) => restaurant.badge || "Zabihah Halal");

  areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    areaFilter.appendChild(option);
  });

  statuses.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    statusFilter.appendChild(option);
  });
}

function dockSearchBarIntoFilters() {
  if (!searchForm || !resultsFilters || !searchDockSlot) {
    return;
  }

  if (searchDockSlot.contains(searchForm)) {
    return;
  }

  const startRect = searchForm.getBoundingClientRect();

  searchInput.placeholder = "Search by keyword";
  searchDockSlot.appendChild(searchForm);
  document.body.classList.add("search-docked");

  const endRect = searchForm.getBoundingClientRect();
  const deltaX = startRect.left - endRect.left;
  const deltaY = startRect.top - endRect.top;
  const scaleX = startRect.width / endRect.width;
  const scaleY = startRect.height / endRect.height;

  searchForm.animate(
    [
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
        transformOrigin: "top left",
      },
      {
        transform: "translate(0, 0) scale(1, 1)",
        transformOrigin: "top left",
      },
    ],
    {
      duration: 520,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    }
  );
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value;
  dockSearchBarIntoFilters();
  renderGrid();
  initMap();
  if (resultsFilters) {
    const top = resultsFilters.getBoundingClientRect().top + window.pageYOffset - 110;
    window.scrollTo({ top, behavior: "smooth" });
  } else if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderGrid();
  initMap();
});

if (areaFilter) {
  areaFilter.addEventListener("change", () => {
    renderGrid();
    initMap();
  });
}

if (statusFilter) {
  statusFilter.addEventListener("change", () => {
    renderGrid();
    initMap();
  });
}

if (filtersResetButton) {
  filtersResetButton.addEventListener("click", () => {
    state.query = "";
    if (searchInput) {
      searchInput.value = "";
    }
    if (listSearchInput) {
      listSearchInput.value = "";
    }
    if (areaFilter) {
      areaFilter.value = "";
    }
    if (statusFilter) {
      statusFilter.value = "";
    }
    renderGrid();
    initMap();
  });
}

if (sortButton) {
  sortButton.addEventListener("click", () => {
    state.alphabetical = !state.alphabetical;
    sortButton.textContent = state.alphabetical ? "Sort by distance" : "Sorted A-Z";
    renderGrid();
  });
}

function closeMobileMenu() {
  if (!mobileMenuButton || !mobileNavMenu) {
    return;
  }

  mobileMenuButton.setAttribute("aria-expanded", "false");
  mobileNavMenu.classList.add("hidden");
}

if (mobileMenuButton && mobileNavMenu) {
  mobileMenuButton.addEventListener("click", () => {
    const isOpen = mobileMenuButton.getAttribute("aria-expanded") === "true";
    mobileMenuButton.setAttribute("aria-expanded", String(!isOpen));
    mobileNavMenu.classList.toggle("hidden", isOpen);
  });

  mobileNavLinks.forEach((link) => {
    link.addEventListener("click", closeMobileMenu);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1139) {
      closeMobileMenu();
    }
  });
}

document.body.classList.add("map-mode");
populateFilters();
renderGrid();
initMap();
