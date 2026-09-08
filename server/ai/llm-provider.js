// server/ai/llm-provider.js
//
// Unified LLM adapter for coLearn-AI.
// Reads AI_PROVIDER from .env ('openai' or 'claude') and routes all model
// calls through two functions: chatCompletion() and textCompletion().
// Switch providers by changing AI_PROVIDER + the matching key, then restarting.
//
// Environment variables:
//   AI_PROVIDER=openai          # 'openai' (default) or 'claude'
//   OPENAI_API_KEY=sk-...       # required when AI_PROVIDER=openai
//   OPENAI_MODEL=gpt-4o-mini    # optional; default gpt-4o-mini
//   ANTHROPIC_API_KEY=sk-ant-... # required when AI_PROVIDER=claude
//   CLAUDE_MODEL=claude-3-5-haiku-20241022  # optional; see below for defaults
//
// Getting API keys:
//   OpenAI:    https://platform.openai.com/api-keys
//   Anthropic: https://console.anthropic.com/settings/api-keys
//              (Your Claude research account login works at console.anthropic.com)

require('dotenv').config();

const PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase().trim();

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------
function isAiConfigured() {
  if (PROVIDER === 'claude') {
    const key = process.env.ANTHROPIC_API_KEY;
    return !!key && key !== 'test-key';
  }
  const key = process.env.OPENAI_API_KEY;
  return !!key && key !== 'test-key';
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------
function getModel() {
  if (PROVIDER === 'claude') {
    return process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

// Inline AI help model — OpenAI has specific model names; Claude just uses
// the configured model regardless of what the client requests.
const INLINE_AI_DEFAULT_MODEL = 'gpt-5-mini';
const INLINE_AI_ALLOWED_MODELS = new Set(['gpt-5-mini', 'gpt-4o-mini']);

function getInlineAiModel(value) {
  if (PROVIDER === 'claude') {
    return getModel();
  }
  const model = String(value || '').trim();
  return INLINE_AI_ALLOWED_MODELS.has(model) ? model : INLINE_AI_DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Lazy client initialisation (so module loads cleanly without keys)
// ---------------------------------------------------------------------------
let _openaiClient = null;
let _anthropicClient = null;

function getOpenAIClient() {
  if (!_openaiClient) {
    const OpenAI = require('openai');
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

function getAnthropicClient() {
  if (!_anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

// ---------------------------------------------------------------------------
// Stub responses when AI is not configured
// ---------------------------------------------------------------------------
const STUB_REVISE_JSON = JSON.stringify({
  decision: 'revise',
  feedback: 'AI feedback is temporarily unavailable. Please review your response and try again, or continue when that option is available.',
  revision_requirement: 'Provide a response that addresses the question.',
  revision_severity: 'normal',
});

// ---------------------------------------------------------------------------
// chatCompletion({ messages, temperature, max_tokens, jsonMode })
//
// messages: [{role, content}, ...] — same shape as OpenAI chat messages.
//   A 'system' role entry is extracted and passed as Anthropic's `system`
//   parameter when using Claude.
// jsonMode: true adds response_format:{type:"json_object"} on OpenAI, and
//   appends a JSON-only instruction to the system prompt on Claude.
//
// Returns { text: string } — the model's reply, already trimmed.
// ---------------------------------------------------------------------------
async function chatCompletion({
  messages,
  temperature = 0.2,
  max_tokens = 800,
  jsonMode = false,
}) {
  if (!isAiConfigured()) {
    return { text: STUB_REVISE_JSON };
  }

  if (PROVIDER === 'claude') {
    const anthropic = getAnthropicClient();
    const model = getModel();

    // Claude takes system separately
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    let systemContent = systemMsg?.content || '';
    if (jsonMode) {
      systemContent +=
        '\n\nReturn ONLY a valid JSON object. No markdown fences, no commentary, no text before or after the JSON.';
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens,
      ...(systemContent ? { system: systemContent } : {}),
      messages: userMessages,
      // Note: Anthropic API uses temperature differently — it's supported but
      // the range is 0–1. Values above 1 are clamped; pass as-is since our
      // callers use 0.1–0.2.
      temperature,
    });

    const text = (response.content?.[0]?.text ?? '').trim();
    return { text };
  }

  // OpenAI path
  const openai = getOpenAIClient();
  const params = {
    model: getModel(),
    messages,
    temperature,
    max_tokens,
  };
  if (jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  const chat = await openai.chat.completions.create(params);
  const text = (chat.choices?.[0]?.message?.content ?? '').trim();
  return { text };
}

// ---------------------------------------------------------------------------
// textCompletion({ system, input, max_tokens, model })
//
// For inline AI help blocks. Uses the OpenAI Responses API on the OpenAI
// path (which supports reasoning models like gpt-5-mini), and the standard
// Anthropic Messages API on the Claude path.
//
// Returns { text: string }
// ---------------------------------------------------------------------------
async function textCompletion({
  system,
  input,
  max_tokens = 500,
  model = null,            // caller can pass a specific OpenAI model name
}) {
  if (!isAiConfigured()) {
    return { text: '' };
  }

  if (PROVIDER === 'claude') {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: getModel(),
      max_tokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: input }],
    });
    const text = (response.content?.[0]?.text ?? '').trim();
    return { text };
  }

  // OpenAI path — use the Responses API (supports reasoning models)
  const openai = getOpenAIClient();
  const selectedModel = model || INLINE_AI_DEFAULT_MODEL;

  const request = {
    model: selectedModel,
    instructions: system,
    input,
    text: { format: { type: 'text' } },
    max_output_tokens: max_tokens,
  };
  // gpt-5-mini is a reasoning model; use minimal effort for short classroom replies
  if (selectedModel === 'gpt-5-mini') {
    request.reasoning = { effort: 'minimal' };
  }

  const response = await openai.responses.create(request);

  // Handle both output_text convenience field and the canonical output array
  const convenienceText = String(response?.output_text || '').trim();
  if (convenienceText) return { text: convenienceText };

  const parts = Array.isArray(response?.output)
    ? response.output.flatMap((item) =>
        Array.isArray(item?.content) ? item.content : []
      )
    : [];
  const text = parts
    .filter((p) => p?.type === 'output_text' && typeof p.text === 'string')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return { text };
}

module.exports = {
  chatCompletion,
  textCompletion,
  isAiConfigured,
  getModel,
  getInlineAiModel,
  PROVIDER,
};
