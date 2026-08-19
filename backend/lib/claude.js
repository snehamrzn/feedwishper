import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Convert an OpenAI-format messages array into the {system, messages} shape Anthropic expects.
// - Concatenates any system messages into a single string and puts it on the top-level `system` field.
// - Filters out non-user/assistant roles from messages.
// - Coerces string and array content to Anthropic's content shape.
function toAnthropic(messages) {
  let system = '';
  const out = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + textContent(m.content);
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    out.push({ role: m.role, content: textContent(m.content) });
  }
  return { system, messages: out };
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  return '';
}

export async function streamClaude({ openaiMessages, model, maxTokens = 1024, temperature = 0.7 }) {
  const { system, messages } = toAnthropic(openaiMessages);

  // Cache the (long-lived) system prompt so per-turn latency stays low.
  const systemBlocks = system
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : undefined;

  return client.messages.stream({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemBlocks,
    messages,
  });
}
