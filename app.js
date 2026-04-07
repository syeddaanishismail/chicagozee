const restaurants = Array.isArray(window.RESTAURANTS) ? [...window.RESTAURANTS] : [];

const state = {
  query: "",
  grid: true,
  alphabetical: true,
};

const gridView = document.getElementById("grid-view");
const mapView = document.getElementById("map-view");
const template = document.getElementById("restaurant-card-template");
const resultsCopy = document.getElementById("results-copy");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const sortButton = document.getElementById("sort-button");
const gridViewButton = document.getElementById("grid-view-button");
const mapViewButton = document.getElementById("map-view-button");

const fallbackImages = ["assets/card-1.png", "assets/card-2.png", "assets/card-3.png"];

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
  const filtered = restaurants.filter((restaurant) => !query || searchText(restaurant).includes(query));
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
    const image = card.querySelector(".card-image");
    const title = card.querySelector(".card-title");
    const subtitle = card.querySelector(".card-subtitle");
    const badge = card.querySelector(".card-badge");
    const credit = card.querySelector(".card-photo-credit");

    image.src = restaurant.image || fallbackImages[index % fallbackImages.length];
    image.alt = restaurant.imageAlt || `${restaurant.name} preview`;
    title.textContent = restaurant.name;
    subtitle.textContent = restaurant.subtitle || restaurant.address || "Chicago";
    badge.textContent = restaurant.badge || "Zabihah Halal";
    credit.remove();

    if (restaurant.badgeClass) {
      badge.classList.add(restaurant.badgeClass);
    }

    card.setAttribute("title", restaurant.address || restaurant.name);
    fragment.appendChild(card);
  });

  gridView.appendChild(fragment);
}

function setView(gridMode) {
  state.grid = gridMode;
  gridView.classList.toggle("hidden", !gridMode);
  mapView.classList.toggle("hidden", gridMode);
  mapView.setAttribute("aria-hidden", String(gridMode));
  gridViewButton.classList.toggle("is-active", gridMode);
  mapViewButton.classList.toggle("is-active", !gridMode);
  gridViewButton.setAttribute("aria-selected", String(gridMode));
  mapViewButton.setAttribute("aria-selected", String(!gridMode));
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value;
  renderGrid();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderGrid();
});

sortButton.addEventListener("click", () => {
  state.alphabetical = !state.alphabetical;
  sortButton.textContent = state.alphabetical ? "Sort by distance" : "Sorted A-Z";
  renderGrid();
});

gridViewButton.addEventListener("click", () => setView(true));
mapViewButton.addEventListener("click", () => setView(false));

setView(true);
renderGrid();
