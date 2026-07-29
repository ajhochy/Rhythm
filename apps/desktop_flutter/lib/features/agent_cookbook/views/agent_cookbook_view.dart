import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_cookbook_controller.dart';
import '../models/cookbook_recipe.dart';

class AgentCookbookView extends StatefulWidget {
  const AgentCookbookView({super.key});

  @override
  State<AgentCookbookView> createState() => _AgentCookbookViewState();
}

class _AgentCookbookViewState extends State<AgentCookbookView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentCookbookController>().loadRecipes();
    });
  }

  void _showNewRecipeDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => _RecipeDialog(
        onSubmit: (title, description, steps) async {
          Navigator.of(ctx).pop();
          await context.read<AgentCookbookController>().createRecipe({
            'title': title,
            'description': description,
            'stepsJson': steps,
          });
        },
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    CookbookRecipe recipe,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Recipe',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${recipe.title}"? This cannot be undone.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(
              'Delete',
              style: TextStyle(color: ctx.rhythm.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await context.read<AgentCookbookController>().deleteRecipe(recipe.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentCookbookController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Cookbook',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              if (controller.status == AgentCookbookStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadRecipes(),
                ),
            ],
          ),
          floatingActionButton: FloatingActionButton(
            backgroundColor: context.rhythm.accent,
            foregroundColor: Colors.white,
            tooltip: 'New Recipe',
            onPressed: () => _showNewRecipeDialog(context),
            child: const Icon(Icons.add_rounded),
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(
    BuildContext context,
    AgentCookbookController controller,
  ) {
    if (controller.status == AgentCookbookStatus.loading &&
        controller.recipes.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.status == AgentCookbookStatus.error &&
        controller.recipes.isEmpty) {
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
              onPressed: () => controller.loadRecipes(),
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.recipes.isEmpty) {
      return Center(
        key: const ValueKey('cookbook-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.menu_book_rounded,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No recipes yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Tap + to create your first recipe',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      itemCount: controller.recipes.length,
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
      itemBuilder: (context, index) {
        final recipe = controller.recipes[index];
        return _RecipeTile(
          recipe: recipe,
          onDelete: () => _confirmDelete(context, recipe),
          onRun: () => _runRecipe(context, recipe),
        );
      },
    );
  }

  Future<void> _runRecipe(BuildContext context, CookbookRecipe recipe) async {
    final sessionId =
        await context.read<AgentCookbookController>().runRecipe(recipe.id);
    if (!context.mounted) return;
    if (sessionId != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Recipe started'),
          backgroundColor: context.rhythm.success,
        ),
      );
    } else {
      final err =
          context.read<AgentCookbookController>().error ?? 'Unknown error';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error: $err'),
          backgroundColor: context.rhythm.danger,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Recipe tile
// ---------------------------------------------------------------------------

class _RecipeTile extends StatelessWidget {
  const _RecipeTile({
    required this.recipe,
    required this.onDelete,
    required this.onRun,
  });

  final CookbookRecipe recipe;
  final VoidCallback onDelete;
  final VoidCallback onRun;

  // Compute a step count from the stepsJson string.
  int get _stepCount {
    final s = recipe.stepsJson.trim();
    if (s.isEmpty || s == '[]') return 0;
    // Count comma-separated top-level items roughly.
    try {
      var count = 0;
      var depth = 0;
      for (var i = 0; i < s.length; i++) {
        final c = s[i];
        if (c == '[' || c == '{') depth++;
        if (c == ']' || c == '}') depth--;
        if (c == ',' && depth == 1) count++;
      }
      // If we found any commas at depth 1, count+1; otherwise 1 if non-empty.
      return s.length > 2 ? count + 1 : 0;
    } catch (_) {
      return 0;
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
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.menu_book_outlined,
            color: rhythm.accent,
            size: 20,
          ),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  recipe.title,
                  style: TextStyle(
                    color: rhythm.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                if (recipe.description.isNotEmpty) ...[
                  const SizedBox(height: RhythmSpacing.xxs),
                  Text(
                    recipe.description,
                    style: TextStyle(
                      color: rhythm.textSecondary,
                      fontSize: 12,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (_stepCount > 0) ...[
                  const SizedBox(height: RhythmSpacing.xxs),
                  Text(
                    '$_stepCount step${_stepCount == 1 ? '' : 's'}',
                    style: TextStyle(
                      color: rhythm.textMuted,
                      fontSize: 11,
                    ),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            key: ValueKey('run-recipe-${recipe.id}'),
            icon:
                Icon(Icons.play_arrow_rounded, color: rhythm.accent, size: 20),
            tooltip: 'Run recipe',
            onPressed: onRun,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
          IconButton(
            icon: Icon(Icons.delete_outline_rounded,
                color: rhythm.textMuted, size: 18),
            tooltip: 'Delete recipe',
            onPressed: onDelete,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// New / Edit Recipe Dialog
// ---------------------------------------------------------------------------

class _RecipeDialog extends StatefulWidget {
  const _RecipeDialog({required this.onSubmit});

  final void Function(String title, String description, String steps) onSubmit;

  @override
  State<_RecipeDialog> createState() => _RecipeDialogState();
}

class _RecipeDialogState extends State<_RecipeDialog> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _stepsCtrl = TextEditingController(text: '[]');
  bool _submitting = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _stepsCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 480,
        padding: const EdgeInsets.all(RhythmSpacing.lg),
        decoration: BoxDecoration(
          color: rhythm.surface,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: rhythm.borderSubtle),
          boxShadow: RhythmElevation.raised,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'New Recipe',
              style: TextStyle(
                color: rhythm.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: RhythmSpacing.md),
            TextField(
              controller: _titleCtrl,
              autofocus: true,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: InputDecoration(
                labelText: 'Title',
                labelStyle: TextStyle(color: rhythm.textMuted),
                filled: true,
                fillColor: rhythm.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.accent, width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.sm),
            TextField(
              controller: _descCtrl,
              maxLines: 3,
              minLines: 2,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: InputDecoration(
                labelText: 'Description',
                labelStyle: TextStyle(color: rhythm.textMuted),
                filled: true,
                fillColor: rhythm.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.accent, width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.sm),
            TextField(
              controller: _stepsCtrl,
              maxLines: 4,
              minLines: 2,
              style: TextStyle(
                color: rhythm.textPrimary,
                fontFamily: 'monospace',
                fontSize: 12,
              ),
              decoration: InputDecoration(
                labelText: 'Steps (JSON array)',
                labelStyle: TextStyle(color: rhythm.textMuted),
                filled: true,
                fillColor: rhythm.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  borderSide: BorderSide(color: rhythm.accent, width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    'Cancel',
                    style: TextStyle(color: rhythm.textMuted),
                  ),
                ),
                const SizedBox(width: RhythmSpacing.sm),
                FilledButton(
                  onPressed: _submitting
                      ? null
                      : () {
                          final title = _titleCtrl.text.trim();
                          if (title.isEmpty) return;
                          setState(() => _submitting = true);
                          widget.onSubmit(
                            title,
                            _descCtrl.text.trim(),
                            _stepsCtrl.text.trim(),
                          );
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: rhythm.accent,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmRadius.md),
                    ),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Create'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
