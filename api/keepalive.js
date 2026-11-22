// Daily ping (see "crons" in vercel.json). Supabase pauses free projects after
// 7 days without database activity; this call runs a tiny database query.
const SUPABASE_URL = 'https://pjelwskexxjulhrzolsq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gxpu5_zfkFrXKmrZOe9lCA_JnxEOp_l';

export default async function handler(req, res) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/keep_alive`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await r.text();
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: r.ok ? JSON.parse(body) : undefined });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err?.message || err) });
  }
}
