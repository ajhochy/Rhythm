import { createHash } from 'node:crypto';
import type { CreativeCapabilityId } from './creative_capabilities';
import {
  COMFYUI_MODEL_FILENAME,
} from './creative_install_layout';

export const PYPI_INDEX = 'https://pypi.org/simple';
export const NPM_REGISTRY = 'https://registry.npmjs.org';
export const STABILITY_AI_COMMUNITY_LICENSE =
  'https://huggingface.co/stabilityai/sdxl-turbo/blob/main/LICENSE.md';

export interface CreativeInstallArtifact {
  filename: string;
  url: string;
  sha256: string;
}

export type CreativeInstallerKind =
  | 'blender'
  | 'comfyui'
  | 'comfyui-model-pack'
  | 'openmontage'
  | 'obsidian'
  | 'document-tools'
  | 'media-tools';

export interface CreativeInstallRecipe {
  id: CreativeCapabilityId;
  version: string;
  installer: CreativeInstallerKind;
  artifacts: readonly CreativeInstallArtifact[];
  commit?: string;
  /** A license acknowledgement is deliberately separate from an install approval. */
  requiresModelLicense?: true;
  awaitingUser?: string;
}

export const UV_ARTIFACT: CreativeInstallArtifact =
  process.arch === 'arm64'
    ? {
        filename: 'uv-aarch64-apple-darwin-0.11.32.tar.gz',
        url: 'https://github.com/astral-sh/uv/releases/download/0.11.32/uv-aarch64-apple-darwin.tar.gz',
        sha256: 'ed336d0ba49db8ef89b2b41fffa372ce63bd032f22a56f001c265891aec32829',
      }
    : {
        filename: 'uv-x86_64-apple-darwin-0.11.32.tar.gz',
        url: 'https://github.com/astral-sh/uv/releases/download/0.11.32/uv-x86_64-apple-darwin.tar.gz',
        sha256: '77f5ca26c0de20e992a3677a174fe1121ee25c36f9b1434a863f75bf077a05eb',
      };

export const NPM_ARTIFACT: CreativeInstallArtifact = {
  filename: 'npm-11.11.0.tgz',
  url: 'https://registry.npmjs.org/npm/-/npm-11.11.0.tgz',
  sha256: 'cbcf4cc03148ccdb586a8bf2093c952f093fb43d5cbc97593c98b67ef8c003b0',
};

// One source of truth for every direct artifact disclosed to the user and
// downloaded by the installer. Any URL or checksum change changes planDigest.
export const CREATIVE_INSTALL_RECIPES: Readonly<
  Record<CreativeCapabilityId, CreativeInstallRecipe>
> = {
  blender: {
    id: 'blender',
    version: '5.2.0+mcp-1.6.0-r4',
    installer: 'blender',
    artifacts: [
      {
        filename: 'blender.dmg',
        url: 'https://mirrors.ocf.berkeley.edu/blender/release/Blender5.2/blender-5.2.0-macos-arm64.dmg',
        sha256: 'ed4d8390166dec5ea0a2813a03db6221f206ce016442be7f59f41d760972568a',
      },
      {
        filename: 'blender_mcp_addon.py',
        url: 'https://raw.githubusercontent.com/ahujasid/blender-mcp/494fb5bba603fb650f20c507adce994dffbd6dae/addon.py',
        sha256: 'd43484fcd9a4a33f1561ab69676f5d33d0aa7c649d5e2f5fd34ddd78615ee734',
      },
      UV_ARTIFACT,
    ],
    awaitingUser:
      'Open Blender once, install and enable the Blender MCP add-on, then start its local bridge.',
  },
  comfyui: {
    id: 'comfyui',
    version: '2026-07-24+mcp-1.0.1',
    commit: '36aec0d086f7321d253cde71b4f3b08f63e35d8f',
    installer: 'comfyui',
    artifacts: [
      {
        filename: 'comfyui.tar.gz',
        url: 'https://github.com/Comfy-Org/ComfyUI/archive/36aec0d086f7321d253cde71b4f3b08f63e35d8f.tar.gz',
        sha256: 'b8050b7dd0995995befd5f5221a9e81bfdbcae8d54f46dbdf78cbb694bc9bc73',
      },
      UV_ARTIFACT,
      NPM_ARTIFACT,
    ],
    awaitingUser:
      'Start ComfyUI with its managed Python environment, then verify the localhost service.',
  },
  'comfyui-model-pack': {
    id: 'comfyui-model-pack',
    version: '1.0.0',
    installer: 'comfyui-model-pack',
    artifacts: [
      {
        filename: COMFYUI_MODEL_FILENAME,
        url: 'https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors',
        sha256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26',
      },
    ],
    requiresModelLicense: true,
    awaitingUser:
      'Accept the model publisher license in the setup UI before this download can start.',
  },
  openmontage: {
    id: 'openmontage',
    version: '2026-07-24',
    commit: 'c36e41223e819441748817105635ac4036d41b10',
    installer: 'openmontage',
    artifacts: [
      {
        filename: 'openmontage.tar.gz',
        url: 'https://github.com/calesthio/OpenMontage/archive/c36e41223e819441748817105635ac4036d41b10.tar.gz',
        sha256: '1d75cf672df2605a71933a69327472b9a1fd097b16abf5e4d2ee7f1270ded524',
      },
      UV_ARTIFACT,
      NPM_ARTIFACT,
    ],
  },
  obsidian: {
    id: 'obsidian',
    version: '0.2.2-r2',
    installer: 'obsidian',
    artifacts: [UV_ARTIFACT],
    awaitingUser:
      'Open Obsidian, enable the Local REST API plugin, and enter its API key in Rhythm.',
  },
  'document-tools': {
    id: 'document-tools',
    version: '2026.7.26',
    installer: 'document-tools',
    artifacts: [UV_ARTIFACT],
  },
  'media-tools': {
    id: 'media-tools',
    version: '5.3.0',
    installer: 'media-tools',
    artifacts: [NPM_ARTIFACT],
  },
};

export interface CreativeDirectDependency {
  name: string;
  version: string;
  purpose: string;
  source: string;
  license: string;
}

export interface CreativeSetupPlan {
  planDigest: string;
  installLocation: 'Rhythm managed application storage';
  requirements: string[];
  dependencies: CreativeDirectDependency[];
  verifiedArtifacts: CreativeInstallArtifact[];
  download: string;
  disk: string;
  trust: {
    transitiveSource: string;
    hashVerification: true;
    buildScripts: false;
    policy: string;
  };
  removal: string;
  additionalLicenseAcceptance?: {
    required: true;
    license: string;
    url: string;
  };
}

interface CreativeSetupPlanDefinition {
  requirements: string[];
  dependencies: CreativeDirectDependency[];
  download: string;
  disk: string;
  transitiveSource: string;
  additionalLicenseAcceptance?: CreativeSetupPlan['additionalLicenseAcceptance'];
}

const dependency = (
  name: string,
  version: string,
  purpose: string,
  source: string,
  license: string,
): CreativeDirectDependency => ({ name, version, purpose, source, license });

const UV = dependency(
  'uv',
  '0.11.32',
  'Creates Rhythm’s isolated Python environment and resolves its locked packages.',
  'https://github.com/astral-sh/uv/releases/tag/0.11.32',
  'Apache-2.0 OR MIT',
);
const NPM = dependency(
  'npm',
  '11.11.0',
  'Creates and verifies the isolated Node package lock and cache.',
  'https://registry.npmjs.org/npm/-/npm-11.11.0.tgz',
  'Artistic-2.0',
);

const DEFINITIONS: Readonly<Record<CreativeCapabilityId, CreativeSetupPlanDefinition>> =
  {
    blender: {
      requirements: [
        'Blender for local 3D creation and rendering.',
        'A local Blender bridge so Rhythm can control only the managed Blender copy.',
      ],
      dependencies: [
        dependency(
          'Blender',
          '5.2.0',
          'Creates, animates, and renders 3D scenes locally.',
          'https://www.blender.org/download/releases/5-2/',
          'GPL-2.0-or-later',
        ),
        dependency(
          'blender-mcp',
          '1.6.0',
          'Connects Rhythm to Blender’s local add-on.',
          'https://pypi.org/project/blender-mcp/1.6.0/',
          'MIT',
        ),
        UV,
      ],
      download: 'About 350 MB',
      disk: 'About 1.5 GB',
      transitiveSource: PYPI_INDEX,
    },
    comfyui: {
      requirements: [
        'ComfyUI at a fixed reviewed source revision.',
        'A local bridge that lets Rhythm submit workflows to the localhost service.',
      ],
      dependencies: [
        dependency(
          'ComfyUI',
          '36aec0d086f7321d253cde71b4f3b08f63e35d8f',
          'Runs private node-based image workflows on this Mac.',
          'https://github.com/Comfy-Org/ComfyUI/commit/36aec0d086f7321d253cde71b4f3b08f63e35d8f',
          'GPL-3.0',
        ),
        dependency(
          '@peleke.s/comfyui-mcp',
          '1.0.1',
          'Connects Rhythm to the local ComfyUI service.',
          'https://www.npmjs.com/package/@peleke.s/comfyui-mcp/v/1.0.1',
          'MIT',
        ),
        UV,
        NPM,
      ],
      download: 'About 250 MB',
      disk: 'About 1 GB before models',
      transitiveSource: `${PYPI_INDEX} and ${NPM_REGISTRY}`,
    },
    'comfyui-model-pack': {
      requirements: [
        'The optional SDXL Turbo starter model after ComfyUI is installed.',
      ],
      dependencies: [
        dependency(
          'SDXL Turbo',
          '1.0 fp16',
          'Provides the local image-generation model weights.',
          'https://huggingface.co/stabilityai/sdxl-turbo',
          'Stability AI Community License',
        ),
      ],
      download: 'About 7 GB',
      disk: 'About 8 GB',
      transitiveSource: 'No transitive packages',
      additionalLicenseAcceptance: {
        required: true,
        license: 'Stability AI Community License',
        url: STABILITY_AI_COMMUNITY_LICENSE,
      },
    },
    openmontage: {
      requirements: [
        'OpenMontage at a fixed reviewed source revision.',
        'Its Python and Node dependencies in separate Rhythm-managed environments.',
      ],
      dependencies: [
        dependency(
          'OpenMontage',
          'c36e41223e819441748817105635ac4036d41b10',
          'Creates narration, captions, and reviewable montage drafts locally.',
          'https://github.com/calesthio/OpenMontage/commit/c36e41223e819441748817105635ac4036d41b10',
          'AGPL-3.0',
        ),
        UV,
        NPM,
      ],
      download: 'About 500 MB',
      disk: 'About 1.5 GB',
      transitiveSource: `${PYPI_INDEX} and ${NPM_REGISTRY}`,
    },
    obsidian: {
      requirements: [
        'A local bridge to Obsidian’s Local REST API plugin.',
        'An Obsidian API key, supplied separately after installation.',
      ],
      dependencies: [
        dependency(
          'mcp-obsidian',
          '0.2.2',
          'Connects Rhythm to Obsidian through the localhost REST API.',
          'https://pypi.org/project/mcp-obsidian/0.2.2/',
          'MIT',
        ),
        UV,
      ],
      download: 'About 15 MB',
      disk: 'About 40 MB',
      transitiveSource: PYPI_INDEX,
    },
    'document-tools': {
      requirements: [
        'Six local Python libraries for presentations, documents, spreadsheets, and PDFs.',
        'A private Python environment used only by Rhythm creative tools.',
      ],
      dependencies: [
        dependency(
          'python-pptx',
          '1.0.2',
          'Creates and edits PowerPoint presentations.',
          'https://pypi.org/project/python-pptx/1.0.2/',
          'MIT',
        ),
        dependency(
          'python-docx',
          '1.2.0',
          'Creates and edits Word documents.',
          'https://pypi.org/project/python-docx/1.2.0/',
          'MIT',
        ),
        dependency(
          'openpyxl',
          '3.1.5',
          'Creates and edits Excel workbooks.',
          'https://pypi.org/project/openpyxl/3.1.5/',
          'MIT',
        ),
        dependency(
          'reportlab',
          '4.4.3',
          'Generates print-ready PDF files.',
          'https://pypi.org/project/reportlab/4.4.3/',
          'BSD-3-Clause',
        ),
        dependency(
          'pypdf',
          '6.0.0',
          'Reads, combines, and validates PDF files.',
          'https://pypi.org/project/pypdf/6.0.0/',
          'BSD-3-Clause',
        ),
        dependency(
          'pdfplumber',
          '0.11.7',
          'Extracts text and tables from PDF files.',
          'https://pypi.org/project/pdfplumber/0.11.7/',
          'MIT',
        ),
        UV,
      ],
      download: 'About 200 MB',
      disk: 'About 600 MB',
      transitiveSource: PYPI_INDEX,
    },
    'media-tools': {
      requirements: [
        'A fixed FFmpeg binary package for local audio and video work.',
        'An isolated Node package cache used only during verified installation.',
      ],
      dependencies: [
        dependency(
          'ffmpeg-static',
          '5.3.0',
          'Provides the local FFmpeg executable for inspecting and converting media.',
          'https://www.npmjs.com/package/ffmpeg-static/v/5.3.0',
          'GPL-3.0-or-later',
        ),
        NPM,
      ],
      download: 'About 100 MB',
      disk: 'About 250 MB',
      transitiveSource: NPM_REGISTRY,
    },
  };

export function creativeSetupPlanDigest(
  plan: Omit<CreativeSetupPlan, 'planDigest'>,
): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export function creativeSetupPlan(id: CreativeCapabilityId): CreativeSetupPlan {
  const definition = DEFINITIONS[id];
  const plan: Omit<CreativeSetupPlan, 'planDigest'> = {
    installLocation: 'Rhythm managed application storage',
    requirements: [...definition.requirements],
    dependencies: definition.dependencies.map((item) => ({ ...item })),
    verifiedArtifacts: CREATIVE_INSTALL_RECIPES[id].artifacts.map((item) => ({
      ...item,
    })),
    download: definition.download,
    disk: definition.disk,
    trust: {
      transitiveSource: definition.transitiveSource,
      hashVerification: true,
      buildScripts: false,
      policy:
        'Rhythm accepts only the disclosed registries, pins direct versions, creates a complete integrity lock, rejects Python source builds, disables package lifecycle scripts, and verifies the lock again during installation.',
    },
    removal:
      'Repair and uninstall require separate approval and can change only this capability inside Rhythm managed application storage.',
    ...(definition.additionalLicenseAcceptance
      ? { additionalLicenseAcceptance: { ...definition.additionalLicenseAcceptance } }
      : {}),
  };
  return { planDigest: creativeSetupPlanDigest(plan), ...plan };
}

/**
 * Retained as an install-availability seam for focused tests. The guided
 * installer now creates verified locks at install time rather than requiring
 * repository-vendored dependency bundles.
 */
export const CREATIVE_DEPENDENCY_BUNDLES = Object.freeze(
  Object.fromEntries(
    Object.keys(DEFINITIONS).map((id) => [id, { complete: true }]),
  ) as Record<CreativeCapabilityId, { complete: true }>,
);
