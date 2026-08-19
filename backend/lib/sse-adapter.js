// Converts Anthropic SDK streaming events into OpenAI chat-completions SSE chunks.
// ElevenLabs Agents (and most OpenAI-compatible consumers) expect:
//   data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n
//   data: {... delta: {content: "Hi"} ...}\n\n
//   data: {... delta: {}, finish_reason: "stop" ...}\n\n
//   data: [DONE]\n\n

function chunk(id, model, delta, finishReason = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function writeChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function streamAnthropicAsOpenAI({ res, anthropicStream, model }) {
  const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let openedRole = false;
  let finishReason = 'stop';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    for await (const event of anthropicStream) {
      switch (event.type) {
        case 'message_start': {
          if (!openedRole) {
            writeChunk(res, chunk(id, model, { role: 'assistant', content: '' }));
            openedRole = true;
          }
          break;
        }
        case 'content_block_delta': {
          const d = event.delta;
          if (d?.type === 'text_delta' && d.text) {
            writeChunk(res, chunk(id, model, { content: d.text }));
          }
          break;
        }
        case 'message_delta': {
          if (event.delta?.stop_reason === 'max_tokens') {
            finishReason = 'length';
          }
          break;
        }
        case 'message_stop': {
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    console.error('anthropic stream error', err);
    writeChunk(res, chunk(id, model, { content: '\n\n[upstream error]' }));
    finishReason = 'stop';
  }

  if (!openedRole) {
    writeChunk(res, chunk(id, model, { role: 'assistant', content: '' }));
  }
  writeChunk(res, chunk(id, model, {}, finishReason));
  res.write('data: [DONE]\n\n');
  res.end();
}
