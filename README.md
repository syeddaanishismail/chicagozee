# ChicagoZee

ChicagoZee is a Chicagoland halal restaurant discovery website. It helps users search and explore halal restaurants by name, area, cuisine, halal status, and map location.

## Features

- Keyword search for restaurant names, neighborhoods, streets, foods, and cuisines
- Area and halal-status filters
- Interactive Leaflet map with restaurant markers
- Certification and evidence badges for halal status
- Halal source links for restaurants that are not HMS/HFSAA verified
- "Suggest a Spot" form for visitor submissions
- AI-powered Ask search for natural-language queries
- Optional Brave Search menu checks for food and cuisine searches
- Mobile-responsive layout with custom branding and favicon

## Tech Stack

- HTML, CSS, and vanilla JavaScript
- Leaflet and OpenStreetMap tiles for mapping
- Vercel Serverless Functions for the AI search API
- Gemini API for natural-language restaurant matching
- Brave Search API for optional menu evidence checks

## Project Structure

```text
.
├── api/
│   └── restaurant-search.js
├── assets/
│   ├── background.mp4
│   ├── favicon.png
│   └── logo.png
├── app.js
├── index.html
├── restaurants.js
├── styles.css
└── .env.example
```

## Local Setup

Clone the repository, then create a local environment file:

```bash
cp .env.example .env.local
```

Add your local API keys to `.env.local`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
BRAVE_SEARCH_API_KEY=your_brave_search_api_key_here
BRAVE_MONTHLY_REQUEST_LIMIT=900
AI_MONTHLY_REQUEST_LIMIT=1000
```

Run the site locally with Vercel:

```bash
npx vercel dev
```

Then open:

```text
http://localhost:3000
```

## Environment Variables

Required for AI Ask search:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `AI_MONTHLY_REQUEST_LIMIT`

Optional for menu evidence checks:

- `BRAVE_SEARCH_API_KEY`
- `BRAVE_MONTHLY_REQUEST_LIMIT`

Optional for persistent monthly usage counters:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Do not commit `.env`, `.env.local`, `config.js`, or `.vercel`.

## Deployment

The project is deployed on Vercel. Add the same environment variables in the Vercel dashboard under:

```text
Project Settings -> Environment Variables
```

After updating environment variables, redeploy the site so the serverless function receives the new values.

## Notes

ChicagoZee is an informational directory. Halal status may change, so users should verify directly with the restaurant before ordering.

The background video is credited in the website UI:

```text
Background video by Ricky Esquivel via Pexels
```
