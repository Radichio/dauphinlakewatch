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
            from: 'Dauphin Lake Watch <alerts@send.dauphinlakewatch.ca>',
            to: email,
            subject: "You're subscribed to Dauphin Lake Watch alerts",
            html: '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;"><div style="background:#0d2137;padding:20px;border-radius:6px 6px 0 0;"><h1 style="color:white;font-size:18px;margin:0;">DAUPHIN LAKE WATCH</h1></div><div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 6px 6px;"><p>You\'re now subscribed to flood alerts. You\'ll be notified when the lake crosses a key threshold.</p><p style="margin-top:16px;">Check current conditions: <a href="https://dauphinlakewatch.ca">dauphinlakewatch.ca</a></p><p style="color:#9ca3af;font-size:12px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">iConnect Studio — Independent Community Hydrological Research & Advisory. Reply "unsubscribe" to opt out.</p></div></div>'
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
