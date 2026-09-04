import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, RefreshCcw, Loader2 } from 'lucide-react';
import { useAIChat } from '../../hooks/useAIChat';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const QUICK_ACTIONS = [
  "Summarize my watchlist",
  "What needs my attention?",
  "Explain these signals",
];

export function AIPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { 
    messages, 
    isLoading, 
    error, 
    sendMessage, 
    messagesEndRef,
    startNewSession
  } = useAIChat();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput('');
  };

  const handleQuickAction = (text: string) => {
    sendMessage(text);
  };

  const [width, setWidth] = useState(384);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(320, Math.min(startWidth + deltaX, window.innerWidth - 48));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      style={{ width: `${width}px` }}
      className="fixed bottom-24 right-6 min-w-[320px] max-w-[calc(100vw-3rem)] h-[600px] min-h-[400px] max-h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col z-50 animate-in slide-in-from-bottom-10 fade-in duration-200"
    >
      {/* Left side resize handle */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-[var(--signal)]/10 transition-colors z-50 flex items-center justify-center group"
        onMouseDown={handleMouseDown}
      >
        <div className="h-10 w-1 rounded-full bg-muted/20 group-hover:bg-[var(--signal)]/50 transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <div className="bg-[var(--signal)] text-white p-1.5 rounded-lg">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="font-display font-semibold text-ink">AI Assistant</h3>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={startNewSession}
            className="p-2 text-muted hover:text-ink rounded-full hover:bg-black/5 transition-colors"
            title="Start new conversation"
          >
            <RefreshCcw size={16} />
          </button>
          <button 
            onClick={onClose}
            className="p-2 text-muted hover:text-ink rounded-full hover:bg-black/5 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-white">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-70 mt-8">
            <div className="bg-[var(--signal)]/10 text-[var(--signal)] p-4 rounded-full mb-4">
              <Sparkles size={32} />
            </div>
            <h4 className="font-medium text-ink mb-2">How can I help you analyze the market?</h4>
            <p className="text-sm text-muted mb-8 max-w-[250px]">
              Ask questions about your watchlist, request summaries, or let me explain complex signals.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[280px]">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action)}
                  className="text-left px-4 py-2 text-sm bg-surface hover:bg-[var(--signal)]/10 hover:text-[var(--signal)] rounded-lg transition-colors border border-transparent hover:border-[var(--signal)]/20"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}
            >
              <div 
                className={`px-4 py-3 rounded-2xl text-sm ${
                  msg.role === 'user' 
                    ? 'bg-ink text-white rounded-br-sm' 
                    : 'bg-surface text-ink border border-border rounded-bl-sm'
                }`}
              >
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({node, ...props}) => <div className="overflow-x-auto my-3"><table className="min-w-full border-collapse text-xs" {...props} /></div>,
                    th: ({node, ...props}) => <th className="px-2 py-1.5 font-medium border-b border-muted/20 bg-surface/30 text-left uppercase text-muted" {...props} />,
                    td: ({node, ...props}) => <td className="px-2 py-1.5 border-b border-muted/10 whitespace-nowrap" {...props} />,
                    p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-semibold" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                    li: ({node, ...props}) => <li className="mb-1" {...props} />
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
                {msg.isStreaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-[var(--signal)] ml-1 animate-pulse align-middle" />
                )}
              </div>
            </div>
          ))
        )}
        
        {error && (
          <div className="self-center bg-fall/10 text-fall text-xs px-3 py-2 rounded-lg border border-fall/20 max-w-[80%] text-center">
            {error}
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-white">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask about your watchlist..."
            className="w-full bg-surface border border-border rounded-full pl-4 pr-12 py-3 text-sm focus-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2 text-white bg-[var(--signal)] rounded-full hover:bg-[var(--signal)]/90 transition-colors disabled:opacity-50 disabled:bg-muted"
          >
            {isLoading && !input.trim() ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
