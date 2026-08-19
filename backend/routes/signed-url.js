// Mints a signed URL for the side panel to start a private ElevenLabs Agent conversation.
// The side panel must send the shared secret in the `x-app-secret` header.

const ELEVEN_BASE = 'https://api.elevenlabs.io';

export async function getSignedUrl(req, res) {
  const secret = req.headers['x-app-secret'];
  if (!process.env.SHARED_SECRET || secret !== process.env.SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!agentId || !apiKey) {
    return res.status(500).json({ error: 'agent id or api key not configured' });
  }

  try {
    const url = `${ELEVEN_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('elevenlabs signed url error', r.status, text);
      return res.status(r.status).json({ error: 'elevenlabs error', detail: text });
    }
    const data = await r.json();
    res.json({ signed_url: data.signed_url });
  } catch (err) {
    console.error('signed url fetch failed', err);
    res.status(500).json({ error: err.message || 'fetch failed' });
  }
}
