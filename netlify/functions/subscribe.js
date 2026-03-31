import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { email, phone, name } = body;

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: 'Please enter an email address or phone number.' }), { status: 400, headers });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address.' }), { status: 400, headers });
    }

    let cleanPhone = null;
    if (phone) {
      cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '1' + cleanPhone;
      if (cleanPhone.length !== 11) {
        return new Response(JSON.stringify({ error: 'Invalid phone — enter a 10-digit Canadian number.' }), { status: 400, headers });
      }
      cleanPhone = '+' + cleanPhone;
    }

    const store = getStore({ name: 'subscribers', consistency: 'strong' });
    const key = email
      ? 'email_' + email.toLowerCase().replace(/[@.]/g, '_')
      : 'phone_' + cleanPhone.replace(/\+/g, '');

    try {
      const existing = await store.get(key);
      if (existing) {
        return new Response(JSON.stringify({ success: true, message: "You're already subscribed." }), { status: 200, headers });
      }
    } catch (e) { /* key doesn't exist */ }

    await store.set(key, JSON.stringify({
      email: email || null,
      phone: cleanPhone || null,
      name: name || null,
      subscribedAt: new Date().toISOString(),
      lastAlertLevel: 'watch',
    }));

    if (email && process.env.RESEND_API_KEY) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Dauphin Lake Watch <alerts@dauphinlakewatch.ca>',
            to: email,
            subject: "You're subscribed to Dauphin Lake Watch alerts",
            html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f0ebe1;font-family:system-ui,-apple-system,sans-serif;">
<div style="max-width:520px;margin:32px auto;padding:0 16px 32px;">

  <div style="background:#0d2137;padding:22px 26px;border-radius:6px 6px 0 0;">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,.45);text-transform:uppercase;margin-bottom:6px;font-family:monospace;">Dauphin Lake Watch</div>
    <div style="color:white;font-size:22px;font-weight:700;line-height:1.2;">You're subscribed to<br>flood alerts.</div>
  </div>

  <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:28px 26px;border-radius:0 0 6px 6px;">

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 18px;">
      Thanks for signing up. Spring melt is coming and having eyes on the lake early makes a real difference — that's exactly why this tool exists.
    </p>

    <div style="background:#fff8e6;border:1px solid #f0c040;border-radius:4px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#7a5500;">
      📬 <strong>One quick step:</strong> Add <strong>alerts@dauphinlakewatch.ca</strong> to your contacts or safe senders list so alerts don't land in junk when it matters most.
    </div>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 18px;">
      You'll hear from us when the lake crosses a meaningful threshold. Not noise — just the moments that matter.
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">
      In the meantime, check current conditions anytime at <a href="https://dauphinlakewatch.ca" style="color:#2c5f7c;font-weight:500;">dauphinlakewatch.ca</a>. The tributary panel is worth watching — when the Turtle River starts moving fast, the lake follows a few days later.
    </p>

    <div style="background:#f8f6f2;border-left:3px solid #2c5f7c;padding:14px 18px;border-radius:0 4px 4px 0;margin-bottom:24px;">
      <div style="font-size:11px;letter-spacing:2px;color:#6b7280;text-transform:uppercase;font-family:monospace;margin-bottom:10px;">Alert thresholds</div>
      <div style="font-size:13px;color:#374151;line-height:2;font-family:monospace;">
        <span style="color:#8b0000;">●</span> Flood Stage &nbsp;858.0+ ft — Active flooding<br>
        <span style="color:#8b0000;">●</span> Critical &nbsp;&nbsp; 857.0–858.0 ft — Approaching flood stage<br>
        <span style="color:#c47000;">●</span> High &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 856.5–857.0 ft — Road impacts possible<br>
        <span style="color:#b84c00;">●</span> Elevated &nbsp;&nbsp; 855.5–856.5 ft — Low-lying flooding possible<br>
        <span style="color:#c8a200;">●</span> Advisory &nbsp;&nbsp; 854.8–855.5 ft — Above operating range<br>
        <span style="color:#8a6500;">●</span> Watch &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 854.0–854.8 ft — Approaching operating range<br>
        <span style="color:#1a6b3a;">●</span> Normal &nbsp;&nbsp;&nbsp;&nbsp; Below 854.0 ft — Within normal range
      </div>
    </div>

    <a href="https://dauphinlakewatch.ca" style="display:block;background:#0d2137;color:white;text-align:center;padding:14px;border-radius:5px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">
      View Live Dashboard →
    </a>

    <p style="color:#9ca3af;font-size:12px;line-height:1.7;margin:0;padding-top:18px;border-top:1px solid #f3f4f6;">
      — iConnect Studio, care &amp; monitoring on behalf of the Dauphin Lake community<br><br>
      This is not an official government alert. For provincial flood guidance: <a href="https://manitoba.ca/floodinfo/" style="color:#6b7280;">manitoba.ca/floodinfo/</a><br>
      To unsubscribe, reply to this email with "unsubscribe".
    </p>

  </div>
</div>
</body>
</html>`
          })
        });
        const resendData = await resendRes.json();
        if (resendRes.ok) {
          console.log('Welcome email sent OK:', resendData.id);
        } else {
          console.error('Resend error:', JSON.stringify(resendData));
        }
      } catch (e) {
        console.error('Email fetch failed:', e.message);
      }
    } else {
      console.log('Resend skip — email:', !!email, 'key:', !!process.env.RESEND_API_KEY);
    }

    return new Response(JSON.stringify({
      success: true,
      message: email ? 'Subscribed! Check your email for confirmation.' : 'Subscribed! SMS alerts enabled.'
    }), { status: 200, headers });

  } catch (err) {
    console.error('Subscribe error:', err);
    return new Response(JSON.stringify({ error: 'Server error — please try again.' }), { status: 500, headers });
  }
};

export const config = { path: '/api/subscribe' };
