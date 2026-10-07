# Dayflow bundled notices

Rhythm bundles the unmodified upstream Dayflow 2.6.0 (build 133) application.
Its upstream source license at revision `a45c7be14d1137fedaeb617db9c74fd2741256e2`
is included in `LICENSE` (Copyright 2025 Jerry Liu, MIT).

`THIRD-PARTY-NOTICES.txt` is the combined notice copy supplied from that pinned
source. `notice-sources.json` records each license's source URL, revision, and
SHA-256, and `Package.resolved` records the Dayflow dependency lock. Individual
license/OFL files are also retained beside those provenance files. The lock pins
GRDB, NetworkImage, PostHog, Sentry, Sparkle, swift-cmark, and swift-markdown-ui
to their recorded revisions. Font OFL files are official Google Fonts notices;
font-binary revision equivalence is not asserted.

At package time, the Dayflow stager copies every regular file already present
inside `Dayflow.app` whose basename is `LICENSE`, `LICENCE`, `NOTICE`,
`NOTICES`, or `COPYING` (including conventional suffixes) into the adjacent
`legal/upstream-app-notices/` directory, preserving its path relative to the
upstream app.

The installed application's notice inventory is copied as supplementary
evidence, not treated as complete legal clearance. Rhythm does not synthesize
additional dependency or font attribution; any release legal concern beyond
the supplied pinned-source material requires review before distribution.
