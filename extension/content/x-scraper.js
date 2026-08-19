// Passive scraper. Only reads tweets the user has organically scrolled past —
// no auto-scroll, no clicks, no network calls to x.com from here.

(() => {
  const S = window.__FEEDWHISPER_SELECTORS__;
  if (!S) {
    console.warn('[feedwhisper] selectors not loaded');
    return;
  }

  const seen = new Set();
  let observer = null;
  let pending = [];
  let flushTimer = null;

  function statusIdFrom(article) {
    const a = article.querySelector(S.statusLink);
    if (!a) return null;
    const m = a.getAttribute('href')?.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function authorOf(article) {
    const block = article.querySelector(S.authorBlock);
    if (!block) return { name: '', handle: '' };
    const spans = block.querySelectorAll('span');
    let name = '';
    let handle = '';
    for (const s of spans) {
      const t = s.textContent?.trim();
      if (!t) continue;
      if (!name && !t.startsWith('@')) name = t;
      if (!handle && t.startsWith('@')) handle = t;
      if (name && handle) break;
    }
    return { name, handle };
  }

  function extract(article) {
    if (article.querySelector(S.promotedMarker)) return null;
    const id = statusIdFrom(article);
    if (!id || seen.has(id)) return null;

    const textEl = article.querySelector(S.tweetText);
    const text = textEl ? textEl.textContent.trim() : '';
    if (!text) return null;

    const { name, handle } = authorOf(article);
    const timeEl = article.querySelector(S.timestamp);
    const ts = timeEl?.getAttribute('datetime') || null;
    const url = handle && id ? `https://x.com/${handle.replace(/^@/, '')}/status/${id}` : `https://x.com/i/status/${id}`;

    seen.add(id);
    return { id, name, handle, text, ts, url };
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      chrome.runtime.sendMessage({ type: 'TWEETS', payload: batch }).catch(() => {});
    }, 250);
  }

  function scan(root) {
    const articles = root.querySelectorAll
      ? root.querySelectorAll(S.tweet)
      : [];
    for (const a of articles) {
      const t = extract(a);
      if (t) pending.push(t);
    }
    if (pending.length) scheduleFlush();
  }

  function findTimeline() {
    return (
      document.querySelector(S.timelineContainerPrimary) ||
      document.querySelector(S.timelineContainerFallback) ||
      document.body
    );
  }

  function start() {
    const root = findTimeline();
    if (!root) {
      setTimeout(start, 1000);
      return;
    }
    scan(root);
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(S.tweet)) {
            const t = extract(node);
            if (t) pending.push(t);
          } else {
            scan(node);
          }
        }
      }
      if (pending.length) scheduleFlush();
    });
    observer.observe(root, { childList: true, subtree: true });
    console.log('[feedwhisper] watching timeline');
  }

  // X is an SPA — the timeline container can be replaced when navigating between
  // /home, /notifications, /<user>, etc. Re-anchor on URL change.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      observer?.disconnect();
      observer = null;
      start();
    }
  }, 1500);

  start();
})();
