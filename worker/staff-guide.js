/**
 * rhythm-staff-guide Worker.
 *
 * Serves the static Rhythm staff guide (docs/manual) through the ASSETS binding,
 * and adds /download/<target> routes that hand the desktop app's latest .dmg to
 * the browser from the PRIVATE GitHub release.
 *
 * The repo stays private: a read-only, Contents-scoped fine-grained token
 * (env.GITHUB_WORKER_TOKEN) is used server-side to resolve GitHub's short-lived
 * signed asset URL, then the browser is redirected straight to it — the token
 * never reaches the client. The whole hostname sits behind Cloudflare Access,
 * so the download inherits the same church Google login as the guide itself.
 */
const OWNER = "ajhochy";
const REPO = "Rhythm";

// Friendly download path -> predicate matching the release asset filename.
// Rhythm publishes a single universal macOS DMG (Apple Silicon + Intel).
// Asset name today: Rhythm-macOS.dmg (see .github/workflows/desktop_release.yml).
const TARGETS = {
  mac: (name) => /^Rhythm-macOS\.dmg$/i.test(name),
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = pathname.match(/^\/download\/(mac)\/?$/);
    if (m) return downloadLatest(m[1], env);
    // Not a download route — serve the static guide.
    return env.ASSETS.fetch(request);
  },
};

async function downloadLatest(target, env) {
  const token = env.GITHUB_WORKER_TOKEN;
  if (!token) return text("Download isn't configured yet (missing token).", 503);

  const api = (path, accept, redirect) =>
    fetch(`https://api.github.com${path}`, {
      redirect: redirect || "follow",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept || "application/vnd.github+json",
        "User-Agent": "rhythm-staff-guide",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

  const relRes = await api(`/repos/${OWNER}/${REPO}/releases/latest`);
  if (!relRes.ok) return text(`Couldn't read the latest release (HTTP ${relRes.status}).`, 502);
  const rel = await relRes.json();

  const asset = (rel.assets || []).find((a) => TARGETS[target](a.name));
  if (!asset) return text(`No ${target} build found in ${rel.tag_name}.`, 404);

  // Ask GitHub for the bytes; it answers 302 with a short-lived signed URL.
  const assetRes = await api(
    `/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`,
    "application/octet-stream",
    "manual",
  );
  const loc = assetRes.headers.get("location");
  if ([301, 302, 307, 308].includes(assetRes.status) && loc) {
    return Response.redirect(loc, 302);
  }
  // Fallback: stream the body straight through if no redirect was issued.
  if (assetRes.ok) {
    return new Response(assetRes.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${asset.name}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return text(`Couldn't fetch the installer (HTTP ${assetRes.status}).`, 502);
}

function text(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
