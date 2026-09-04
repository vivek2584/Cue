import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  isStreaming?: boolean;
}

export function useAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        // Find latest session or just get history
        const sessionsRes = await api.get('/ai/sessions');
        const latestSessionId = sessionsRes.sessions[0]?.sessionId;
        
        if (latestSessionId) {
          setSessionId(latestSessionId);
          const historyRes = await api.get(`/ai/history?sessionId=${latestSessionId}`);
          if (historyRes.messages) {
            setMessages(historyRes.messages.map((m: any) => ({
              ...m,
              isStreaming: false
            })));
          }
        }
      } catch (err) {
        console.error('Failed to load chat history', err);
      }
    }
    
    loadHistory();
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const startNewSession = () => {
    setSessionId(null);
    setMessages([]);
    setError(null);
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Abort previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    // Create a placeholder for the assistant's response
    const assistantMessageId = `assistant-${Date.now()}`;
    setMessages(prev => [
      ...prev, 
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        isStreaming: true,
      }
    ]);

    try {
      const token = localStorage.getItem('token');
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      
      const response = await fetch(`${apiUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: content,
          sessionId,
          // Send last 10 messages for context
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          }))
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        let errMsg = 'Failed to connect to AI assistant.';
        try {
          const errData = await response.json();
          if (errData.error) errMsg = errData.error;
        } catch (e) {}
        
        if (response.status === 429) errMsg = 'Rate limit exceeded. Please wait a moment.';
        throw new Error(errMsg);
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            if (!dataStr.trim()) continue;
            
            try {
              const data = JSON.parse(dataStr);
              
              if (data.error) {
                setError(data.error);
                break;
              }
              
              if (data.done) {
                if (data.sessionId) setSessionId(data.sessionId);
                break;
              }
              
              if (data.token) {
                assistantContent += data.token;
                
                // Update the streaming message in state
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, content: assistantContent } 
                      : msg
                  )
                );
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
          }
        }
      }

      // Mark streaming as complete
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, isStreaming: false } 
            : msg
        )
      );

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'An error occurred.');
        // Remove empty placeholder on error
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId || m.content !== ''));
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    messagesEndRef,
    startNewSession
  };
}
