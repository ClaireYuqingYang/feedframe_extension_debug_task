// node test_feeds.js
const noaaUrl = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
const usgsUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';
const femaUrl = 'https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/feed';

async function test(name, fn) {
  try {
    const t0 = Date.now();
    const out = await fn();
    console.log(`✅ ${name} OK (${Date.now()-t0}ms)`, out);
  } catch (e) {
    console.log(`❌ ${name} FAIL`, e.message);
  }
}

(async () => {
  await test('NOAA', async () => {
    const r = await fetch(noaaUrl, {
      headers: {
        'User-Agent': 'FeedFrame/1.0 (contact: your-email@example.com)',
        'Accept': 'application/geo+json'
      }
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${txt.slice(0,200)}`);
    const j = JSON.parse(txt);
    return { count: j.features?.length || 0, sample: j.features?.[0]?.properties?.headline };
  });

  await test('USGS', async () => {
    const r = await fetch(usgsUrl);
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${txt.slice(0,200)}`);
    const j = JSON.parse(txt);
    return { count: j.features?.length || 0, sample: j.features?.[0]?.properties?.title };
  });

  await test('FEMA', async () => {
    const r = await fetch(femaUrl);
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${txt.slice(0,200)}`);
    const titles = [...txt.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).slice(0, 5);
    return { titleCount: titles.length, sample: titles[1] || titles[0] };
  });
})();
