import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { useChatAsk } from '../../hooks/useChat';
import { ChatMessage as ChatMessageType } from '../../types';
import { cn } from '../../lib/utils';

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState('');
  const { mutate: askChat, isPending } = useChatAsk();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isPending) return;

    const userMessage: ChatMessageType = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    askChat(
      { question: input, history: messages },
      {
        onSuccess: (data) => {
          setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
        },
        onError: () => {
          setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Erro ao comunicar com o assistente.' }]);
        }
      }
    );
  };

  return (
    <div className="w-80 bg-zinc-50 border-l border-zinc-200 flex flex-col h-full shrink-0">
      <div className="h-14 p-4 border-b border-zinc-200 flex items-center gap-2 bg-white shrink-0">
        <Sparkles size={18} className="text-blue-500" />
        <h2 className="font-semibold text-sm text-zinc-800">Assistente IA</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-zinc-400 mt-10 text-sm space-y-2">
            <Bot size={32} className="mx-auto text-zinc-300" />
            <p>Olá! Como posso ajudar nos seus estudos hoje?</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={cn("flex flex-col gap-1 text-sm", msg.role === 'user' ? "items-end" : "items-start")}>
              <div className="flex items-center gap-1.5 px-1 text-zinc-500 text-xs font-medium">
                {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                {msg.role === 'user' ? 'Você' : 'Assistente'}
              </div>
              <div className={cn(
                "p-3 rounded-lg max-w-[90%] leading-relaxed",
                msg.role === 'user' 
                  ? "bg-zinc-900 text-white rounded-tr-none" 
                  : "bg-white border border-zinc-200 text-zinc-800 rounded-tl-none shadow-sm whitespace-pre-wrap"
              )}>
                {msg.content}
              </div>
            </div>
          ))
        )}
        {isPending && (
          <div className="flex flex-col items-start gap-1 text-sm">
             <div className="flex items-center gap-1.5 px-1 text-zinc-500 text-xs font-medium"><Bot size={12}/> Assistente</div>
             <div className="p-3 bg-white border border-zinc-200 rounded-lg rounded-tl-none shadow-sm text-zinc-400">
                Pensando...
             </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-4 border-t border-zinc-200 bg-white">
        <form onSubmit={handleSend} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Faça uma pergunta..."
            className="w-full bg-zinc-50 border border-zinc-200 rounded-full pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 transition-all placeholder:text-zinc-400"
            disabled={isPending}
          />
          <button 
            type="submit" 
            disabled={!input.trim() || isPending}
            className="absolute right-1.5 top-1.5 p-1.5 bg-zinc-900 text-white rounded-full hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
};
