import Groq from 'groq-sdk';

const MODEL = 'openai/gpt-oss-120b';
const TEMPERATURE = 0.3;
const MAX_TOKENS = 1024;

let groqClient: Groq | null = null;

function getClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('[GroqService] GROQ_API_KEY is not set');
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

const SYSTEM_PROMPT_PREFIX = `You are Cue's AI assistant — a smart market watchlist analyst. You help users understand their watchlist signals, explain why stocks are flagged, and provide actionable insights.

Your capabilities:
- Explain attention signals: why a stock's score is high or low, what z-scores and volume ratios mean
- Summarize the user's watchlist status across all tracked symbols
- Suggest which items to review based on score magnitude and time since last review
- Contextualize a stock's behavior against its own historical patterns
- Answer general market education questions (what is volatility, P/E ratios, etc.)
- Compare signals between watchlist items

Rules:
- Be concise and direct. This is a financial tool, not a chatbot.
- Reference specific numbers from the watchlist data when explaining signals.
- NEVER give financial advice or recommend buying/selling. You explain signals, you don't recommend trades.
- When explaining attention scores, reference the formula: score = |z_score| + 0.5 × min(vol_signal, 3) + 1.5 × extreme_hit
- Buckets: needs_attention (score ≥ 2.0), notable (score ≥ 0.8), quiet (below 0.8)
- If asked about a symbol not in the watchlist, say so clearly and offer general knowledge if relevant.
- Use the user's watchlist data to ground your responses in facts, not speculation.
- Keep responses under 200 words unless the user asks for detailed analysis.`;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Stream a chat completion from Groq.
 * Returns an async iterable of content tokens.
 */
export async function* streamChat(
  watchlistContext: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const client = getClient();

  const systemPrompt = `${SYSTEM_PROMPT_PREFIX}

Current Watchlist Data:
${watchlistContext}`;

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: fullMessages,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  } catch (err: any) {
    console.error('[GroqService] Streaming error:', err);
    if (err?.status === 429) {
      yield 'I\'m receiving too many requests right now. Please try again in a moment.';
    } else {
      yield 'I\'m having trouble connecting right now. Please try again shortly.';
    }
  }
}
