import { MarkdownText } from '@/components/chat/chat-markdown';

import { normalizeResearchMarkdown } from './tool-display-text';

/** Read-only report formatting. Links stay inert; no report content is executed. */
export function ResearchMarkdown({
  color,
  mutedColor,
  text,
}: {
  color: string;
  mutedColor: string;
  text: string;
}) {
  return (
    <MarkdownText
      color={color}
      mutedColor={mutedColor}
      text={normalizeResearchMarkdown(text)}
    />
  );
}
