import React, { useState, useEffect } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
});

interface MermaidRendererProps {
  chart: string;
}

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ chart }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const elementId = `mermaid-${Math.floor(Math.random() * 1000000)}`;

    const renderDiagram = async () => {
      try {
        setError(null);
        const cleanChart = chart.trim();
        if (cleanChart) {
          const { svg } = await mermaid.render(elementId, cleanChart);
          if (isMounted) {
            setSvgContent(svg);
          }
        }
      } catch (err: any) {
        console.error('Mermaid rendering error:', err);
        const badEl = document.getElementById(elementId);
        if (badEl) badEl.remove();
        
        if (isMounted) {
          setError('Erro de sintaxe no fluxograma');
        }
      }
    };

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="p-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-md font-mono select-none">
        ⚠️ {error}
      </div>
    );
  }

  return (
    <div 
      className="w-full flex justify-center p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-border rounded-md overflow-x-auto select-none transition-colors"
      dangerouslySetInnerHTML={{ __html: svgContent || '<span class="text-xs text-zinc-400 select-none">Renderizando fluxograma...</span>' }}
    />
  );
};
