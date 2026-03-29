// Netlify Edge Function — injects live OG meta tags for rich social sharing
// Runs at the edge before HTML is served to crawlers and users

export default async (request, context) => {
  // Only intercept the root path
  const url = new URL(request.url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    return context.next();
  }

  // Fetch live lake level from Water Survey of Canada
  let level = null;
  let status = 'WATCH';
  let statusNote = 'Spring melt commencing. Check current conditions.';

  try {
    const apiUrl = 'https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05LJ009&sortby=-DATETIME&limit=2&f=json';
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const feature = data?.features?.find(f => f?.properties?.LEVEL != null);
      if (feature) {
        const metres = feature.properties.LEVEL;
        const ft = metres * 3.28084;
        level = ft.toFixed(2);

        // Determine status
        if      (ft >= 858.0) { status = 'FLOOD STAGE';  statusNote = 'At or above flood stage. Follow provincial emergency guidance.'; }
        else if (ft >= 857.0) { status = 'CRITICAL';     statusNote = 'Approaching flood stage. Full sandbagging underway.'; }
        else if (ft >= 856.5) { status = 'HIGH';         statusNote = 'Road impacts possible. Active property protection underway.'; }
        else if (ft >= 855.5) { status = 'ELEVATED';     statusNote = 'Low-lying flooding possible. Sandbag low points now.'; }
        else if (ft >= 854.8) { status = 'ADVISORY';     statusNote = 'Above operating range. Confirm sandbag supply is ready.'; }
        else if (ft >= 854.0) { status = 'WATCH';        statusNote = 'Approaching upper operating range. Spring melt commencing.'; }
        else                  { status = 'NORMAL';       statusNote = 'Within normal operating range. Monitoring continues.'; }
      }
    }
  } catch (e) {
    // Fall through to defaults
  }

  const levelStr  = level ? `${level} ft` : 'Live Monitoring';
  const title     = `Dauphin Lake Watch — ${levelStr} · ${status}`;
  const desc      = `${statusNote} · Normal range: 853–854.8 ft · Flood stage: 858 ft · Updated ${new Date().toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/Winnipeg'})} CDT`;
  const imageUrl  = 'https://dauphinlakewatch.ca/share-image.png';
  const siteUrl   = 'https://dauphinlakewatch.ca/#status';

  // Get the original response
  const response = await context.next();
  const html = await response.text();

  // Inject OG tags into <head>
  const ogTags = `
  <!-- Open Graph / Social Sharing -->
  <meta property="og:type"        content="website" />
  <meta property="og:url"         content="${siteUrl}" />
  <meta property="og:title"       content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image"       content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height"content="630" />
  <meta property="og:site_name"   content="Dauphin Lake Watch" />
  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image"       content="${imageUrl}" />
  <!-- General -->
  <meta name="description" content="${desc}" />`;

  const modified = html.replace('</head>', `${ogTags}\n</head>`);

  return new Response(modified, {
    headers: {
      ...Object.fromEntries(response.headers),
      'content-type': 'text/html; charset=utf-8',
    },
    status: response.status,
  });
};

export const config = { path: '/' };
