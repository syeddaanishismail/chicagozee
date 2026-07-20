const restaurants = Array.isArray(window.RESTAURANTS) ? [...window.RESTAURANTS] : [];

const state = {
  query: "",
  alphabetical: true,
  searchSuggestion: null,
  aiSearch: null,
};

const gridView = document.getElementById("grid-view");
const template = document.getElementById("restaurant-card-template");
const resultsCopy = document.getElementById("results-copy");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const askSearchButton = searchForm ? searchForm.querySelector(".ask-search-button") : null;
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
const suggestForm = document.getElementById("suggest-form");
const suggestStatus = document.getElementById("suggest-status");

let leafletMap = null;
let leafletLayer = null;
let leafletMarkers = [];
let markerByKey = new Map();
let activeCard = null;

function getRestaurantKey(restaurant) {
  return `${restaurant.name}__${restaurant.address || ""}`;
}

function clearAiSearch() {
  state.aiSearch = null;
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "around",
  "by",
  "do",
  "does",
  "food",
  "for",
  "halal",
  "in",
  "me",
  "near",
  "of",
  "open",
  "restaurant",
  "restaurants",
  "spot",
  "spots",
  "the",
  "to",
  "with",
]);

const SEARCH_ALIASES = {
  afghan: ["afghan", "afghani", "kabob", "kebab", "bamyan"],
  arabic: ["arabic", "arab", "middle", "eastern", "mediterranean", "shawarma", "mandi", "kabob"],
  burger: ["burger", "burgers", "smash", "slider", "sliders", "fries", "philly", "phillies"],
  chinese: ["chinese", "indo", "hakka", "noodle", "noodles"],
  pizza: ["pizza", "pizzeria", "slice", "slices"],
  wings: ["wing", "wings", "chicken", "broast", "broasted", "buckets"],
  steak: ["steak", "steakhouse", "wagyu"],
  kabob: ["kabob", "kabobs", "kabab", "kababs", "kebab", "kebabs", "grill", "grilled"],
  shawarma: ["shawarma", "gyro", "gyros", "pita"],
  biryani: ["biryani", "hyderabadi"],
  indian: ["indian", "hyderabadi", "biryani", "tandoori", "curry", "dosa"],
  pakistani: ["pakistani", "nihari", "karahi", "tabaq", "bbq", "biryani", "hyderabadi"],
  mediterranean: ["mediterranean", "middle", "eastern", "arabic", "arab", "falafel", "hummus", "shawarma", "pita", "kabob"],
  breakfast: ["breakfast", "brunch", "chai", "cafe"],
  mandi: ["mandi", "yemeni", "yemen", "hadramout"],
  somali: ["somali", "safari"],
  tacos: ["taco", "tacos"],
  mexican: ["mexican", "taco", "tacos", "burrito", "burritos", "quesadilla", "quesadillas"],
  turkish: ["turkish", "turkey", "doner", "kebab", "tostini"],
  dessert: ["dessert", "desserts", "sweets", "bakery", "cafe"],
};

const FALLBACK_SEARCHES = [
  "mediterranean",
  "pakistani",
  "indian",
  "burger",
  "wings",
  "pizza",
  "kabob",
  "shawarma",
  "mexican"
];

const AI_INTENT_TERMS = [
  "affordable",
  "ambience",
  "anniversary",
  "best",
  "casual",
  "celebration",
  "date",
  "dinner",
  "dining",
  "fancy",
  "family",
  "friendly",
  "group",
  "late",
  "luxury",
  "night",
  "nice",
  "occasion",
  "popular",
  "quick",
  "quiet",
  "romantic",
  "upscale",
  "vibe",
];

const aiSearchCache = new Map();
const AI_CACHE_STORAGE_PREFIX = `chicagozee-ai-search-v2-${restaurants.length}`;
const AI_USER_REQUEST_LIMIT = 3;
const AI_USER_USAGE_STORAGE_KEY = "chicagozee-ai-user-usage-v1";
let fallbackAiUsageCount = 0;

function formatSourceLabel(sourceName) {
  const value = String(sourceName || "web").trim();
  if (!value) {
    return "Source";
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)} source`;
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(term) {
  if (term.length > 4 && term.endsWith("ies")) {
    return `${term.slice(0, -3)}y`;
  }
  if (term.length > 3 && term.endsWith("s")) {
    return term.slice(0, -1);
  }
  return term;
}

function getSearchTokens(value) {
  return normalizeSearchValue(value)
    .split(" ")
    .map(singularize)
    .filter((token) => token && !SEARCH_STOP_WORDS.has(token));
}

function getAliasTerms(token) {
  const normalized = singularize(token);
  const matchedEntry = Object.entries(SEARCH_ALIASES).find(([category, aliases]) => {
    return category === normalized || aliases.map(singularize).includes(normalized);
  });

  if (!matchedEntry) {
    return [normalized];
  }

  return [...new Set([matchedEntry[0], ...matchedEntry[1]].map(singularize))];
}

function getRestaurantSearchHaystack(restaurant) {
  return normalizeSearchValue(
    [
      restaurant.name,
      restaurant.subtitle,
      restaurant.address,
      restaurant.badge,
      ...(Array.isArray(restaurant.searchKeywords) ? restaurant.searchKeywords : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function textContainsTerm(text, term) {
  const normalized = singularize(term);
  return text.includes(normalized) || text.includes(`${normalized}s`);
}

function restaurantMatchesQuery(restaurant, query) {
  const tokens = getSearchTokens(query);
  if (!tokens.length) {
    return true;
  }

  const haystack = getRestaurantSearchHaystack(restaurant);
  return tokens.every((token) => getAliasTerms(token).some((term) => textContainsTerm(haystack, term)));
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function getSuggestionTerms() {
  return [
    ...new Set(
      Object.entries(SEARCH_ALIASES).flatMap(([category, aliases]) => [category, ...aliases])
    ),
  ];
}

function getAvailableFallbackSearches(limit = 3) {
  return FALLBACK_SEARCHES.filter((term) =>
    restaurants.some((restaurant) => restaurantMatchesQuery(restaurant, term))
  ).slice(0, limit);
}

function getClosestSearchSuggestion(query, allowLoose = false) {
  const tokens = getSearchTokens(query);
  if (!tokens.length) {
    return null;
  }

  const suggestionTerms = getSuggestionTerms();
  let best = null;
  let looseBest = null;

  tokens.forEach((token) => {
    suggestionTerms.forEach((term) => {
      if (token[0] !== term[0]) {
        return;
      }
      const distance = levenshteinDistance(token, term);
      const maxDistance = Math.max(1, Math.floor(Math.max(token.length, term.length) * 0.34));
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { term, distance };
      }
      if (!looseBest || distance < looseBest.distance) {
        looseBest = { term, distance };
      }
    });
  });

  if (best) {
    return best.term;
  }

  return allowLoose && looseBest ? looseBest.term : null;
}

function getActiveFilterKey() {
  return JSON.stringify({
    area: areaFilter ? areaFilter.value : "",
    status: statusFilter ? statusFilter.value : "",
  });
}

function getAiCacheKey(query) {
  return `${normalizeSearchValue(query)}::${getActiveFilterKey()}`;
}

function getStoredAiResult(cacheKey) {
  try {
    const stored = window.localStorage.getItem(`${AI_CACHE_STORAGE_PREFIX}:${cacheKey}`);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    return null;
  }
}

function storeAiResult(cacheKey, data) {
  try {
    window.localStorage.setItem(`${AI_CACHE_STORAGE_PREFIX}:${cacheKey}`, JSON.stringify(data));
  } catch (error) {
    // Search still works if browser storage is unavailable.
  }
}

function getAiUsageCount() {
  try {
    const stored = window.localStorage.getItem(AI_USER_USAGE_STORAGE_KEY);
    const parsed = Number(stored || "0");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch (error) {
    return fallbackAiUsageCount;
  }
}

function setAiUsageCount(count) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  fallbackAiUsageCount = safeCount;
  try {
    window.localStorage.setItem(AI_USER_USAGE_STORAGE_KEY, String(safeCount));
  } catch (error) {
    // Keep an in-memory fallback for browsers that block storage.
  }
}

function hasAiUsesRemaining() {
  return getAiUsageCount() < AI_USER_REQUEST_LIMIT;
}

function incrementAiUsageCount() {
  const nextCount = Math.min(AI_USER_REQUEST_LIMIT, getAiUsageCount() + 1);
  setAiUsageCount(nextCount);
  return nextCount;
}

function showAiLimitMessage(query) {
  state.aiSearch = {
    loading: false,
    summary: `AI search limit reached. Each user can use Ask up to ${AI_USER_REQUEST_LIMIT} times, so showing local search results for "${query}" instead.`,
    restaurantKeys: null,
    reasonByKey: new Map(),
  };
  state.searchSuggestion = null;
  renderGrid();
  initMap();
}

function isAiWorthyQuery(query) {
  const tokens = getSearchTokens(query);
  if (!tokens.length) {
    return false;
  }

  const localMatches = getLocallyFilteredRestaurants();
  const hasIntentTerm = tokens.some((token) => AI_INTENT_TERMS.includes(token));
  const hasDirectAlias = tokens.some((token) =>
    Object.entries(SEARCH_ALIASES).some(([category, aliases]) => {
      const terms = [category, ...aliases].map(singularize);
      return terms.includes(token);
    })
  );

  return hasIntentTerm || !localMatches.length || (!hasDirectAlias && tokens.length > 1 && localMatches.length < 4);
}

function applyAiSearchData(data, cleanQuery) {
  const reasonByKey = new Map();
  const restaurantKeys = Array.isArray(data.matches)
    ? data.matches
        .map((match) => {
          const restaurant = restaurants[Number(match.id)];
          if (!restaurant) {
            return "";
          }
          const key = getRestaurantKey(restaurant);
          if (match.reason) {
            reasonByKey.set(key, match.reason);
          }
          return key;
        })
        .filter(Boolean)
    : [];

  return {
    loading: false,
    summary:
      data.summary ||
      (restaurantKeys.length
        ? `AI found ${restaurantKeys.length} matching restaurants for "${cleanQuery}".`
        : `AI could not find a match for "${cleanQuery}".`),
    restaurantKeys,
    reasonByKey,
  };
}

function searchText(restaurant) {
  return [restaurant.name, restaurant.subtitle, restaurant.address, ...(restaurant.searchKeywords || [])]
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

function getLocallyFilteredRestaurants() {
  const query = state.query.trim().toLowerCase();
  const areaValue = areaFilter ? areaFilter.value : "";
  const statusValue = statusFilter ? statusFilter.value : "";

  state.searchSuggestion = null;

  let filtered = restaurants.filter((restaurant) => {
    const matchesQuery = !query || restaurantMatchesQuery(restaurant, query);
    const matchesArea = !areaValue || (restaurant.subtitle || "") === areaValue;
    const matchesStatus = !statusValue || (restaurant.badge || "Zabihah Halal") === statusValue;
    return matchesQuery && matchesArea && matchesStatus;
  });

  if (!filtered.length && query) {
    const suggestion = getClosestSearchSuggestion(query);
    if (suggestion) {
      state.searchSuggestion = suggestion;
      filtered = restaurants.filter((restaurant) => {
        const matchesSuggestion = restaurantMatchesQuery(restaurant, suggestion);
        const matchesArea = !areaValue || (restaurant.subtitle || "") === areaValue;
        const matchesStatus = !statusValue || (restaurant.badge || "Zabihah Halal") === statusValue;
        return matchesSuggestion && matchesArea && matchesStatus;
      });
    }
  }

  return getSortedRestaurants(filtered);
}

function getFilteredRestaurants() {
  if (state.aiSearch && Array.isArray(state.aiSearch.restaurantKeys)) {
    const allowedKeys = new Set(state.aiSearch.restaurantKeys);
    return restaurants.filter((restaurant) => allowedKeys.has(getRestaurantKey(restaurant)));
  }

  return getLocallyFilteredRestaurants();
}

function renderEmptyState() {
  const suggestion = getClosestSearchSuggestion(state.query);
  const fallbackTerms = getAvailableFallbackSearches();
  const suggestionText = suggestion
    ? ` Closest available search: "${suggestion}".`
    : fallbackTerms.length
      ? ` Try one of: ${fallbackTerms.map((term) => `"${term}"`).join(", ")}.`
      : "";
  gridView.innerHTML = `<div class="empty-state">No restaurants match that search yet.${suggestionText} Try a different restaurant name, food, street, or area.</div>`;
}

function appendHalalEvidence(card, restaurant) {
  const evidence = Array.isArray(restaurant.halalEvidence) ? restaurant.halalEvidence : [];
  if (!evidence.length) {
    return;
  }

  const body = card.querySelector(".card-body");
  const evidenceWrap = document.createElement("div");
  evidenceWrap.className = "card-evidence";

  const heading = document.createElement("p");
  heading.className = "card-evidence-title";
  heading.textContent = "Halal source";
  evidenceWrap.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "card-evidence-list";

  evidence.forEach((item) => {
    const url = String(item.url || "").trim();
    if (!url) {
      return;
    }

    const listItem = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = formatSourceLabel(item.sourceName);
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  if (!list.children.length) {
    return;
  }

  evidenceWrap.appendChild(list);
  body.appendChild(evidenceWrap);
}

function appendAiReason(card, restaurant) {
  if (!state.aiSearch || !state.aiSearch.reasonByKey) {
    return;
  }

  const reason = state.aiSearch.reasonByKey.get(getRestaurantKey(restaurant));
  if (!reason) {
    return;
  }

  const body = card.querySelector(".card-body");
  const reasonEl = document.createElement("p");
  reasonEl.className = "card-ai-reason";
  reasonEl.textContent = `AI match: ${reason}`;
  body.appendChild(reasonEl);
}

function renderGrid() {
  const filtered = getFilteredRestaurants();

  resultsCopy.textContent = state.aiSearch && state.aiSearch.loading
    ? `AI is analyzing "${state.query}"...`
    : state.aiSearch && state.aiSearch.summary
      ? state.aiSearch.summary
    : state.searchSuggestion
    ? `No exact matches for "${state.query}". Showing closest match: "${state.searchSuggestion}" (${filtered.length} restaurants).`
    : state.query && !filtered.length
      ? `No matches for "${state.query}".`
    : `Showing ${filtered.length} of ${restaurants.length} Chicago restaurants.`;
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

    appendHalalEvidence(card, restaurant);
    appendAiReason(card, restaurant);

    card.setAttribute("title", restaurant.address || restaurant.name);
    card.dataset.restaurantKey = getRestaurantKey(restaurant);
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
    markerByKey.set(getRestaurantKey(restaurant), marker);
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
  if (document.documentElement.classList.contains("is-native-app")) {
    return;
  }

  if (!searchForm || !resultsFilters || !searchDockSlot) {
    return;
  }

  if (searchDockSlot.contains(searchForm)) {
    return;
  }

  const startRect = searchForm.getBoundingClientRect();

  searchInput.placeholder = "Search";
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

function scrollToResults() {
  if (resultsFilters) {
    const top = resultsFilters.getBoundingClientRect().top + window.pageYOffset - 110;
    window.scrollTo({ top, behavior: "smooth" });
  } else if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scrollToSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) {
    return;
  }

  const top = target.getBoundingClientRect().top + window.pageYOffset - 110;
  window.scrollTo({ top, behavior: "smooth" });
}

function setSearchButtonLoading(isLoading) {
  if (!askSearchButton) {
    return;
  }
  askSearchButton.disabled = isLoading;
  askSearchButton.innerHTML = isLoading
    ? '<span class="ask-search-icon" aria-hidden="true">✧</span><span class="ask-search-label">Ask...</span>'
    : '<span class="ask-search-icon" aria-hidden="true">✧</span><span class="ask-search-label">Ask</span>';
}

async function runAiSearch(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    clearAiSearch();
    renderGrid();
    initMap();
    return;
  }

  const cacheKey = getAiCacheKey(cleanQuery);
  const cached = aiSearchCache.get(cacheKey);
  if (cached) {
    state.aiSearch = cached;
    renderGrid();
    initMap();
    return;
  }

  const stored = getStoredAiResult(cacheKey);
  if (stored) {
    state.aiSearch = applyAiSearchData(stored, cleanQuery);
    aiSearchCache.set(cacheKey, state.aiSearch);
    renderGrid();
    initMap();
    return;
  }

  if (!hasAiUsesRemaining()) {
    showAiLimitMessage(cleanQuery);
    return;
  }

  incrementAiUsageCount();

  state.aiSearch = {
    loading: true,
    summary: "",
    restaurantKeys: null,
    reasonByKey: new Map(),
  };
  setSearchButtonLoading(true);
  renderGrid();
  initMap();

  try {
    const response = await fetch("/api/restaurant-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: cleanQuery,
        area: areaFilter ? areaFilter.value : "",
        status: statusFilter ? statusFilter.value : "",
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI search failed.");
    }

    state.aiSearch = applyAiSearchData(data, cleanQuery);
    aiSearchCache.set(cacheKey, state.aiSearch);
    storeAiResult(cacheKey, data);
  } catch (error) {
    state.aiSearch = {
      loading: false,
      summary: error.message || "AI search is unavailable right now, so showing local search results.",
      restaurantKeys: null,
      reasonByKey: new Map(),
    };
    state.searchSuggestion = null;
  } finally {
    setSearchButtonLoading(false);
    renderGrid();
    initMap();
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value;
  dockSearchBarIntoFilters();
  scrollToResults();
  clearAiSearch();
  renderGrid();
  initMap();
});

if (askSearchButton) {
  askSearchButton.addEventListener("click", async () => {
    state.query = searchInput.value;
    dockSearchBarIntoFilters();
    scrollToResults();
    clearAiSearch();
    await runAiSearch(state.query);
  });
}

searchInput.addEventListener("input", () => {
  clearAiSearch();
  state.query = searchInput.value;
  renderGrid();
  initMap();
});

if (areaFilter) {
  areaFilter.addEventListener("change", () => {
    clearAiSearch();
    renderGrid();
    initMap();
  });
}

if (statusFilter) {
  statusFilter.addEventListener("change", () => {
    clearAiSearch();
    renderGrid();
    initMap();
  });
}

if (filtersResetButton) {
  filtersResetButton.addEventListener("click", () => {
    clearAiSearch();
    state.query = "";
    if (searchInput) {
      searchInput.value = "";
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

function getSuggestionEmail() {
  const configuredEmail = window.CHICAGOZEE_CONFIG && window.CHICAGOZEE_CONFIG.suggestionEmail;
  return configuredEmail || "syeddaanishismail@gmail.com";
}

function getSuggestionBody(data) {
  return [
    "New ChicagoZee spot suggestion",
    "",
    `Spot name: ${data.get("spotName")}`,
    `Address or neighborhood: ${data.get("location")}`,
    `Halal info: ${data.get("halalInfo")}`,
    `Submitter contact: ${data.get("contact") || "Not provided"}`,
    "",
    "Notes:",
    data.get("notes") || "Not provided",
  ].join("\n");
}

function setSuggestionStatus(message, tone = "") {
  if (!suggestStatus) {
    return;
  }

  suggestStatus.textContent = message;
  suggestStatus.classList.toggle("is-success", tone === "success");
  suggestStatus.classList.toggle("is-error", tone === "error");
}

function getSuggestionPayload(data) {
  return {
    _subject: `ChicagoZee spot suggestion: ${data.get("spotName")}`,
    _template: "table",
    _captcha: "false",
    "Spot name": data.get("spotName"),
    "Address or neighborhood": data.get("location"),
    "Halal info": data.get("halalInfo"),
    "Submitter contact": data.get("contact") || "Not provided",
    Notes: data.get("notes") || "Not provided",
    "Halal confirmation": "This spot serves halal food or has halal options.",
    Message: getSuggestionBody(data),
  };
}

document.querySelectorAll('a[href="#about"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    closeMobileMenu();
    scrollToSection("about");
  });
});

if (suggestForm) {
  suggestForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!suggestForm.reportValidity()) {
      return;
    }

    const data = new FormData(suggestForm);
    const honeypot = String(data.get("website") || "").trim();
    if (honeypot) {
      suggestForm.reset();
      setSuggestionStatus("Thanks. The suggestion was sent.", "success");
      return;
    }

    const recipient = getSuggestionEmail();
    const submitButton = suggestForm.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }
    setSuggestionStatus("Sending your suggestion...", "");

    try {
      const response = await fetch(`https://formsubmit.co/ajax/${recipient}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(getSuggestionPayload(data)),
      });

      if (!response.ok) {
        throw new Error("Suggestion request failed");
      }

      suggestForm.reset();
      setSuggestionStatus("Thanks. The suggestion was sent.", "success");
    } catch (error) {
      setSuggestionStatus(
        "Something went wrong. Please try again in a moment.",
        "error"
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Send Suggestion";
      }
    }
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
