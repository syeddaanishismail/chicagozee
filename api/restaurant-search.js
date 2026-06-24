const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const BRAVE_SEARCH_API_BASE = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 24;
const MENU_SEARCH_CANDIDATE_LIMIT = 5;
const MENU_SEARCH_RESULT_LIMIT = 4;
const CACHE_LIMIT = 100;
const DEFAULT_MONTHLY_AI_REQUEST_LIMIT = 1000;
const DEFAULT_MONTHLY_BRAVE_REQUEST_LIMIT = 900;

let cachedRestaurants = null;
const aiResponseCache = new Map();
const monthlyUsageFallback = new Map();
let localEnvLoaded = false;

function loadLocalEnv() {
  if (localEnvLoaded) {
    return;
  }

  localEnvLoaded = true;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function loadRestaurants() {
  if (cachedRestaurants) {
    return cachedRestaurants;
  }

  const filePath = path.join(process.cwd(), "restaurants.js");
  const source = fs.readFileSync(filePath, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "restaurants.js" });
  cachedRestaurants = Array.isArray(context.window.RESTAURANTS) ? context.window.RESTAURANTS : [];
  return cachedRestaurants;
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeForSearch(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MENU_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "best", "food", "foods", "halal", "in", "me",
  "near", "now", "open", "restaurant", "restaurants", "spot", "spots",
  "the", "to",
]);

const FOOD_MENU_HINT_TERMS = new Set([
  "afghan", "arabic", "bbq", "biryani", "breakfast", "brunch", "burger",
  "burgers", "chicken", "chinese", "curry", "dessert", "falafel", "fries",
  "gyro", "gyros", "hummus", "indian", "kabob", "kabab", "kebab",
  "karahi", "mandi", "mediterranean", "mexican", "nihari", "noodles",
  "pakistani", "pizza", "rice", "sandwich", "sandwiches", "shawarma",
  "steak", "taco", "tacos", "thai", "turkish", "wings",
]);

function getMenuQueryTokens(query) {
  return normalizeForSearch(query)
    .split(" ")
    .filter((token) => token.length > 2 && !MENU_QUERY_STOP_WORDS.has(token));
}

function shouldSearchMenus(query, aiResult) {
  if (aiResult && aiResult.menuSearchRecommended === true) {
    return true;
  }

  const tokens = getMenuQueryTokens(query);
  return tokens.some((token) => FOOD_MENU_HINT_TERMS.has(token));
}

function getBraveApiKey() {
  return process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || "";
}

function stripHtml(value) {
  return normalize(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function itemMentionsRestaurant(item, restaurant) {
  const restaurantName = normalizeForSearch(restaurant.name);
  if (!restaurantName) {
    return false;
  }

  const text = normalizeForSearch([item.title, item.description, item.url].filter(Boolean).join(" "));
  const importantNameParts = restaurantName
    .split(" ")
    .filter((part) => part.length > 2 && !["restaurant", "and", "the"].includes(part));

  return importantNameParts.length ? importantNameParts.every((part) => text.includes(part)) : text.includes(restaurantName);
}

function itemMatchesMenuQuery(item, query) {
  const tokens = getMenuQueryTokens(query);
  if (!tokens.length) {
    return false;
  }

  const text = normalizeForSearch([item.title, item.description, item.url].filter(Boolean).join(" "));
  return tokens.some((token) => text.includes(token));
}

async function searchMenuEvidence({ restaurant, query }) {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    return [];
  }

  const monthlyBraveCount = await incrementMonthlyUsage("brave-menu-search");
  if (monthlyBraveCount > getMonthlyBraveLimit()) {
    return [];
  }

  const searchQuery = [restaurant.name, restaurant.address, "menu", query].filter(Boolean).join(" ");
  const url = new URL(BRAVE_SEARCH_API_BASE);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("count", String(MENU_SEARCH_RESULT_LIMIT));
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("country", "US");

  const searchResponse = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!searchResponse.ok) {
    return [];
  }

  const data = await searchResponse.json().catch(() => ({}));
  const results = data.web && Array.isArray(data.web.results) ? data.web.results : [];
  return results
    .map((item) => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      url: normalize(item.url),
    }))
    .filter((item) => item.url && itemMentionsRestaurant(item, restaurant) && itemMatchesMenuQuery(item, query))
    .slice(0, 2);
}

async function addMenuEvidenceToMatches({ query, restaurants, matches, aiResult }) {
  if (!shouldSearchMenus(query, aiResult) || !getBraveApiKey() || !matches.length) {
    return { matches, menuSearchUsed: false };
  }

  const checkedMatches = [];
  const candidates = matches.slice(0, MENU_SEARCH_CANDIDATE_LIMIT);

  for (const match of candidates) {
    const restaurant = restaurants[match.id];
    if (!restaurant) {
      continue;
    }

    const menuEvidence = await searchMenuEvidence({ restaurant, query });
    if (!menuEvidence.length) {
      continue;
    }

    const source = menuEvidence[0];
    const menuReason = `Menu evidence: ${source.title || source.url}`;
    checkedMatches.push({
      ...match,
      reason: `${match.reason ? `${match.reason} ` : ""}${menuReason}`.slice(0, 180),
      menuEvidence,
    });
  }

  return {
    matches: checkedMatches.length ? checkedMatches : matches,
    menuSearchUsed: true,
  };
}
function compactRestaurant(restaurant, index) {
  return {
    id: index,
    name: normalize(restaurant.name),
    area: normalize(restaurant.subtitle),
    address: normalize(restaurant.address),
    status: normalize(restaurant.badge),
    keywords: Array.isArray(restaurant.searchKeywords)
      ? restaurant.searchKeywords.map(normalize).filter(Boolean).slice(0, 8)
      : [],
  };
}

function filterRestaurants(restaurants, area, status) {
  return restaurants
    .map((restaurant, index) => ({ restaurant, index }))
    .filter(({ restaurant }) => {
      const matchesArea = !area || restaurant.subtitle === area;
      const matchesStatus = !status || (restaurant.badge || "Zabihah Halal") === status;
      return matchesArea && matchesStatus;
    });
}

function extractJson(content) {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function getCacheKey({ query, area, status }) {
  return JSON.stringify({
    query: query.toLowerCase().replace(/\s+/g, " ").trim(),
    area,
    status,
  });
}

function cacheResponse(key, payload) {
  if (aiResponseCache.size >= CACHE_LIMIT) {
    const oldestKey = aiResponseCache.keys().next().value;
    aiResponseCache.delete(oldestKey);
  }
  aiResponseCache.set(key, payload);
}

function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function getMonthlyLimit() {
  const configured = Number(process.env.AI_MONTHLY_REQUEST_LIMIT || "");
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MONTHLY_AI_REQUEST_LIMIT;
}

function getMonthlyBraveLimit() {
  const configured = Number(process.env.BRAVE_MONTHLY_REQUEST_LIMIT || "");
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MONTHLY_BRAVE_REQUEST_LIMIT;
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function incrementMonthlyUsage(counterName = "ai-search") {
  const monthKey = getMonthKey();
  const usageKey = `chicagozee:${counterName}:${monthKey}`;
  const kv = getKvConfig();

  if (!kv) {
    const fallbackKey = `${counterName}:${monthKey}`;
    const nextCount = (monthlyUsageFallback.get(fallbackKey) || 0) + 1;
    monthlyUsageFallback.set(fallbackKey, nextCount);
    return nextCount;
  }

  const response = await fetch(`${kv.url}/incr/${encodeURIComponent(usageKey)}`, {
    headers: {
      Authorization: `Bearer ${kv.token}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  const count = Number(data.result || 0);

  if (count === 1) {
    await fetch(`${kv.url}/expire/${encodeURIComponent(usageKey)}/2678400`, {
      headers: {
        Authorization: `Bearer ${kv.token}`,
      },
    }).catch(() => {});
  }

  return count;
}

async function callGemini({ query, candidates }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: [
            "You are ChicagoZee's restaurant search assistant.",
            "Rank only restaurants from the provided JSON list.",
            "Never invent restaurants, addresses, IDs, or halal claims.",
            "A user may ask for vibe, cuisine, dish type, occasion, neighborhood, or quality.",
            "If the user is asking for a food, dish, or cuisine type that should be checked against menus, set menuSearchRecommended to true.",
            "If the exact request is not represented, return the closest existing restaurants and set fallbackUsed to true.",
            "Keep summary under 110 characters so it fits in a compact results header.",
            "Keep each reason under 110 characters.",
            "Return JSON only with this shape:",
            '{"summary":"short user-facing sentence","fallbackUsed":false,"suggestedQuery":"","menuSearchRecommended":false,"matches":[{"id":0,"reason":"short reason based only on provided data"}]}',
            `Return at most ${MAX_RESULTS} matches.`,
            ].join(" "),
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({
            query,
            restaurants: candidates,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : "Gemini request failed.");
  }

  const content = data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0]
    ? data.candidates[0].content.parts[0].text
    : "";
  return extractJson(content);
}

module.exports = async function handler(request, response) {
  loadLocalEnv();

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const query = normalize(body.query);
    const area = normalize(body.area);
    const status = normalize(body.status);

    if (!query) {
      sendJson(response, 400, { error: "Search query is required." });
      return;
    }

    const cacheKey = getCacheKey({ query, area, status });
    const cached = aiResponseCache.get(cacheKey);
    if (cached) {
      sendJson(response, 200, {
        ...cached,
        cached: true,
      });
      return;
    }

    const monthlyCount = await incrementMonthlyUsage();
    const monthlyLimit = getMonthlyLimit();
    if (monthlyCount > monthlyLimit) {
      sendJson(response, 429, {
        error: "Monthly AI search limit reached. Showing local search results instead.",
        monthlyLimit,
      });
      return;
    }

    const restaurants = loadRestaurants();
    const scoped = filterRestaurants(restaurants, area, status);
    const candidates = scoped.map(({ restaurant, index }) => compactRestaurant(restaurant, index));
    const allowedIds = new Set(candidates.map((restaurant) => restaurant.id));

    if (!candidates.length) {
      const payload = {
        query,
        summary: "No restaurants match the selected filters.",
        fallbackUsed: false,
        suggestedQuery: "",
        matches: [],
        cached: false,
      };
      cacheResponse(cacheKey, payload);
      sendJson(response, 200, payload);
      return;
    }

    const aiResult = await callGemini({ query, candidates });
    const initialMatches = Array.isArray(aiResult && aiResult.matches)
      ? aiResult.matches
          .filter((match) => allowedIds.has(Number(match.id)))
          .slice(0, MAX_RESULTS)
          .map((match) => ({
            id: Number(match.id),
            reason: normalize(match.reason).slice(0, 180),
          }))
      : [];

    const menuChecked = await addMenuEvidenceToMatches({
      query,
      restaurants,
      matches: initialMatches,
      aiResult,
    });

    const payload = {
      query,
      summary: menuChecked.menuSearchUsed && menuChecked.matches.length
        ? `AI checked menu results and found ${menuChecked.matches.length} likely matches.`
        : normalize(aiResult && aiResult.summary) || `AI found ${menuChecked.matches.length} matching restaurants.`,
      fallbackUsed: Boolean(aiResult && aiResult.fallbackUsed),
      suggestedQuery: normalize(aiResult && aiResult.suggestedQuery),
      menuSearchUsed: menuChecked.menuSearchUsed,
      matches: menuChecked.matches,
      cached: false,
    };
    cacheResponse(cacheKey, payload);
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "AI search failed.",
    });
  }
};
