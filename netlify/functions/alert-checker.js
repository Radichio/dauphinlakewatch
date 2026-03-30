// Netlify Scheduled Function — runs every 30 minutes
// Fetches lake level, checks thresholds, sends alerts if crossed

import { getStore } from '@netlify/blobs';

const STATION = '05LJ009';
const API_URL = `https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=${STATION}&sortby=-DATETIME&limit=2&f=json`;
const M_TO_FT = 3.28084;

const THRESHOLDS = [
  { key: 'flood',    ft: 858.0, label: 'Flood Stage',  note: 'At or above flood stage. Follow Manitoba provincial emergency guidance at manitoba.ca/floodinfo/' },
  { key: 'critical', ft: 857.0, label: 'Critical',     note: 'Approaching flood stage. Full sandbagging recommended. Coordinate with RM of Ochre River.' },
  { key: 'high',     ft: 856.5, label: 'High',         note: 'Road impacts possible. Active property protection recommended.' },
  { key: 'elevated', ft: 855.5, label: 'Elevated',     note: 'Low-lying flooding possible. Sandbag vulnerable low points.' },
  { key: 'advisory', ft: 854.8, label: 'Advisory',     note: 'Above operating range. Confirm sandbag supply is ready.' },
  { key: 'watch',    ft: 854.0, label: 'Watch',        note: 'Approaching upper operating range. Spring melt is underway — good time to prepare.' },
  { key: 'normal',   ft: 0,     label: 'Normal',       note: 'Lake within normal operating range.' },
];

function getStatus(ft) {
  for (const t of THRESHOLDS) {
    if (ft >= t.ft) return t;
  }
  return THRESHOLDS[THRESHOLDS.length - 1];
}

export default async () => {
  console.log('[alert-checker] Running at', new Date().toISOString());

  // 1. Fetch current lake level
  let levelFt = null;
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const feature = data?.features?.find(f => f?.properties?.LEVEL != null);
    if (feature) {
      levelFt = feature.properties.LEVEL * M_TO_FT;
    }
  } catch (err) {
    console.error('[alert-checker] API fetch failed:', err.message);
    return;
  }

  if (!levelFt) {
    console.log('[alert-checker] No level data returned');
    return;
  }

  const currentStatus = getStatus(levelFt);
  console.log(`[alert-checker] Level: ${levelFt.toFixed(3)} ft — Status: ${currentStatus.label}`);

  // 2. Get all subscribers
  const store = getStore('subscribers');
  const { blobs } = await store.list();

  if (!blobs || blobs.length === 0) {
    console.log('[alert-checker] No subscribers');
    return;
  }

  // 3. Check each subscriber and send if threshold crossed
  let emailsSent = 0;
  let smsSent = 0;

  for (const blob of blobs) {
    try {
      const sub = await store.get(blob.key, { type: 'json' });
      if (!sub) continue;

      const lastStatus = sub.lastAlertLevel || 'normal';

      // Only alert on status change — specifically going UP
      // Don't spam on the way down (lake falling is good news — one notification)
      const statusOrder = ['normal','watch','advisory','elevated','high','critical','flood'];
      const currentIdx = statusOrder.indexOf(currentStatus.key);
      const lastIdx    = statusOrder.indexOf(lastStatus);

      const shouldAlert = currentIdx !== lastIdx && (
        currentIdx > lastIdx ||                    // level rising — always alert
        (lastIdx > 2 && currentIdx < lastIdx)      // significant drop — one alert
      );

      if (!shouldAlert) continue;

      const levelStr = levelFt.toFixed(2);
      const isRising = currentIdx > lastIdx;
      const direction = isRising ? '↑ Rising' : '↓ Falling';

      // Send email
      if (sub.email && process.env.RESEND_API_KEY) {
        const subject = `Dauphin Lake Watch — ${levelStr} ft · ${currentStatus.label}`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Dauphin Lake Watch <alerts@dauphinlakewatch.ca>',
            to: sub.email,
            subject,
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
                <div style="background:#0d2137;padding:20px 24px;border-radius:6px 6px 0 0;">
                  <h1 style="color:white;font-size:20px;margin:0;letter-spacing:1px;">DAUPHIN LAKE WATCH</h1>
                  <p style="color:rgba(255,255,255,.55);font-size:12px;margin:4px 0 0;font-family:monospace;">FLOOD ALERT — ${new Date().toLocaleDateString('en-CA',{month:'long',day:'numeric',year:'numeric',timeZone:'America/Winnipeg'})}</p>
                </div>
                <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 6px 6px;">
                  <div style="text-align:center;padding:20px 0;border-bottom:1px solid #f3f4f6;margin-bottom:20px;">
                    <div style="font-size:56px;font-weight:800;color:#1c1c2e;line-height:1;">${levelStr}</div>
                    <div style="font-family:monospace;font-size:11px;color:#9ca3af;margin:4px 0 12px;">FEET ABOVE SEA LEVEL · WSC PROVISIONAL</div>
                    <div style="display:inline-block;background:#fff1e8;color:#b84c00;font-weight:700;padding:6px 16px;border-radius:4px;font-size:14px;letter-spacing:1px;">${currentStatus.label.toUpperCase()}</div>
                    <div style="font-family:monospace;font-size:12px;color:#6b7280;margin-top:8px;">${direction} · Previously: ${lastStatus.toUpperCase()}</div>
                  </div>
                  <p style="color:#374151;line-height:1.6;font-size:15px;">${currentStatus.note}</p>
                  <div style="margin:20px 0;">
                    <a href="https://dauphinlakewatch.ca" style="display:block;background:#0d2137;color:white;text-align:center;padding:14px;border-radius:5px;text-decoration:none;font-weight:600;font-size:15px;">View Live Dashboard →</a>
                  </div>
                  <div style="background:#f9fafb;border-radius:4px;padding:12px;font-size:13px;color:#6b7280;line-height:1.6;">
                    Normal operating range: 853.0–854.8 ft &nbsp;·&nbsp; Flood stage: 858.0 ft<br>
                    For official provincial guidance: <a href="https://manitoba.ca/floodinfo/" style="color:#2c5f7c;">manitoba.ca/floodinfo/</a>
                  </div>
                  <p style="color:#9ca3af;font-size:12px;margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;">
                    iConnect Studio — Independent Community Hydrological Research & Advisory<br>
                    This is not an official government alert. To unsubscribe, reply "unsubscribe".
                  </p>
                </div>
              </div>
            `
          })
        });
        emailsSent++;
      }

      // Send SMS via Twilio
      if (sub.phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const smsBody = `Dauphin Lake Watch\n${levelStr} ft · ${currentStatus.label}\n${currentStatus.note}\ndauphinlakewatch.ca`;
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: process.env.TWILIO_FROM_NUMBER,
            To:   sub.phone,
            Body: smsBody,
          })
        });
        smsSent++;
      }

      // Update subscriber's last alert state
      await store.setJSON(blob.key, {
        ...sub,
        lastAlertSent:  new Date().toISOString(),
        lastAlertLevel: currentStatus.key,
      });

    } catch (err) {
      console.error(`[alert-checker] Error processing subscriber ${blob.key}:`, err.message);
    }
  }

  console.log(`[alert-checker] Done — ${emailsSent} emails, ${smsSent} SMS sent`);
};

export const config = {
  schedule: '*/30 * * * *'  // every 30 minutes
};
