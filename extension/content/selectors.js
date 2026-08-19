// All X (twitter) DOM selectors live here so you can hot-patch one file
// when the site redesigns. Verify in DevTools on x.com/home before relying.

// Make available to the content script (both run in the same isolated world).
window.__FEEDWHISPER_SELECTORS__ = {
  // The virtualized list that holds the timeline. The aria-label may be localized;
  // we fall back to `[role="region"]` containing `article[data-testid="tweet"]`.
  timelineContainerPrimary: 'div[aria-label="Home timeline"], div[aria-label="Timeline: Your Home Timeline"]',
  timelineContainerFallback: 'main[role="main"]',

  // Each tweet card.
  tweet: 'article[data-testid="tweet"]',

  // Inside a tweet.
  authorBlock: 'div[data-testid="User-Name"]',
  tweetText: 'div[data-testid="tweetText"]',
  // Links to the tweet permalink — used to extract status id.
  statusLink: 'a[href*="/status/"]',
  timestamp: 'time',

  // Ads / promoted markers — skip these.
  promotedMarker: '[data-testid="placementTracking"]',
};
