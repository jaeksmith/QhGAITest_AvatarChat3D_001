import OpenAI from 'openai';
import type { ChatMessage, LLMConfig, LLMResponse, Expression } from '../types';
import { EXPRESSIONS } from '../types';

const EXPRESSION_INSTRUCTION = `
You are an expressive AI avatar assistant. Along with your text response, you must indicate your current facial expression.

Format your response EXACTLY as:
[EXPRESSION: <expression>]
<your response text>

Available expressions: ${EXPRESSIONS.join(', ')}

Choose the expression that best matches the emotional tone of your response. For example:
- Greeting or joke → happy
- Sad news or empathy → sad
- Frustration or disagreement → angry
- Interesting new info → surprised
- Calm explanation → relaxed
- Default/neutral → neutral

Always include the [EXPRESSION: ...] tag at the very start of your response.
`;

function parseResponse(raw: string): LLMResponse {
  const match = raw.match(/\[EXPRESSION:\s*(\w+)\]/i);
  let expression: Expression = 'neutral';
  let text = raw;

  if (match) {
    const parsed = match[1].toLowerCase() as Expression;
    if (EXPRESSIONS.includes(parsed)) {
      expression = parsed;
    }
    text = raw.replace(/\[EXPRESSION:\s*\w+\]\s*/i, '').trim();
  }

  return { text, expression };
}

export async function sendChat(
  messages: ChatMessage[],
  config: LLMConfig
): Promise<LLMResponse> {
  const client = new OpenAI({
    apiKey: config.apiKey || 'lm-studio',
    baseURL: config.baseUrl.startsWith('/')
      ? `${window.location.origin}${config.baseUrl}`
      : config.baseUrl,
    dangerouslyAllowBrowser: true,
  });

  const systemMessage = {
    role: 'system' as const,
    content: EXPRESSION_INSTRUCTION,
  };

  const formattedMessages = [
    systemMessage,
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: formattedMessages,
    temperature: 0.7,
    max_tokens: 1024,
  });

  const raw = completion.choices[0]?.message?.content || '';
  return parseResponse(raw);
}
