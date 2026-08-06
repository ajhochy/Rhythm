---
date: 2026-07-27
repo: Rhythm
branch: feature/pexels-openmontage
pr: null
issues: []
status: complete
tags: [run, rhythm]
---

# Creative Media Skills

## Files

- Added `~/.config/opencode/skills/church-event-promo/SKILL.md`.
- Added `~/.config/opencode/skills/theology-explainer-short/SKILL.md`.
- Granted both skills to the `creative-media` agent profile.
- Cached the official VCRC white, black, color, horizontal, and Illustrator logo assets under Rhythm's shared creative-tools brand directory.
- Updated both skills to use the exact official logo assets by default.
- Derived a reusable VCRC brand kit from the active `visaliacrc.com` design system and copied it into the shared Drive logo library.

## Checks

- Read both installed skill files and confirmed valid frontmatter names.
- Re-read the Creative Media profile and confirmed both names in `allowedSkillsJson`.
- Visually confirmed the cached white logo matches the supplied mark.
- Visually inspected the generated brand card and palette reference.

## Notes

- Both workflows use ComfyUI plus review-gated OpenMontage/Pexels footage.
- Both require explicit review of copy/script, generated visuals, footage, music, and final output.
- The skills use PIL caption cards because the local FFmpeg build lacks drawtext/libass.
- Both reel workflows now require loop-safe music edits: 250ms boundary silence, 1.25-second fade-in, 2.5-second fade-out, and edge verification with `volumedetect`.
- No Git commit was created.
- Canonical local brand path: `~/Library/Application Support/Rhythm/creative-tools/brand-assets/visalia-crc/`.
- Authoritative shared source remains `Google Drive/My Drive/Logos/VCRC LOGOs/`.
- Brand tokens: sage `#8BA989`, dark plum `#32273B`, soft gray `#EFF0F1`, Lora headings, Aileron body, and Proxima Nova buttons/captions.
