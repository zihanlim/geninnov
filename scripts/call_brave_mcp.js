// scripts/call_brave_mcp.js
// Usage: node scripts/call_brave_mcp.js "<query>" "<date_from>"
//
// Calls the Brave News Search API if BRAVE_SEARCH_API_KEY is set.
// Exits 1 (non-zero) if the key is missing or the request fails — the Python
// caller (scripts/daily_refresh.py) treats non-zero as "use the Python-side
// mock fallback", so this script never silently fabricates data when the
// API is unavailable.
const https = require('https');

const query = process.argv[2];
const dateFrom = process.argv[3];
const apiKey = process.env.BRAVE_SEARCH_API_KEY;

if (!query) {
  console.error("Missing query argument");
  process.exit(1);
}
if (!apiKey) {
  console.error("BRAVE_SEARCH_API_KEY not set; signaling Python fallback");
  process.exit(1);
}

const params = new URLSearchParams({
  q: query,
  count: '50',   // max news results — denser attention signal (ADR-0028 root cause)
  ...(dateFrom ? { from: dateFrom } : {}),
});

const url = `https://api.search.brave.com/res/v1/news/search?${params.toString()}`;

const req = https.get(
  url,
  {
    headers: {
      'X-Subscription-Token': apiKey,
      'Accept': 'application/json',
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error(`Brave API returned status ${res.statusCode}: ${body.slice(0, 200)}`);
        process.exit(1);
      }
      try {
        const data = JSON.parse(body);
        const today = new Date().toISOString().split('T')[0];
        const results = (data.results || []).map((item) => {
          // Brave returns `page_age` as an ISO timestamp ("2026-07-08T00:00:00")
          // and `age` as a relative string ("2 weeks ago"). Use the ISO date so
          // the Python side can bucket mentions by day (HypeScore volume +
          // momentum depend on per-day counts); relative strings broke that.
          const iso = (item.page_age || '').slice(0, 10);
          const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : today;
          return { headline: item.title, date, url: item.url };
        });
        console.log(JSON.stringify(results));
      } catch (err) {
        console.error(`Failed to parse Brave response: ${err.message}`);
        process.exit(1);
      }
    });
  }
);

req.on('error', (err) => {
  console.error(`Brave request failed: ${err.message}`);
  process.exit(1);
});

req.setTimeout(25000, () => {
  console.error('Brave request timed out');
  req.destroy();
  process.exit(1);
});
