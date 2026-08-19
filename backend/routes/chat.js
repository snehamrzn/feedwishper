import { streamClaude } from '../lib/claude.js';
import { streamAnthropicAsOpenAI } from '../lib/sse-adapter.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

export async function chatCompletions(req, res) {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const model = DEFAULT_MODEL;
  const maxTokens = body.max_tokens || 1024;
  const temperature = body.temperature ?? 0.7;
  const stream = body.stream !== false;

  if (!messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

  if (!stream) {
    return res.status(400).json({
      error: 'this endpoint only supports stream:true (ElevenLabs Agents always streams)',
    });
  }

  try {
    const anthropicStream = await streamClaude({
      openaiMessages: messages,
      model,
      maxTokens,
      temperature,
    });
    await streamAnthropicAsOpenAI({ res, anthropicStream, model });
  } catch (err) {
    console.error('chat error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'upstream error' });
    } else {
      try {
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  }
}
