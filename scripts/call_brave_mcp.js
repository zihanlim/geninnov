// scripts/call_brave_mcp.js
// Usage: node scripts/call_brave_mcp.js "<query>" "<date_from>"
//
// Calls the Brave News Search API if BRAVE_SEARCH_API_KEY is set.
// Exits 1 (non-zero) if the key is missing or the request fails — the Python
// caller (scripts/daily_refresh.py) treats non-zero as "use the Python-side
// mock fallback", so this script never silently fabricates data when the
// API is unavailable.
//
// buildParams/mapResults are exported for frontend/tests/unit/brave-freshness.test.ts;
// the CLI runs only under `require.main === module`, so requiring this file in a
// test performs no request and needs no key.
const https = require('https');

/**
 * Query string for the news endpoint.
 *
 * The lookback goes out as `freshness=<from>to<today>` — the parameter the API
 * documents — and NOT as `from=<date>`, which is not a Brave parameter at all.
 * Brave ignores unknown parameters without erroring, so the `from` this script
 * sent until 2026-07-28 turned every fetch into an unfiltered relevance search:
 * the 2026-07-28 run persisted 43 pre-2026 headlines (oldest 2001-11-16),
 * evergreen explainers outranking the week's actual news.
 */
function buildParams(query, dateFrom, today) {
  return new URLSearchParams({
    q: query,
    count: '50',   // max news results — denser attention signal (ADR-0028 root cause)
    ...(dateFrom ? { freshness: `${dateFrom}to${today}` } : {}),
  });
}

/**
 * Brave results → the {headline, date, url} shape the Python side persists.
 *
 * Brave returns `page_age` as an ISO timestamp ("2026-07-08T00:00:00") and
 * `age` as a relative string ("2 weeks ago"). Use the ISO date so the Python
 * side can bucket mentions by day (HypeScore volume + momentum depend on
 * per-day counts); relative strings broke that.
 *
 * An unparseable or missing age maps to date: null — NOT to today. The ribbon
 * sorts by published_date desc, so stamping unknown-age pages with today's
 * date showed them FIRST, presented as today's news. Null is persisted as NULL
 * and excluded from the per-day mention buckets: unknown stays unknown.
 */
function mapResults(results) {
  return (results || []).map((item) => {
    const iso = (item.page_age || '').slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
    return { headline: item.title, date, url: item.url };
  });
}

module.exports = { buildParams, mapResults };

if (require.main === module) {
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

  const today = new Date().toISOString().split('T')[0];
  const params = buildParams(query, dateFrom, today);
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
          console.log(JSON.stringify(mapResults(data.results)));
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
}
