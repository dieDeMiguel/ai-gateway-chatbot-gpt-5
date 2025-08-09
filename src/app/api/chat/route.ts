import { streamText, UIMessage, convertToModelMessages } from 'ai';

// Allow streaming responses up to 300 seconds (5 minutes) to match Vercel project settings
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } =
    await req.json();

  const result = streamText({
    model: 'gpt-5',
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}