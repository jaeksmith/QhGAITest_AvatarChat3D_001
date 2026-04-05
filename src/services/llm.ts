import OpenAI from 'openai';
import type { ChatMessage, LLMConfig, LLMResponse, Expression } from '../types';
import { EXPRESSIONS } from '../types';

/**
 * Build the system instruction dynamically based on available animation tokens.
 */
function buildSystemInstruction(
  availableAnimations: string[],
  userSystemPrompt?: string
): string {
  const animList =
    availableAnimations.length > 0
      ? availableAnimations.join(', ')
      : 'wave, greet, celebrate, dance, confused, think, frustrated, excited, walk, run';

  return `${userSystemPrompt || 'You are a friendly AI assistant with a 3D avatar. Be expressive and conversational.'}

You have a 3D avatar body. Along with your text, you control your facial expression and can perform body animations.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
[EXPRESSION: <expression>]
[ANIM: <animation>, <animation>, ...]
<your response text>

EXPRESSIONS (pick one): ${EXPRESSIONS.join(', ')}
ANIMATIONS (pick zero or more): ${animList}

The [ANIM: ...] line is optional. Include it when an animation would enhance your response. You can list multiple animations separated by commas — they will play in sequence.

Examples:
- User says "hi" → [EXPRESSION: happy]\\n[ANIM: wave]\\nHey there! Great to see you!
- User tells a joke → [EXPRESSION: happy]\\n[ANIM: celebrate]\\nHaha, that's hilarious!
- User asks a hard question → [EXPRESSION: relaxed]\\n[ANIM: think]\\nLet me think about that...
- User says "dance for me" → [EXPRESSION: happy]\\n[ANIM: dance]\\nSure, check this out!
- Normal conversation → [EXPRESSION: neutral]\\nHere's what I think...

Keep animations relevant and natural. Don't overuse them — sometimes just talking is fine.
Always include [EXPRESSION: ...] on the first line. [ANIM: ...] is optional on the second line.`;
}

function parseResponse(raw: string): LLMResponse {
  let text = raw;
  let expression: Expression = 'neutral';
  const animations: string[] = [];

  // Parse expression
  const exprMatch = text.match(/\[EXPRESSION:\s*(\w+)\]/i);
  if (exprMatch) {
    const parsed = exprMatch[1].toLowerCase() as Expression;
    if (EXPRESSIONS.includes(parsed)) {
      expression = parsed;
    }
    text = text.replace(/\[EXPRESSION:\s*\w+\]\s*/i, '');
  }

  // Parse animations
  const animMatch = text.match(/\[ANIM:\s*([^\]]+)\]/i);
  if (animMatch) {
    const tokens = animMatch[1]
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    animations.push(...tokens);
    text = text.replace(/\[ANIM:\s*[^\]]+\]\s*/i, '');
  }

  text = text.trim();

  return { text, expression, animations };
}

export async function sendChat(
  messages: ChatMessage[],
  config: LLMConfig,
  availableAnimations: string[] = [],
  userSystemPrompt?: string
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
    content: buildSystemInstruction(availableAnimations, userSystemPrompt),
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
