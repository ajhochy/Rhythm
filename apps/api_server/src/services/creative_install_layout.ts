import { join } from 'node:path';
import type { CreativeCapabilityId } from './creative_capabilities';

export interface CreativeCapabilityLayout {
  /** Paths that must all exist before the capability can be reported installed. */
  requiredPaths: readonly string[];
  /** Installer-owned marker. A marker never substitutes for required files. */
  sentinel: string;
}

const MODEL_FILENAME = 'sd_xl_turbo_1.0_fp16.safetensors';

/**
 * The managed on-disk contract shared by the installer, status endpoint, and
 * curated MCP command catalog. Keeping this in one place prevents an installer
 * from reporting success for a layout that the engine cannot launch.
 */
export function creativeCapabilityLayout(
  root: string,
  id: CreativeCapabilityId,
): CreativeCapabilityLayout {
  switch (id) {
    case 'blender':
      return {
        requiredPaths: [
          join(root, 'blender', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
          join(root, 'blender', '.venv', 'bin', 'blender-mcp'),
          join(root, 'blender', 'blender_mcp_addon.py'),
        ],
        sentinel: join(root, 'blender', '.rhythm-installed.json'),
      };
    case 'comfyui':
      return {
        requiredPaths: [
          join(root, 'comfyui', 'main.py'),
          join(root, 'comfyui', '.venv', 'bin', 'python'),
          join(root, 'comfyui', 'mcp', 'node_modules', '@peleke.s', 'comfyui-mcp', 'dist', 'index.js'),
        ],
        sentinel: join(root, 'comfyui', '.rhythm-installed.json'),
      };
    case 'comfyui-model-pack':
      return {
        requiredPaths: [
          join(root, 'comfyui', 'models', 'checkpoints', MODEL_FILENAME),
          join(root, 'comfyui', 'models', '.rhythm-model-pack'),
        ],
        sentinel: join(root, 'comfyui', 'models', '.rhythm-model-pack'),
      };
    case 'openmontage':
      return {
        requiredPaths: [
          join(root, 'openmontage', '.venv', 'bin', 'python'),
          join(root, 'openmontage', 'openmontage-mcp', 'openmontage_mcp_server.py'),
        ],
        sentinel: join(root, 'openmontage', '.rhythm-installed.json'),
      };
    case 'obsidian':
      return {
        requiredPaths: [join(root, 'obsidian', '.venv', 'bin', 'mcp-obsidian')],
        sentinel: join(root, 'obsidian', '.rhythm-installed.json'),
      };
    case 'document-tools':
      return {
        requiredPaths: [join(root, 'document-tools', '.venv', 'bin', 'python')],
        sentinel: join(root, 'document-tools', '.rhythm-installed.json'),
      };
    case 'media-tools':
      return {
        requiredPaths: [join(root, 'media-tools', 'bin', 'ffmpeg')],
        sentinel: join(root, 'media-tools', '.rhythm-installed.json'),
      };
  }
}

export const COMFYUI_MODEL_FILENAME = MODEL_FILENAME;
