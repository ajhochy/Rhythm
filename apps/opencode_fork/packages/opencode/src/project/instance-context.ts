import { LocalContext } from "@/util/local-context"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 *
 * Uses `containsReal` (not the lexical `contains`) so a symlink living
 * inside the boundary can't escape containment by pointing outside it — both
 * the boundary and the target are canonicalized with realpath before
 * comparing. Fails closed: an unresolvable target (dangling symlink, EACCES)
 * is treated as NOT contained.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (AppFileSystem.containsReal(ctx.directory, filepath)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  return AppFileSystem.containsReal(ctx.worktree, filepath)
}
