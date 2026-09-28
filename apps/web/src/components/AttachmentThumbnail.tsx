import { useEffect, useState, type ReactNode } from 'react';
import { useGateway } from '../gateway/context';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function isImageMime(mime: string | undefined): boolean {
  return !!mime && IMAGE_MIMES.has(mime);
}

// ponytail: one fetch per mount, no cross-instance cache — a transcript holds few image
// attachments and each thumbnail unmounts with its message, so this doesn't need a shared store.
function useAttachmentSrc(url: string, artifactProject: string | undefined, apiBase: string | undefined): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url.startsWith('data:')) { setSrc(url); setFailed(false); return; }
    if (!url.startsWith('/artifacts/') || !apiBase) { setSrc(null); setFailed(true); return; }
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(`${apiBase}${url}`, {
          headers: artifactProject ? { 'X-Rhythm-Project': artifactProject } : {},
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, artifactProject, apiBase]);

  return { src, failed };
}

// Renders a bounded thumbnail for a hosted image attachment (user file part or tool
// attachment), fetching `/artifacts/<id>` bytes with the required project header, or using a
// `data:` URL directly. Falls back to `fallback` (the existing chip) on any non-image mime,
// missing url, or fetch/decode failure.
export function AttachmentThumbnail({ mime, url, artifactProject, filename, fallback }: {
  mime?: string;
  url?: string;
  artifactProject?: string;
  filename?: string;
  fallback: ReactNode;
}) {
  const gateway = useGateway();
  const apiBase = gateway.environment?.apiBase;
  const eligible = isImageMime(mime) && !!url;
  const { src, failed } = useAttachmentSrc(eligible ? url! : '', artifactProject, apiBase);
  if (!eligible || failed || !src) return <>{fallback}</>;
  // Filename stays visible as a caption (not just alt text) — existing transcript specs assert
  // on the visible filename text (e.g. post-m1-phase-4-session-lifecycle.live.redspec.ts).
  return <figure className="attachment-thumbnail-wrap">
    <img className="attachment-thumbnail" src={src} alt={filename ? `Preview of ${filename}` : 'Attachment preview'} />
    {filename && <figcaption>{filename}</figcaption>}
  </figure>;
}
