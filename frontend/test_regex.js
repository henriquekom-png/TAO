const str = 'Eu gosto de <span style="color: #CF0E0E;">maçãs vermelhas</span> e <span style=\'color: rgb(207, 14, 14)\'>azuis</span>.';
const regex = /(\*\*.*?\*\*|\*.*?\*|<span[^>]*style=["'][^"']*color:\s*[^"']+["'][^>]*>.*?<\/span>)/gi;

const parts = str.split(regex);
console.log('parts:', parts);

parts.forEach(part => {
  if (!part) return;
  const match = part.match(/^<span[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>$/i);
  if (match) {
    console.log('COLOR:', match[1].trim(), 'TEXT:', match[2]);
  }
});
