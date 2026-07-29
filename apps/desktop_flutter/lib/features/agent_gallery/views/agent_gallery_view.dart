import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/constants/app_constants.dart';
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
      agentId: 'creative-media',
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
              'Creative Media',
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
              // Launch Creative Media always visible.
              Padding(
                padding: const EdgeInsets.all(RhythmSpacing.md),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const ValueKey('launch-designer-btn'),
                    onPressed: () => _launchDesigner(context),
                    icon: const Icon(Icons.palette_outlined, size: 18),
                    label: const Text('Launch Creative Media'),
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
              'No artifacts yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Launch Creative Media to create your first artifact',
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

  Future<void> _open(BuildContext context, String url) async {
    if (url.isEmpty) return;
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

  Future<void> _openArtifact(BuildContext context) => _open(
    context,
    design.artifactUrl ??
        '${AppConstants.agentLocalBaseUrl}/agent-designs/${design.id}/artifact',
  );

  Future<void> _openProject(BuildContext context) =>
      _open(context, design.projectUrl!);

  bool get _isLocalArtifact =>
      design.artifactUrl == null && design.artifactType != null;

  bool get _canPreviewLocalImage =>
      _isLocalArtifact &&
      const {'png', 'jpg', 'jpeg', 'webp', 'gif'}.contains(design.artifactType);

  bool get _canPreviewLocalVideo =>
      _isLocalArtifact && design.artifactType == 'mp4';

  String get _providerLabel => design.provider
      .split('-')
      .map(
        (part) => part.isEmpty
            ? part
            : '${part[0].toUpperCase()}${part.substring(1)}',
      )
      .join(' ');

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
          // Local previews use only the authenticated artifact route, never remote thumbnails.
          Expanded(
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(RhythmRadius.md - 1),
              ),
              child: _canPreviewLocalImage || _canPreviewLocalVideo
                  ? Image.network(
                      _canPreviewLocalVideo
                          ? '${AppConstants.agentLocalBaseUrl}/agent-designs/${design.id}/thumbnail'
                          : '${AppConstants.agentLocalBaseUrl}/agent-designs/${design.id}/artifact',
                      key: _canPreviewLocalVideo
                          ? ValueKey('gallery-poster-${design.id}')
                          : null,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _ArtifactPlaceholder(
                        rhythm: rhythm,
                        type: design.artifactType!,
                      ),
                    )
                  : _ArtifactPlaceholder(
                      rhythm: rhythm,
                      type: design.artifactType,
                    ),
            ),
          ),
          // Title + safe artifact link.
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
                const SizedBox(height: 2),
                Text(
                  _providerLabel,
                  style: TextStyle(color: rhythm.textMuted, fontSize: 11),
                ),
                if (design.artifactUrl != null || _isLocalArtifact) ...[
                  const SizedBox(height: 2),
                  GestureDetector(
                    key: ValueKey(
                      design.artifactUrl == null
                          ? 'gallery-open-/agent-designs/${design.id}/artifact'
                          : 'gallery-open-${design.artifactUrl}',
                    ),
                    onTap: () => _openArtifact(context),
                    child: Text(
                      'Open deliverable',
                      style: TextStyle(
                        color: rhythm.accent,
                        fontSize: 11,
                        decoration: TextDecoration.underline,
                        decorationColor: rhythm.accent,
                      ),
                    ),
                  ),
                ],
                if (design.projectUrl != null) ...[
                  const SizedBox(height: 2),
                  GestureDetector(
                    onTap: () => _openProject(context),
                    child: Text(
                      'Open project',
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

class _ArtifactPlaceholder extends StatelessWidget {
  const _ArtifactPlaceholder({required this.rhythm, this.type});

  final RhythmColorRoles rhythm;
  final String? type;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: rhythm.surfaceMuted,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              type == 'pdf' ||
                      type == 'pptx' ||
                      type == 'docx' ||
                      type == 'xlsx' ||
                      type == 'csv'
                  ? Icons.picture_as_pdf_outlined
                  : type == 'mp4' || type == 'mov' || type == 'webm'
                  ? Icons.video_file_outlined
                  : type == 'glb' || type == 'gltf' || type == 'obj'
                  ? Icons.view_in_ar_outlined
                  : type == 'svg'
                  ? Icons.interests_outlined
                  : Icons.image_outlined,
              color: rhythm.textMuted,
              size: 32,
            ),
            if (type != null)
              Text(
                type!.toUpperCase(),
                style: TextStyle(color: rhythm.textMuted, fontSize: 11),
              ),
          ],
        ),
      ),
    );
  }
}
