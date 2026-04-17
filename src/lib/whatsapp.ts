const FENCE_PLACEHOLDER = (i: number | string) => `\u0000WAFENCE${i}\u0000`;
const INLINE_PLACEHOLDER = (i: number | string) => `\u0000WAINLINE${i}\u0000`;
const BOLD_PLACEHOLDER = (i: number | string) => `\u0000WABOLD${i}\u0000`;

function stripFrontMatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
}

export function markdownToWhatsApp(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n');
  text = stripFrontMatter(text);

  const fenced: string[] = [];
  text = text.replace(/```[^\n`]*\n([\s\S]*?)```/g, (_match, body: string) => {
    fenced.push('```\n' + body.replace(/\n$/, '') + '\n```');
    return FENCE_PLACEHOLDER(fenced.length - 1);
  });

  const inlineCode: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, body: string) => {
    inlineCode.push('```' + body + '```');
    return INLINE_PLACEHOLDER(inlineCode.length - 1);
  });

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target);

  const bolds: string[] = [];
  const captureBold = (_m: string, body: string) => {
    bolds.push(body);
    return BOLD_PLACEHOLDER(bolds.length - 1);
  };
  text = text.replace(/\*\*([^*\n]+)\*\*/g, captureBold);
  text = text.replace(/__([^_\n]+)__/g, captureBold);

  text = text.replace(/~~([^~\n]+)~~/g, '~$1~');

  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1_$2_');

  text = text.replace(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm, '*$2*');

  text = text.replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, '');

  text = text.replace(new RegExp(BOLD_PLACEHOLDER('(\\d+)'), 'g'), (_m, i: string) => `*${bolds[Number(i)]}*`);
  text = text.replace(new RegExp(INLINE_PLACEHOLDER('(\\d+)'), 'g'), (_m, i: string) => inlineCode[Number(i)]);
  text = text.replace(new RegExp(FENCE_PLACEHOLDER('(\\d+)'), 'g'), (_m, i: string) => fenced[Number(i)]);

  return text.trim();
}
