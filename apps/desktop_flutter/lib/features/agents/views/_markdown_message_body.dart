/// OPC-M2-1: Assistant markdown renderer for chat bubbles.
///
/// [MarkdownMessageBody] renders assistant text parts as markdown using
/// `gpt_markdown`. Features:
///   - Headings, bold/italic, inline code, fenced code blocks, lists, links.
///   - Code blocks: monospace (JetBrainsMono), surfaceMuted background, copy
///     button that writes block content to Clipboard.
///   - Text is selectable.
///   - All colors and typography come from [RhythmColorRoles] tokens via
///     `context.rhythm`.
///   - Link taps are forwarded to the injected [onLinkTap] callback (defaults
///     to url_launcher so callers that don't need to mock can omit it).
///   - User-role messages MUST NOT use this widget — they use SelectableText
///     directly in _UserBubble (agents_view.dart).
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gpt_markdown/gpt_markdown.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// Renders [text] as markdown in an assistant chat bubble.
///
/// [onLinkTap] is called with the URL string when a link is tapped.
/// Defaults to [launchUrl] from url_launcher.
///
/// This widget is intentionally stateless — streaming deltas arrive as
/// successive rebuilds with a longer [text] value. No internal buffer needed.
class MarkdownMessageBody extends StatelessWidget {
  const MarkdownMessageBody({
    super.key,
    required this.text,
    this.onLinkTap,
  });

  final String text;

  /// Called with the URL when a hyperlink is tapped. Defaults to url_launcher.
  final void Function(String url)? onLinkTap;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final effectiveLinkTap = onLinkTap ?? _defaultLaunchUrl;

    return GptMarkdown(
      text,
      style: TextStyle(
        fontSize: 13,
        color: rhythm.textPrimary,
        height: 1.5,
      ),
      onLinkTap: (url, _) => effectiveLinkTap(url),
      codeBuilder: (context, name, codes, closed) => _RhythmCodeBlock(
        language: name,
        code: codes,
      ),
    );
  }
}

/// Renders a fenced code block using Rhythm theme tokens.
///
/// - Background: [RhythmColorRoles.surfaceMuted]
/// - Font: JetBrainsMono (monospace)
/// - Header row: language label + copy button
class _RhythmCodeBlock extends StatefulWidget {
  const _RhythmCodeBlock({required this.language, required this.code});

  final String language;
  final String code;

  @override
  State<_RhythmCodeBlock> createState() => _RhythmCodeBlockState();
}

class _RhythmCodeBlockState extends State<_RhythmCodeBlock> {
  bool _copied = false;

  Future<void> _copyToClipboard() async {
    await Clipboard.setData(ClipboardData(text: widget.code));
    if (!mounted) return;
    setState(() => _copied = true);
    await Future<void>.delayed(const Duration(seconds: 2));
    if (!mounted) return;
    setState(() => _copied = false);
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: language label + copy button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Row(
              children: [
                if (widget.language.isNotEmpty)
                  Text(
                    widget.language,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: rhythm.textMuted,
                      fontFamily: 'JetBrainsMono',
                    ),
                  ),
                const Spacer(),
                Tooltip(
                  message: 'Copy code',
                  child: InkWell(
                    onTap: _copyToClipboard,
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _copied ? Icons.check : Icons.content_paste,
                            size: 13,
                            color: rhythm.textMuted,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _copied ? 'Copied!' : 'Copy',
                            style: TextStyle(
                              fontSize: 11,
                              color: rhythm.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: rhythm.borderSubtle),
          // Code content
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              widget.code,
              style: TextStyle(
                fontSize: 12,
                fontFamily: 'JetBrainsMono',
                color: rhythm.textPrimary,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Default link handler: opens the URL with url_launcher.
void _defaultLaunchUrl(String url) {
  final uri = Uri.tryParse(url);
  if (uri != null) {
    launchUrl(uri);
  }
}
