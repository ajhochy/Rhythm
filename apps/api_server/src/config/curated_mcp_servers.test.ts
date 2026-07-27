import { describe, expect, it, vi } from 'vitest';
import type { CuratedMcpServer } from './curated_mcp_servers';
import * as registry from './curated_mcp_servers';

type LoaderDeps = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
  warn: (message: string) => void;
};

type Loader = (
  path: string,
  deps: LoaderDeps,
) => CuratedMcpServer[];

type PathResolver = (options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => string;

function getLoader(): Loader {
  const loader = (
    registry as typeof registry & {
      loadLocalCuratedMcpServers?: Loader;
    }
  ).loadLocalCuratedMcpServers;
  expect(loader).toBeTypeOf('function');
  return loader!;
}

function getPathResolver(): PathResolver {
  const resolver = (
    registry as typeof registry & {
      resolveLocalCuratedMcpServersPath?: PathResolver;
    }
  ).resolveLocalCuratedMcpServersPath;
  expect(resolver).toBeTypeOf('function');
  return resolver!;
}

describe('loadLocalCuratedMcpServers', () => {
  it('returns an empty list when the sidecar is absent', () => {
    const readFileSync = vi.fn();
    const warn = vi.fn();

    expect(
      getLoader()('/tmp/curated.local.json', {
        existsSync: () => false,
        readFileSync,
        warn,
      }),
    ).toEqual([]);
    expect(readFileSync).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads valid local and remote server definitions', () => {
    const servers: CuratedMcpServer[] = [
      {
        id: 'personal-local',
        name: 'Personal Local',
        type: 'local',
        command: ['npx', '-y', 'personal-mcp'],
        requiredEnv: ['PERSONAL_API_KEY'],
      },
      {
        id: 'personal-remote',
        name: 'Personal Remote',
        type: 'remote',
        url: 'http://127.0.0.1:8787/mcp',
        requiredEnv: [],
      },
    ];

    expect(
      getLoader()('/tmp/curated.local.json', {
        existsSync: () => true,
        readFileSync: () => JSON.stringify(servers),
        warn: vi.fn(),
      }),
    ).toEqual(servers);
  });

  it('fails soft when the sidecar contains malformed JSON', () => {
    const warn = vi.fn();

    expect(
      getLoader()('/tmp/curated.local.json', {
        existsSync: () => true,
        readFileSync: () => '{not json',
        warn,
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/curated.local.json'),
    );
  });

  it('fails soft when the sidecar is not an array of valid definitions', () => {
    const warn = vi.fn();

    expect(
      getLoader()('/tmp/curated.local.json', {
        existsSync: () => true,
        readFileSync: () => JSON.stringify([{ id: 'missing-fields' }]),
        warn,
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('valid MCP server definitions'),
    );
  });
});

describe('resolveLocalCuratedMcpServersPath', () => {
  it('resolves from the api_server working directory by default', () => {
    expect(
      getPathResolver()({
        cwd: '/repo/apps/api_server',
        env: {},
      }),
    ).toBe(
      '/repo/apps/api_server/src/config/curated_mcp_servers.local.json',
    );
  });

  it('supports an explicit runtime path override', () => {
    expect(
      getPathResolver()({
        cwd: '/repo/apps/api_server',
        env: {
          RHYTHM_LOCAL_MCP_SERVERS_PATH: '/Users/me/.config/rhythm/mcps.json',
        },
      }),
    ).toBe('/Users/me/.config/rhythm/mcps.json');
  });
});

describe('managed creative MCP commands', () => {
  it('launches OpenMontage through its managed Python environment', () => {
    const server = registry.CURATED_MCP_SERVERS.find(
      ({ id }) => id === 'openmontage',
    );

    expect(server).toMatchObject({
      type: 'local',
      command: [
        expect.stringMatching(/openmontage\/\.venv\/bin\/python$/),
        expect.stringMatching(
          /openmontage\/openmontage-mcp\/openmontage_mcp_server\.py$/,
        ),
      ],
    });
  });
});
