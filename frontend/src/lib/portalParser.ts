export const PORTAL_REF_REGEX = /\(\(([a-zA-Z0-9-]+)\)\)/g;

export type PortalSegment =
  | { type: 'text'; value: string }
  | { type: 'portal'; refId: string };

export function parsePortalSegments(text: string): PortalSegment[] {
  const segments: PortalSegment[] = [];
  const re = new RegExp(PORTAL_REF_REGEX);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'portal', refId: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return segments;
}

export function extractPortalIds(text: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(PORTAL_REF_REGEX);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

export function isPurePortalRef(text: string): boolean {
  return /^\(\([a-zA-Z0-9-]+\)\)$/.test(text.trim());
}

export function rebuildContentFromSegments(segments: PortalSegment[]): string {
  return segments
    .map((seg) => (seg.type === 'text' ? seg.value : `((${seg.refId}))`))
    .join('');
}
