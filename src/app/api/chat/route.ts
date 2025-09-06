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

        // Query RAG system with embedding
        const ragResponse = await queryRAGSystem(queryEmbedding, userQuery);
        
        if (ragResponse) {
          console.log('📚 RAG context retrieved from FIFA.com');
        }

        // Build system prompt based on RAG results
        const systemPrompt = buildSystemPrompt(ragResponse, userQuery);

        // Generate response with RAG context
        const result = streamText({
          model: 'gpt-5',
          system: systemPrompt,
          messages: convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse();

      } catch (embeddingError) {
        console.error('❌ Embedding generation failed:', embeddingError);
        // Continue with normal chat even if embedding fails
      }
    }

    // Fallback: Generate normal chat response without RAG
    const result = streamText({
      model: 'gpt-5',
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();

  } catch (error) {
    console.error('❌ Chat API error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ============================================================================
// RAG SYSTEM INTEGRATION
// ============================================================================

interface RAGDocument {
  url: string;
  title: string;
  content: string;
  fetched_at: string;
  score?: number;
}

interface RAGResponse {
  documents: RAGDocument[];
  has_results: boolean;
  query_id?: string;
}

// RAG System Query Function
async function queryRAGSystem(embedding: number[], query: string): Promise<RAGResponse | null> {
  try {
    console.log('🔍 Querying RAG system:', {
      embeddingLength: embedding.length,
      query: query.substring(0, 100) + '...'
    });

    // TODO: Replace with actual RAG endpoint from your team
    const RAG_ENDPOINT = process.env.RAG_ENDPOINT_URL || 'https://your-rag-api.com/search';
    const RAG_API_KEY = process.env.RAG_API_KEY || 'your-api-key';

    const ragRequest = {
      query_embedding: embedding,
      query_text: query,
      filters: {
        domain: "fifa.com/en",        // PRD requirement: FIFA domain only
        language: "english"           // MVP scope: English only
      },
      top_k: 5,                       // TODO: Optimize with your team
      similarity_threshold: 0.75,     // TODO: Tune with your team
      include_metadata: true          // For provenance logging
    };

    const response = await fetch(RAG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RAG_API_KEY}`
      },
      body: JSON.stringify(ragRequest)
    });

    if (!response.ok) {
      throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
    }

    const ragResults: RAGResponse = await response.json();

    // Log provenance for admin console (PRD requirement)
    if (ragResults.documents && ragResults.documents.length > 0) {
      await logProvenance(query, ragResults.documents);
    }

    console.log('✅ RAG query completed:', {
      documentsFound: ragResults.documents?.length || 0,
      hasResults: ragResults.has_results
    });

    return ragResults;

  } catch (error) {
    console.error('❌ RAG system error:', error);
    return null; // Graceful degradation
  }
}

// System Prompt Builder
function buildSystemPrompt(ragResponse: RAGResponse | null, userQuery: string): string {
  if (!ragResponse || !ragResponse.has_results || !ragResponse.documents?.length) {
    // No-Answer Policy (PRD requirement)
    return buildNoAnswerPrompt();
  }

  const context = buildContextFromSources(ragResponse.documents);
  
  return `You are a FIFA.com assistant chatbot. Your role is to help visitors find accurate information about FIFA events, tickets, and official content.

STRICT GUIDELINES:
- Answer ONLY based on the retrieved FIFA.com content provided below
- Always include citations and sources for your answers
- If the context doesn't fully answer the question, acknowledge this and provide what information you can
- Focus on ticket sales, World Cup information, FIFA events, and official policies
- Maintain a helpful, professional tone
- Provide specific details when available (dates, prices, procedures)
- Never hallucinate or provide information not found in the retrieved context

DOMAIN RESTRICTION:
- Only reference content from fifa.com/en and its subpages
- Do not provide information from other sources or your training data

RETRIEVED CONTEXT FROM FIFA.COM:
${context}

Based on this FIFA.com content, please answer the user's question: "${userQuery}"`;
}

// No-Answer Policy (PRD requirement)
function buildNoAnswerPrompt(): string {
  return `You must respond with exactly this message:

"I don't know based on current fifa.com content I have indexed."

Then suggest the user visit fifa.com directly for the most current information about FIFA events and tickets.`;
}

// Context Builder from RAG Sources
function buildContextFromSources(documents: RAGDocument[]): string {
  const contextParts = documents.map((doc, index) => {
    return `[Source ${index + 1}] ${doc.title}
Content: ${doc.content}
URL: ${doc.url}
Last indexed: ${doc.fetched_at}`;
  });

  return contextParts.join('\n\n---\n\n');
}

// Provenance Logging (PRD requirement)
async function logProvenance(query: string, sources: RAGDocument[]): Promise<void> {
  try {
    for (const source of sources) {
      const provenanceTuple = {
        url: source.url,
        title: source.title,
        snippet_hash: hashContent(source.content),
        fetched_at: source.fetched_at,
        query: query,
        timestamp: new Date().toISOString(),
        score: source.score
      };

      // TODO: Store in your database for admin console
      console.log('📋 Provenance logged:', {
        url: provenanceTuple.url,
        title: provenanceTuple.title,
        query: query.substring(0, 50) + '...'
      });

      // Example: await database.store('provenance', provenanceTuple);
    }
  } catch (error) {
    console.error('❌ Provenance logging failed:', error);
    // Don't fail the request if logging fails
  }
}

// Simple hash function for content
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

// Citation Formatter (for future widget use)
function formatCitations(sources: RAGDocument[], displayMode: 'FULL_LINKS' | 'COMPACT_LINE' | 'HIDDEN' = 'COMPACT_LINE'): string {
  if (!sources || sources.length === 0) return '';

  switch (displayMode) {
    case 'FULL_LINKS':
      return sources.map(s => `[${s.title}](${s.url})`).join(', ');
    
    case 'COMPACT_LINE':
      const latestDate = Math.max(...sources.map(s => new Date(s.fetched_at).getTime()));
      return `Verified from fifa.com • Last indexed ${new Date(latestDate).toLocaleDateString()}`;
    
    case 'HIDDEN':
      const latestDateHidden = Math.max(...sources.map(s => new Date(s.fetched_at).getTime()));
      return `Verified from fifa.com • Last indexed ${new Date(latestDateHidden).toLocaleDateString()}`;
    
    default:
      return formatCitations(sources, 'COMPACT_LINE');
  }
}