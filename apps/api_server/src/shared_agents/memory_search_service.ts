import { createHash, createHmac } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryVaultPath } from '../config/env';
import {
  AgentMemoryRepository,
  type AgentMemory,
} from '../repositories/agent_memory_repository';
import {
  MEMORY_VAULT_SOURCE,
  parseNote,
} from '../services/memoryVaultSyncService';
import type { BridgeGrant } from './bridge_grants';

const MAX_NOTE_BYTES = 256 * 1024;
const MAX_TITLE_CHARACTERS = 120;
const MAX_SNIPPET_CHARACTERS = 500;

type MemoryRepository = Pick<AgentMemoryRepository, 'searchAsync'>;
type FileSystem = Pick<
  typeof fs,
  'lstat' | 'open' | 'realpath' | 'stat'
>;

export interface MemorySearchResultV1 {
  ref: string;
  kind: string;
  title: string | null;
  snippet: string;
  staleAfter: string | null;
  trustTier: 'verified' | null;
}

export interface MemorySearchResponseV1 {
  schema: 'rhythm.memory-search.v1';
  untrusted: true;
  results: MemorySearchResultV1[];
  omitted: {
    stale: number;
    unreadable: number;
  };
}

interface VaultIdentity {
  id: string;
  root: string;
}

export class MemoryVaultChangedError extends Error {
  constructor() {
    super('memory_vault_changed');
    this.name = 'MemoryVaultChangedError';
  }
}

async function resolveVaultIdentity(
  vaultPath: string,
  fileSystem: FileSystem,
): Promise<VaultIdentity | null> {
  try {
    const root = await fileSystem.realpath(vaultPath);
    const stat = await fileSystem.stat(root);
    if (!stat.isDirectory()) return null;
    return {
      id: createHash('sha256')
        .update(`${root}:${String(stat.dev)}:${String(stat.ino)}`)
        .digest('hex'),
      root,
    };
  } catch {
    return null;
  }
}

export async function computeMemoryVaultId(
  vaultPath = resolveMemoryVaultPath(),
  fileSystem: FileSystem = fs,
): Promise<string | null> {
  return (await resolveVaultIdentity(vaultPath, fileSystem))?.id ?? null;
}

function safeRelativeSegments(sourceId: string): string[] | null {
  if (
    sourceId.length === 0
    || sourceId.includes('\0')
    || sourceId.includes('\\')
    || path.isAbsolute(sourceId)
  ) {
    return null;
  }
  const segments = sourceId.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return segments;
}

/**
 * Read a vault note without following symlinks or trusting a path-based stat.
 * `null` deliberately conflates every rejection so callers cannot probe paths.
 */
export async function readVaultNoteSafely(
  canonicalRoot: string,
  sourceId: string,
  fileSystem: FileSystem = fs,
): Promise<string | null> {
  const segments = safeRelativeSegments(sourceId);
  if (!segments) return null;

  const absolute = path.resolve(canonicalRoot, ...segments);
  const relative = path.relative(canonicalRoot, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return null;
  }

  try {
    let cursor = canonicalRoot;
    let finalLstat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const stat = await fileSystem.lstat(cursor);
      if (stat.isSymbolicLink()) return null;
      if (index < segments.length - 1) {
        if (!stat.isDirectory()) return null;
      } else {
        finalLstat = stat;
      }
    }

    if (
      !finalLstat
      || !finalLstat.isFile()
      || finalLstat.size > MAX_NOTE_BYTES
    ) {
      return null;
    }

    const handle = await fileSystem.open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile()
        || openedStat.size > MAX_NOTE_BYTES
        || openedStat.dev !== finalLstat.dev
        || openedStat.ino !== finalLstat.ino
      ) {
        return null;
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_NOTE_BYTES) return null;
      return bytes.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function opaqueReference(grant: BridgeGrant, rowId: string): string {
  return createHmac('sha256', grant.refKey)
    .update(rowId)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

function firstHeading(body: string): string | null {
  const heading = /^# ([^\r\n]+)$/m.exec(body)?.[1]?.trim();
  return heading ? heading.slice(0, MAX_TITLE_CHARACTERS) : null;
}

function toResult(
  grant: BridgeGrant,
  memory: AgentMemory,
  body: string,
): MemorySearchResultV1 {
  return {
    ref: opaqueReference(grant, memory.id),
    kind: memory.kind,
    title: firstHeading(body),
    snippet: body.slice(0, MAX_SNIPPET_CHARACTERS),
    staleAfter: memory.staleAfter,
    trustTier: memory.trustTier === 'human' ? 'verified' : null,
  };
}

export class MemorySearchService {
  constructor(
    private readonly repository: MemoryRepository = new AgentMemoryRepository(),
    private readonly vaultPath: () => string = resolveMemoryVaultPath,
    private readonly fileSystem: FileSystem = fs,
  ) {}

  async search(
    grant: BridgeGrant,
    query: string,
    limit: number,
  ): Promise<MemorySearchResponseV1> {
    const identity = await resolveVaultIdentity(this.vaultPath(), this.fileSystem);
    if (
      !identity
      || !grant.memoryVaultId
      || identity.id !== grant.memoryVaultId
    ) {
      grant.scopes.delete('memory.search');
      throw new MemoryVaultChangedError();
    }

    const candidates = await this.repository.searchAsync(
      query,
      grant.localUserId,
      limit * 3,
      { activeOnly: true },
    );
    const results: MemorySearchResultV1[] = [];
    const omitted = { stale: 0, unreadable: 0 };

    for (const memory of candidates) {
      if (memory.source !== MEMORY_VAULT_SOURCE || !memory.sourceId) continue;
      const raw = await readVaultNoteSafely(
        identity.root,
        memory.sourceId,
        this.fileSystem,
      );
      if (raw === null) {
        omitted.unreadable += 1;
        continue;
      }

      const body = parseNote(raw).content;
      if (body !== memory.content) {
        omitted.stale += 1;
        continue;
      }
      if (results.length < limit) {
        results.push(toResult(grant, memory, body));
      }
    }

    return {
      schema: 'rhythm.memory-search.v1',
      untrusted: true,
      results,
      omitted,
    };
  }
}
