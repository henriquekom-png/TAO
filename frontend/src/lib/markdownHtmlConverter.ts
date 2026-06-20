/**
 * Conversor bidirecional entre Markdown básico (**negrito**, *itálico*, quebras de linha)
 * e o formato HTML utilizado internamente pelo TipTap (<strong>, <em>, <p>, <br>).
 * Suporta a preservação de tags HTML de tabelas para persistência segura no banco de dados.
 */

export function markdownToHtml(md: string): string {
  if (!md) return '';

  // 1. Encontra e protege todas as tags de tabela permitidas
  const allowedTagsRegex = /<\/?(table|thead|tbody|tr|th|td|strong|b|em|i|p|br|span|div)( [^>]+)?>/gi;
  const placeholders: string[] = [];
  
  let html = md.replace(allowedTagsRegex, (match) => {
    placeholders.push(match);
    return `___TAG_PLACEHOLDER_${placeholders.length - 1}___`;
  });

  // 2. Escapa HTML básico para evitar problemas com outros caracteres de menor/maior
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. Restaura as tags protegidas
  html = html.replace(/___TAG_PLACEHOLDER_(\d+)___/g, (_, index) => {
    return placeholders[parseInt(index, 10)];
  });

  // 4. Converte negrito (**texto** -> <strong>texto</strong>)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 5. Converte itálico (*texto* -> <em>texto</em>)
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 6. Quebra por múltiplos parágrafos (\n\n) e converte quebras simples (\n) para <br />,
  // garantindo que linhas que são/fazem parte de tabelas não sejam envolvidas em <p>
  const paragraphs = html.split(/\n\n+/);
  return paragraphs
    .map(p => {
      // Verificamos se após restaurar as tags, a linha começa com tag de tabela
      const trimmed = p.trim();
      if (
        trimmed.startsWith('<table') || 
        trimmed.startsWith('<tr') || 
        trimmed.startsWith('<td') || 
        trimmed.startsWith('<th') || 
        trimmed.startsWith('<thead') || 
        trimmed.startsWith('<tbody') ||
        trimmed.endsWith('</table>') ||
        trimmed.endsWith('</tr>')
      ) {
        return p; // Retorna a tabela ou linha de tabela diretamente sem envolver em <p>
      }
      const formatted = p.replace(/\n/g, '<br />');
      return `<p>${formatted}</p>`;
    })
    .join('');
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let md = html;

  // 1. Protege tags de tabela para não serem removidas no passo 5
  const tableTagsRegex = /<\/?(table|thead|tbody|tr|th|td)( [^>]+)?>/gi;
  const placeholders: string[] = [];
  md = md.replace(tableTagsRegex, (match) => {
    placeholders.push(match);
    return `___TABLE_TAG_${placeholders.length - 1}___`;
  });

  // 2. Converte fechamentos de parágrafos seguidos de aberturas em duas quebras de linha
  md = md.replace(/<\/p>\s*<p>/gi, '\n\n');
  md = md.replace(/<p>/gi, '');
  md = md.replace(/<\/p>/gi, '');

  // 3. Converte <br> e <br /> para uma quebra de linha
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // 4. Converte tags de negrito em **
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');

  // 5. Converte tags de itálico em *
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');

  // 6. Remove qualquer tag HTML residual
  md = md.replace(/<[^>]*>/g, '');

  // 7. Restaura as tags de tabela protegidas
  md = md.replace(/___TABLE_TAG_(\d+)___/g, (_, index) => {
    return placeholders[parseInt(index, 10)];
  });

  // 8. Decodifica entidades HTML básicas
  md = md
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  return md.trim();
}
