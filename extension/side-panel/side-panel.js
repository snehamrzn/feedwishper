// Side panel app. Asks the service worker for recent tweets, mints a signed URL
// from the backend, and starts an ElevenLabs Conversational AI session with the
// feed as a dynamic variable.

const BACKEND = 'http://localhost:8787';
// Must match SHARED_SECRET in backend/.env. Set via config.local.js (gitignored,
// copy config.example.js to create it) so the secret never lands in git history.
// In a real product this would not ship in the client; for sideloaded personal
// use it's effectively a per-install token.
const SHARED_SECRET = window.FEEDWHISPER_SHARED_SECRET || 'REPLACE_WITH_YOUR_SHARED_SECRET';

const els = {
  mic: document.getElementById('mic'),
  micLabel: document.getElementById('micLabel'),
  status: document.getElementById('status'),
  transcript: document.getElementById('transcript'),
  feedChip: document.getElementById('feedChip'),
  hint: document.getElementById('hint'),
};

let conv = null;

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = 'status' + (cls ? ' ' + cls : '');
}

function setMic(state) {
  els.mic.classList.remove('listening', 'speaking');
  if (state === 'listening') {
    els.mic.classList.add('listening');
    els.micLabel.textContent = 'Listening — tap to stop';
  } else if (state === 'speaking') {
    els.mic.classList.add('speaking');
    els.micLabel.textContent = 'Speaking — tap to interrupt';
  } else {
    els.micLabel.textContent = 'Tap to start';
  }
}

function appendLine(who, text) {
  const line = document.createElement('div');
  line.className = 'line ' + (who === 'You' ? 'user' : 'agent');
  const w = document.createElement('div');
  w.className = 'who';
  w.textContent = who;
  const t = document.createElement('div');
  t.className = 'text';
  t.textContent = text;
  line.appendChild(w);
  line.appendChild(t);
  els.transcript.appendChild(line);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

async function fetchTweets() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_RECENT_TWEETS', limit: 15 });
  const tweets = resp?.tweets || [];
  els.feedChip.textContent = `${resp?.total ?? 0} tweets captured (sending ${tweets.length})`;
  return tweets;
}

function compactFeed(tweets) {
  return tweets.map((t) => ({
    a: t.name || '',
    h: t.handle || '',
    t: (t.text || '').slice(0, 200),
    u: t.url || '',
  }));
}

async function getSignedUrl() {
  const r = await fetch(`${BACKEND}/get-signed-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-secret': SHARED_SECRET },
    body: '{}',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`signed url failed: ${r.status} ${t}`);
  }
  const data = await r.json();
  if (!data.signed_url) throw new Error('no signed_url in response');
  return data.signed_url;
}

async function startConversation() {
  setStatus('connecting', 'live');
  try {
    const tweets = await fetchTweets();
    if (!tweets.length) {
      els.hint.textContent = 'No tweets captured yet — open x.com/home, scroll a bit, then try again.';
      setStatus('idle');
      return;
    }
    const feed_json = JSON.stringify(compactFeed(tweets));
    const signedUrl = await getSignedUrl();

    conv = new window.ElevenLabsConv.Conversation();
    conv.on('status', (s) => {
      if (s === 'listening') setMic('listening');
      if (s === 'speaking') setMic('speaking');
      if (s === 'connected') setStatus('connected', 'live');
      if (s === 'closed' || s === 'idle') {
        setStatus('idle');
        setMic('idle');
      }
    });
    conv.on('user_text', (t) => appendLine('You', t));
    conv.on('agent_text', (t) => appendLine('Agent', t));
    conv.on('error', () => setStatus('error', 'error'));

    await conv.start({ signedUrl, dynamicVariables: { feed_json } });
    setStatus('live', 'live');
    setMic('listening');
  } catch (err) {
    console.error(err);
    appendLine('Agent', `Couldn't start: ${err.message}`);
    setStatus('error', 'error');
    setMic('idle');
  }
}

function stopConversation() {
  conv?.stop();
  conv = null;
  setMic('idle');
  setStatus('idle');
}

els.mic.addEventListener('click', () => {
  if (conv) stopConversation();
  else startConversation();
});

// Refresh the tweet-count chip when the panel opens.
fetchTweets().catch(() => {});
