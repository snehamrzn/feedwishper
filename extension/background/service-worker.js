// Thin router + in-memory tweet cache.
// Service worker may be torn down between events; that's fine — the side panel
// holds the live voice conversation, not the worker.

const MAX_TWEETS = 200; // sliding window
let tweets = new Map(); // id -> tweet (insertion-ordered)

function pushTweets(batch) {
  for (const t of batch) {
    if (!t || !t.id) continue;
    if (tweets.has(t.id)) continue;
    tweets.set(t.id, { ...t, captured_at: Date.now() });
  }
  if (tweets.size > MAX_TWEETS) {
    const overflow = tweets.size - MAX_TWEETS;
    const it = tweets.keys();
    for (let i = 0; i < overflow; i++) tweets.delete(it.next().value);
  }
}

function recent(limit = 15) {
  const all = [...tweets.values()];
  // Map's iteration order is insertion order; assume most recent inserts are
  // most recent tweets the user saw. Return the tail.
  return all.slice(-limit);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'TWEETS' && Array.isArray(msg.payload)) {
    pushTweets(msg.payload);
    sendResponse({ ok: true, total: tweets.size });
    return true;
  }
  if (msg?.type === 'GET_RECENT_TWEETS') {
    const limit = Math.min(Math.max(parseInt(msg.limit, 10) || 15, 1), 30);
    sendResponse({ tweets: recent(limit), total: tweets.size });
    return true;
  }
  if (msg?.type === 'CLEAR_TWEETS') {
    tweets = new Map();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('sidePanel setPanelBehavior failed', e));
