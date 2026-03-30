// Netlify Function — handles email/phone subscription
// POST /api/subscribe { email, phone, name }

import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { email, phone, name } = body;

  if (!email && !phone) {
    return new Response(JSON.stringify({ error: 'Email or phone required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate email format
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate phone — strip non-digits, must be 10-11 digits
  let cleanPhone = null;
  if (phone) {
    cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '1' + cleanPhone;
    if (cleanPhone.length !== 11) {
      return new Response(JSON.stringify({ error: 'Invalid phone number — enter a 10-digit Canadian number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    cleanPhone = '+' + cleanPhone;
  }

  try {
    const store = getStore('subscribers');

    // Use email as key (or phone if no email)
    const key = email ? `email_${email.toLowerCase().replace('@','_at_')}` : `phone_${cleanPhone}`;

    // Check if already subscribed
    const existing = await store.get(key, { type: 'json' }).catch(() => null);
    if (existing) {
      return new Response(JSON.stringify({ success: true, message: 'Already subscribed — you\'re on the list.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Save subscriber
    const subscriber = {
      email: email || null,
      phone: cleanPhone || null,
      name: name || null,
      subscribedAt: new Date().toISOString(),
      lastAlertSent: null,
      lastAlertLevel: null,
    };

    await store.setJSON(key, subscriber);

    // Send welcome email via Resend
    if (email && process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Dauphin Lake Watch <alerts@send.dauphinlakewatch.ca>',
          to: email,
          subject: 'You\'re subscribed to Dauphin Lake Watch alerts',
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
              <div style="background:#0d2137;padding:20px 24px;border-radius:6px 6px 0 0;">
                <h1 style="color:white;font-size:20px;margin:0;letter-spacing:1px;">DAUPHIN LAKE WATCH</h1>
                <p style="color:rgba(255,255,255,.55);font-size:12px;margin:4px 0 0;font-family:monospace;">INDEPENDENT COMMUNITY HYDROLOGICAL MONITORING</p>
              </div>
              <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 6px 6px;">
                <p style="font-size:16px;color:#1c1c2e;">Hi${name ? ' ' + name : ''},</p>
                <p style="color:#374151;line-height:1.6;">You're now subscribed to Dauphin Lake Watch flood alerts. You'll receive a notification when the lake crosses key thresholds during spring melt.</p>
                <div style="background:#f0ebe1;border-radius:4px;padding:16px;margin:20px 0;font-family:monospace;font-size:13px;">
                  <div style="margin-bottom:6px;"><span style="color:#8a6500;">●</span> <strong>Watch</strong> — 854.0 ft — Approaching operating range</div>
                  <div style="margin-bottom:6px;"><span style="color:#b84c00;">●</span> <strong>Advisory</strong> — 854.8 ft — Above operating range</div>
                  <div style="margin-bottom:6px;"><span style="color:#b84c00;">●</span> <strong>Elevated</strong> — 855.5 ft — Low-lying flooding possible</div>
                  <div style="margin-bottom:6px;"><span style="color:#8b0000;">●</span> <strong>Critical</strong> — 857.0 ft — Approaching flood stage</div>
                  <div><span style="color:#8b0000;">●</span> <strong>Flood Stage</strong> — 858.0 ft — Active flooding</div>
                </div>
                <p style="color:#374151;line-height:1.6;">Check current conditions anytime at <a href="https://dauphinlakewatch.ca" style="color:#2c5f7c;">dauphinlakewatch.ca</a></p>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
                  iConnect Studio — Independent Community Hydrological Research & Advisory<br>
                  To unsubscribe, reply to this email with "unsubscribe".
                </p>
              </div>
            </div>
          `
        })
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Subscribed successfully. Check your email for confirmation.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    console.error('Subscribe error:', err);
    return new Response(JSON.stringify({ error: 'Server error — please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};

export const config = { path: '/api/subscribe' };
