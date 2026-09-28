import { useState, type MouseEvent, type ReactNode } from 'react';

// The Electron shell denies popups/navigation, so a plain <a target="_blank"> never opens.
// This click handler routes through the preload bridge instead, falling back to window.open
// for the browser-hosted web app and Playwright tests where the bridge is absent.
export function ExternalLink({ href, children, linkTestId, copyTestId, className }: {
  href: string; children: ReactNode; linkTestId?: string; copyTestId?: string; className?: string;
}) {
  const [status, setStatus] = useState('');

  const openLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setStatus('');
    const openExternal = window.rhythmShell?.openExternal;
    if (typeof openExternal === 'function') {
      void openExternal(href).catch(() => setStatus('Could not open the link automatically — use Copy link and paste it into a browser.'));
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(href).then(
      () => setStatus('Link copied.'),
      () => setStatus('Could not copy the link.'),
    );
  };

  return <span className={className}>
    <a href={href} target="_blank" rel="noreferrer" data-testid={linkTestId} onClick={openLink}>{children}</a>
    {' '}<button type="button" className="text-button" onClick={copyLink} data-testid={copyTestId}>Copy link</button>
    {status && <small role="status">{` ${status}`}</small>}
  </span>;
}
