import { existsSync as nodeExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

export type CreativeCapabilityId =
  | 'blender'
  | 'comfyui'
  | 'comfyui-model-pack'
  | 'openmontage'
  | 'obsidian'
  | 'document-tools'
  | 'media-tools';

export type CreativeCapabilityStatus = 'missing' | 'installed' | 'unhealthy';

export interface CreativeCapabilityApproval {
  required: true;
  summary: string;
}

export interface CreativeCapability {
  id: CreativeCapabilityId;
  name: string;
  description: string;
  enables: string;
  download: string;
  disk: string;
  advanced: boolean;
  dependencies: CreativeCapabilityId[];
  approval: CreativeCapabilityApproval;
  status: CreativeCapabilityStatus;
}

export interface CreativeCapabilityListDeps {
  existsSync?: (path: string) => boolean;
  homeDir?: string;
  tcpProbe?: (host: string, port: number) => Promise<boolean>;
}

interface CreativeCapabilityDefinition extends Omit<CreativeCapability, 'status'> {
  relativePath: string[];
  localhostPort?: number;
}

const DEFINITIONS: CreativeCapabilityDefinition[] = [
  {
    id: 'blender',
    name: 'Blender',
    description: 'Local 3D modeling, animation, and rendering with Blender.',
    enables: 'Create and render 3D scenes from the Creative Media Agent.',
    download: 'About 350 MB',
    disk: 'About 1.5 GB',
    advanced: false,
    dependencies: [],
    approval: { required: true, summary: 'Downloads Blender and starts its local MCP bridge.' },
    relativePath: ['blender', 'Blender.app'],
    localhostPort: 9876,
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    description: 'Local node-based image generation using ComfyUI.',
    enables: 'Run private image-generation workflows on this Mac.',
    download: 'About 250 MB',
    disk: 'About 1 GB before models',
    advanced: false,
    dependencies: [],
    approval: { required: true, summary: 'Downloads ComfyUI and runs a localhost-only service.' },
    relativePath: ['comfyui', 'main.py'],
    localhostPort: 8188,
  },
  {
    id: 'comfyui-model-pack',
    name: 'ComfyUI starter model pack',
    description: 'Optional local image models selected for general creative work.',
    enables: 'Generate images in ComfyUI without finding models separately.',
    download: 'About 7 GB',
    disk: 'About 8 GB',
    advanced: true,
    dependencies: ['comfyui'],
    approval: { required: true, summary: 'Downloads large model files from their publishers.' },
    relativePath: ['comfyui', 'models', '.rhythm-model-pack'],
  },
  {
    id: 'openmontage',
    name: 'OpenMontage',
    description: 'Local narration, captioning, asset review, and montage rendering.',
    enables: 'Build reviewable social-video drafts without cloud API keys.',
    download: 'About 500 MB',
    disk: 'About 1.5 GB',
    advanced: false,
    dependencies: ['media-tools'],
    approval: { required: true, summary: 'Downloads the OpenMontage runtime and local voice assets.' },
    relativePath: ['openmontage', '.venv', 'bin', 'python'],
  },
  {
    id: 'obsidian',
    name: 'Obsidian bridge',
    description: 'Local bridge to an Obsidian vault through its localhost API.',
    enables: 'Create and update approved notes and creative planning documents.',
    download: 'About 15 MB',
    disk: 'About 40 MB',
    advanced: true,
    dependencies: [],
    approval: { required: true, summary: 'Installs a local bridge; vault access still requires an API key.' },
    relativePath: ['bin', 'mcp-obsidian'],
    localhostPort: 27123,
  },
  {
    id: 'document-tools',
    name: 'Document tools',
    description: 'Local libraries for creating PDF, DOCX, spreadsheet, and presentation files.',
    enables: 'Produce editable office documents and print-ready PDFs.',
    download: 'About 200 MB',
    disk: 'About 600 MB',
    advanced: false,
    dependencies: [],
    approval: { required: true, summary: 'Downloads a managed Python environment and document libraries.' },
    relativePath: ['document-tools', '.venv', 'bin', 'python'],
  },
  {
    id: 'media-tools',
    name: 'Media tools',
    description: 'Local FFmpeg utilities for inspecting and converting audio and video.',
    enables: 'Transcode, validate, combine, and render local media files.',
    download: 'About 100 MB',
    disk: 'About 250 MB',
    advanced: false,
    dependencies: [],
    approval: { required: true, summary: 'Downloads managed FFmpeg media utilities.' },
    relativePath: ['bin', 'ffmpeg'],
  },
];

async function defaultTcpProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (healthy: boolean) => {
      socket.destroy();
      resolve(healthy);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

/** Lists install state without searching PATH, user folders, or non-local services. */
export async function listCreativeCapabilities(
  deps: CreativeCapabilityListDeps = {},
): Promise<CreativeCapability[]> {
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const tcpProbe = deps.tcpProbe ?? defaultTcpProbe;
  const root = join(
    deps.homeDir ?? homedir(),
    'Library',
    'Application Support',
    'Rhythm',
    'creative-tools',
  );

  return Promise.all(
    DEFINITIONS.map(async ({ relativePath, localhostPort, ...capability }) => {
      // The installer atomically writes this sentinel; the executable layout is
      // recipe-owned and may differ from the downloaded upstream archive.
      let status: CreativeCapabilityStatus = (existsSync(join(root, capability.id, '.rhythm-installed.json')) || existsSync(join(root, ...relativePath)))
        ? 'installed'
        : 'missing';
      if (status === 'installed' && localhostPort !== undefined) {
        status = (await tcpProbe('127.0.0.1', localhostPort)) ? 'installed' : 'unhealthy';
      }
      return { ...capability, status };
    }),
  );
}
