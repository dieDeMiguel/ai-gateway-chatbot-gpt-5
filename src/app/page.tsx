'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Response } from '@/components/ai-elements/response';

const ConversationDemo = () => {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[90vh] flex flex-col bg-card border border-border rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-card">
          <h1 className="text-xl font-semibold text-foreground">AI Gateway Chatbot</h1>
          <p className="text-sm text-muted-foreground">Powered by GPT-5</p>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden">
            <Conversation className="h-full">
              <ConversationContent className="px-6 py-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div className="space-y-2">
                      <div className="text-2xl">👋</div>
                      <h2 className="text-lg font-medium text-foreground">Welcome to AI Gateway Chatbot</h2>
                      <p className="text-muted-foreground">Start a conversation by typing a message below.</p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <Message from={message.role} key={message.id}>
                      <MessageContent>
                        {message.parts.map((part, i) => {
                          switch (part.type) {
                            case 'text':
                              return (
                                <Response key={`${message.id}-${i}`}>
                                  {part.text}
                                </Response>
                              );
                            default:
                              return null;
                          }
                        })}
                      </MessageContent>
                    </Message>
                  ))
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* Prompt Input Area */}
          <div className="flex-shrink-0 border-t border-border bg-card">
            <div className="px-6 py-4">
              <PromptInput
                onSubmit={handleSubmit}
                className="w-full relative"
              >
                <PromptInputTextarea
                  value={input}
                  placeholder="Type your message here..."
                  onChange={(e) => setInput(e.currentTarget.value)}
                  className="pr-12 resize-none"
                  rows={1}
                />
                <PromptInputSubmit
                  status={status === 'streaming' ? 'streaming' : 'ready'}
                  disabled={!input.trim()}
                  className="absolute bottom-2 right-2"
                />
              </PromptInput>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationDemo;