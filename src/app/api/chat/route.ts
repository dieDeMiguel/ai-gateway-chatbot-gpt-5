import { streamText, UIMessage, convertToModelMessages, embed } from 'ai';

// Allow streaming responses up to 300 seconds (5 minutes) to match Vercel project settings
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    
    console.log('📨 Received messages:', messages.length);

    // Get the last user message for embedding
    const lastUserMessage = messages[messages.length - 1];
    let userQuery = '';
    
    // Extract text content from the message (UIMessage uses 'parts' format)
    if (lastUserMessage?.parts) {
      const textParts = lastUserMessage.parts
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);
      userQuery = textParts.join(' ');
    }

    console.log('✅ Extracted query:', userQuery);

    // PROMPT EMBEDDING: Generate embedding for the user query
    if (userQuery.trim()) {
      try {
        console.log('🔍 Generating embedding for query:', userQuery);
        
        // Use AI Gateway for embeddings - no API key needed!
        const { embedding: queryEmbedding } = await embed({
          model: 'openai/text-embedding-3-small', // Using AI Gateway format
          value: userQuery
        });

        console.log('✅ Embedding generated:', {
          dimensions: queryEmbedding.length,
          firstValues: queryEmbedding.slice(0, 5)
        });

        // TODO: Here you can use the queryEmbedding for RAG or other purposes
        // For now, we just log it and continue with normal chat

      } catch (embeddingError) {
        console.error('❌ Embedding generation failed:', embeddingError);
        // Continue with normal chat even if embedding fails
      }
    }

    // Generate normal chat response
    const result = streamText({
      model: 'gpt-5', // Using AI Gateway
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();

  } catch (error) {
    console.error('❌ Chat API error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}