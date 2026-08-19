import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chatCompletions } from './routes/chat.js';
import { getSignedUrl } from './routes/signed-url.js';

const app = express();
const PORT = process.env.PORT || 8787;

const allowedOrigins = (process.env.EXTENSION_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return cb(null, true);
      }
      return cb(null, true);
    },
    credentials: false,
  })
);

app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ← ${req.headers['user-agent'] || ''}`);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/v1/chat/completions', chatCompletions);
app.post('/get-signed-url', getSignedUrl);

app.listen(PORT, () => {
  console.log(`backend listening on http://localhost:${PORT}`);
  console.log(`allowed origins: ${allowedOrigins.join(', ') || '(none configured)'}`);
});
