import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agents/controllers/agents_controller.dart';
import '../controllers/agent_gallery_controller.dart';
import '../models/agent_design.dart';

class AgentGalleryView extends StatefulWidget {
  const AgentGalleryView({super.key});

  @override
  State<AgentGalleryView> createState() => _AgentGalleryViewState();
}

class _AgentGalleryViewState extends State<AgentGalleryView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentGalleryController>().loadDesigns();
    });
  }

  Future<void> _launchDesigner(BuildContext context) async {
    final agentsController = context.read<AgentsController>();
    final session = await agentsController.createSession(
      // A staff-facing helper session isn't tied to a code checkout, but the
      // engine requires a non-empty working dir — default to HOME, matching
      // the normal chat launchers (agents_view.dart, quick_actions_bar.dart).
      // '' → 400 "cwd is required" (the #863 smoke bug).
      cwd: Platform.environment['HOME'] ?? '/',
      name: 'Graphic Designer',
      mcpRole: 'graphic-designer',
    );
    if (!context.mounted) return;
    if (session == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(agentsController.error ?? 'Failed to create session.'),
        ),
      );
      return;
    }
    agentsController.selectSession(session.id);
    agentsController.setComposerDraft(
      session.id,
      'Help me create a church graphic — ask me what I need (event, size, style).',
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentGalleryController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Gallery',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              if (controller.status == AgentGalleryStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadDesigns(),
                ),
            ],
          ),
          body: Column(
            children: [
              // Launch designer button always visible.
              Padding(
                padding: const EdgeInsets.all(RhythmSpacing.md),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const ValueKey('launch-designer-btn'),
                    onPressed: () => _launchDesigner(context),
                    icon: const Icon(Icons.palette_outlined, size: 18),
                    label: const Text('Launch designer'),
                    style: FilledButton.styleFrom(
                      backgroundColor: context.rhythm.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.sm,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                      ),
                    ),
                  ),
                ),
              ),
              Divider(height: 1, color: context.rhythm.borderSubtle),
              Expanded(child: _buildBody(context, controller)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentGalleryController controller) {
    if (controller.status == AgentGalleryStatus.loading &&
        controller.designs.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.status == AgentGalleryStatus.error &&
        controller.designs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline_rounded,
              color: context.rhythm.danger,
              size: 48,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              controller.error ?? 'An error occurred',
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: RhythmSpacing.md),
            FilledButton(
              onPressed: () => controller.loadDesigns(),
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.designs.isEmpty) {
      return Center(
        key: const ValueKey('gallery-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.photo_library_outlined,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No designs yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Launch the designer to create your first design',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: RhythmSpacing.sm,
        mainAxisSpacing: RhythmSpacing.sm,
        childAspectRatio: 0.85,
      ),
      itemCount: controller.designs.length,
      itemBuilder: (context, index) {
        final design = controller.designs[index];
        return _DesignCard(design: design);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Design card
// ---------------------------------------------------------------------------

class _DesignCard extends StatelessWidget {
  const _DesignCard({required this.design});

  final AgentDesign design;

  Future<void> _openInCanva(BuildContext context) async {
    final url = design.canvaUrl;
    if (url == null || url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not open: $url'),
          backgroundColor: context.rhythm.danger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    return Container(
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Thumbnail.
          Expanded(
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(RhythmRadius.md - 1),
              ),
              child: design.thumbnailUrl != null
                  ? Image.network(
                      design.thumbnailUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) =>
                          _ThumbnailPlaceholder(rhythm: rhythm),
                    )
                  : _ThumbnailPlaceholder(rhythm: rhythm),
            ),
          ),
          // Title + Canva link.
          Padding(
            padding: const EdgeInsets.fromLTRB(
              RhythmSpacing.sm,
              RhythmSpacing.xs,
              RhythmSpacing.sm,
              RhythmSpacing.xs,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  design.title,
                  style: TextStyle(
                    color: rhythm.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (design.canvaUrl != null) ...[
                  const SizedBox(height: 2),
                  GestureDetector(
                    onTap: () => _openInCanva(context),
                    child: Text(
                      'Open in Canva',
                      style: TextStyle(
                        color: rhythm.accent,
                        fontSize: 11,
                        decoration: TextDecoration.underline,
                        decorationColor: rhythm.accent,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ThumbnailPlaceholder extends StatelessWidget {
  const _ThumbnailPlaceholder({required this.rhythm});

  final RhythmColorRoles rhythm;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: rhythm.surfaceMuted,
      child: Center(
        child: Icon(Icons.image_outlined, color: rhythm.textMuted, size: 32),
      ),
    );
  }
}
