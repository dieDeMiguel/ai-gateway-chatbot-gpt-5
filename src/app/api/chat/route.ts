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
          model: 'openai/gpt-4o-mini',
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

// RAG System Query Function - Using RAG API Intermedio
async function queryRAGSystem(embedding: number[], query: string): Promise<RAGResponse | null> {
  try {
    console.log('🔍 Querying RAG API:', {
      query: query.substring(0, 100) + '...'
    });

    // Connect to RAG API intermedio (fixed by RAG team)
    const RAG_API_URL = 'http://localhost:8000';

    const ragRequest = {
      query: query,
      limit: 5,
      score_threshold: 0.3
    };

    console.log('📡 RAG API request:', ragRequest);

    const response = await fetch(`${RAG_API_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ragRequest)
    });

    if (!response.ok) {
      throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
    }

    const ragResults = await response.json();
    
    console.log('📥 RAG API response:', {
      status: response.status,
      totalFound: ragResults.total_found || 0,
      resultsCount: ragResults.results?.length || 0
    });

    // Transform RAG API response to our RAGResponse format
    const documents: RAGDocument[] = ragResults.results?.map((result: any, index: number) => {
      console.log('📄 Document found:', {
        id: result.id,
        score: result.score,
        contentLength: result.text?.length || 0,
        contentPreview: result.text?.substring(0, 200) + '...'
      });

      return {
        url: convertToRealFIFAUrl(result.id, result.text || ''),
        title: `FIFA Document ${index + 1}`,
        content: result.text || result.metadata?.text || 'No content available',
        fetched_at: new Date().toISOString(),
        score: result.score
      };
    }) || [];

    const ragResponse: RAGResponse = {
      documents,
      has_results: documents.length > 0
    };

    console.log('✅ RAG query completed:', {
      documentsFound: documents.length,
      hasResults: ragResponse.has_results,
      avgScore: documents.length > 0 ? (documents.reduce((sum, d) => sum + (d.score || 0), 0) / documents.length).toFixed(3) : 0
    });

    return ragResponse;

  } catch (error) {
    console.error('❌ RAG API connection error:', error);
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

// Convert synthetic hackathon URLs to real FIFA.com URLs
function convertToRealFIFAUrl(docId: string, content: string): string {
  // URL mapping based on content analysis
  const urlMappings: { [key: string]: string } = {
    // Stadium and venue information
    'estadio-azteca': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums/mexico-city',
    'estadio-akron': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums/guadalajara',
    'estadio-bbva': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums/monterrey',
    'sofi-stadium': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums/los-angeles',
    'lumen-field': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums/seattle',
    
    // Group stage and match information
    'grupo-d': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/groups',
    'phase-groups': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/groups',
    
    // Ticket information
    'tickets': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/tickets',
    'ticketing': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/tickets',
    
    // General tournament info
    'world-cup-2026': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
    'canada-mexico-usa': 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026'
  };

  // Analyze content to determine the most appropriate URL
  const contentLower = content.toLowerCase();
  
  // Stadium-specific mappings
  if (contentLower.includes('estadio azteca') || contentLower.includes('87,523') || contentLower.includes('mexico city')) {
    return urlMappings['estadio-azteca'];
  }
  if (contentLower.includes('estadio akron') || contentLower.includes('49,813') || contentLower.includes('guadalajara')) {
    return urlMappings['estadio-akron'];
  }
  if (contentLower.includes('estadio bbva') || contentLower.includes('53,500') || contentLower.includes('monterrey')) {
    return urlMappings['estadio-bbva'];
  }
  if (contentLower.includes('sofi stadium') || contentLower.includes('los ángeles') || contentLower.includes('los angeles')) {
    return urlMappings['sofi-stadium'];
  }
  if (contentLower.includes('lumen field') || contentLower.includes('seattle')) {
    return urlMappings['lumen-field'];
  }
  
  // Group and match information
  if (contentLower.includes('grupo d') || contentLower.includes('group d')) {
    return urlMappings['grupo-d'];
  }
  if (contentLower.includes('fase de grupos') || contentLower.includes('group stage')) {
    return urlMappings['phase-groups'];
  }
  
  // Ticket information
  if (contentLower.includes('ticket') || contentLower.includes('precio') || contentLower.includes('price') || contentLower.includes('usd')) {
    return urlMappings['tickets'];
  }
  
  // Stadium capacity general
  if (contentLower.includes('stadium') || contentLower.includes('estadio') || contentLower.includes('capacity') || contentLower.includes('capacidad')) {
    return 'https://fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/stadiums';
  }
  
  // Default to main tournament page
  return urlMappings['world-cup-2026'];
}
