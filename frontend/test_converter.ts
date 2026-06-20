import { markdownToHtml, htmlToMarkdown } from './src/lib/markdownHtmlConverter.ts';

const testMarkdown = 'Eu gosto de <span style="color: #CF0E0E">maçãs vermelhas</span>.';
console.log('Original Markdown:', testMarkdown);

const html = markdownToHtml(testMarkdown);
console.log('Markdown -> HTML:', html);

const backToMd = htmlToMarkdown(html);
console.log('HTML -> Markdown:', backToMd);

const fromEditor = '<p>Eu gosto de <span style="color: #CF0E0E">maçãs vermelhas</span>.</p>';
console.log('Editor HTML -> Markdown:', htmlToMarkdown(fromEditor));
