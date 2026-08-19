# Feedwhisper - X (Twitter) voice companion

A sideloaded Chrome extension that turns your X home timeline into a conversational voice agent. Open the side panel, tap the mic, and a friendly voice gives you the highlights of what your follows are posting - you can interrupt and ask follow-ups naturally.

**Stack:** Chrome MV3 extension + tiny Express backend + ElevenLabs Conversational AI (voice + interruption) + Claude Sonnet (the brain, via a custom-LLM endpoint on the backend).

## How it works

```
  x.com/home
      │
      │ MutationObserver scrapes tweets passively as you scroll
      ▼
  extension/content/x-scraper.js
      │
      │ chrome.runtime.sendMessage
      ▼
  extension/background/service-worker.js   (in-memory Map of recent tweets)
      │
      │ GET_RECENT_TWEETS when the side panel opens
      ▼
  extension/side-panel/side-panel.js
      │ ├── fetch backend /get-signed-url      (mints a private ElevenLabs URL)
      │ └── WebSocket → ElevenLabs Conv AI    (with feed_json as a dynamic var)
      │
      │ ElevenLabs handles VAD, STT, TTS, and barge-in (interruptions)
      │ For each turn it calls our custom LLM:
      ▼
  backend /v1/chat/completions
      │
      │ Convert OpenAI-format messages → Anthropic shape, call Claude with streaming
      │ Stream the Anthropic events back as OpenAI-compatible SSE chunks
      ▼
  Claude Sonnet replies, ElevenLabs renders it as audio, the side panel plays it.
```

**In short:** a content script quietly reads tweets already rendered on the page (no scraping API, no extra requests to X), a background service worker keeps a rolling cache of the last ~200, and the side panel hands that cache to an ElevenLabs voice agent as context on every turn. ElevenLabs owns the audio pipeline (speech-to-text, text-to-speech, and letting you interrupt mid-sentence); the backend's only job is standing in as ElevenLabs' "custom LLM" so Claude — not a stock model — writes what the agent says, and minting short-lived signed URLs so the ElevenLabs agent can stay private.

## Layout

```
Feedwishper/
├── extension/            # the Chrome extension (sideload this)
│   ├── background/       # service worker: in-memory tweet cache + message router
│   ├── content/          # scraper injected into x.com/home
│   └── side-panel/       # the UI you actually talk to
└── backend/               # Express server: signed URLs + Claude as a custom LLM
    ├── routes/            # /v1/chat/completions, /get-signed-url
    └── lib/                # Anthropic client + OpenAI-SSE adapter
```

## What you need before you start

1. **Anthropic API key** — `sk-ant-...`
2. **ElevenLabs API key** — `sk_...` (Creator tier or higher; Agents require it)
3. **An ElevenLabs Agent** created in their dashboard with:
   - Voice: any conversational voice (e.g. Bella for low latency)
   - **Custom LLM**: model URL will be your cloudflared tunnel URL + `/v1/chat/completions`, e.g. `https://your-tunnel.trycloudflare.com/v1/chat/completions`
   - Custom LLM model name: anything (e.g. `claude`) — the backend ignores it and uses `ANTHROPIC_MODEL`
   - **Dynamic variable** declared: `feed_json` (the side panel passes the tweets in here)
   - **System prompt** (paste verbatim, then edit voice/style as you like):
     ```
     You are Sneha's personal X feed companion. Her recent tweets from her home timeline are below as JSON (a=author, h=handle, t=tweet text, u=link). Speak like a friend scrolling the timeline with her — short sentences, opinions allowed, group related tweets when you can. Never read a tweet verbatim unless she asks. If asked something not in the feed, say you don't see it on her timeline right now.

     FEED: {{feed_json}}
     ```
   - Set the agent to **Private** (so it requires signed URLs)
4. **Node 20+** and **npm**
5. **cloudflared** — `brew install cloudflared` (to expose localhost to ElevenLabs)
6. A **secondary X account** for testing (don't use your main one)

## Setup (one-time)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and fill in:
#   ANTHROPIC_API_KEY
#   ELEVENLABS_API_KEY
#   ELEVENLABS_AGENT_ID  (from the agent you just created)
#   SHARED_SECRET        (any random string, e.g. `openssl rand -hex 32`)
#   EXTENSION_ORIGINS    (fill in after step 3 below)
```

### 2. Extension secret

The side panel needs to send the same `SHARED_SECRET` back to the backend. This lives in a **gitignored** local file so it never ends up in the repo:

```bash
cd extension/side-panel
cp config.example.js config.local.js
# edit config.local.js and paste the same SHARED_SECRET you put in backend/.env
```

### 3. Start the tunnel + backend

In one terminal:
```bash
cd backend
npm run dev
```

In another terminal, the **quick** path (URL rotates every restart):
```bash
cloudflared tunnel --url http://localhost:8787
```

Or the **stable** path (named tunnel; requires a domain in Cloudflare):
```bash
cloudflared tunnel create feedwhisper
cloudflared tunnel route dns feedwhisper feedwhisper.yourdomain.com
cloudflared tunnel run --url http://localhost:8787 feedwhisper
```

Copy the public HTTPS URL — that's what goes into the ElevenLabs dashboard as the Custom LLM URL (plus `/v1/chat/completions`).

### 4. Load the extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, point at the `extension/` folder.
3. Copy the extension ID Chrome assigns it, paste into `backend/.env`:
   ```
   EXTENSION_ORIGINS=chrome-extension://<paste-id-here>
   ```
   Restart the backend.

### 5. Smoke-test the backend

```bash
curl -N -X POST https://your-tunnel/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"stream":true,"messages":[{"role":"system","content":"FEED: []"},{"role":"user","content":"say hi in 5 words"}]}'
```

You should see OpenAI-format SSE chunks streaming back, ending with `data: [DONE]`.

### 6. Smoke-test the agent

In the ElevenLabs dashboard, open your agent and click **Test agent**. Speak. You should hear a reply.

## Use it

1. Open **x.com/home**, scroll through 20–30 tweets so the scraper captures them.
2. Click the Feedwhisper icon → side panel opens.
3. Tap the mic (grant microphone permission once). Say _"what's on my timeline?"_
4. The agent should respond and name real tweets/authors from your feed.
5. Try interrupting mid-sentence: _"stop — tell me about the third one instead."_

## Security notes

- `backend/.env` and `extension/side-panel/config.local.js` hold real secrets and are gitignored — never commit them. Use the `.example` files as templates.
- `/get-signed-url` requires the `x-app-secret` header to match `SHARED_SECRET`; without it the backend refuses to mint a signed URL.
- The ElevenLabs agent is set to **Private**, so a signed URL is required to open a conversation at all.
- If a secret is ever committed by accident, rotate it (regenerate the API key / shared secret) rather than just removing it from a later commit — it's still in git history otherwise.


## What's not built (yet)

- Persistent post storage (in-memory only — restart Chrome and you lose the cache).
- Cross-session conversation memory.
- Multi-platform adapters (LinkedIn, etc.).
- Tool calls (e.g., "draft a reply", "add to calendar").
- Web Store distribution (this is for sideloading only).
