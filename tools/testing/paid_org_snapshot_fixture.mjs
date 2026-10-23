// Guards ported from packaged-ai-private-org-evaluation-actual-snapshot.spec.ts.
// This module never opens the source application DB; it reads only an explicitly pinned snapshot.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readQualificationFixture } from './qualification_fixture.mjs';
import { digestArtifact } from './web_paid_custody.mjs';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const seedFields = {
    label: 'label', icon: 'icon', enabled: 'enabled', isAgent: 'is_agent',
    isManager: 'is_manager', systemPrompt: 'system_prompt', allowedMcpsJson: 'allowed_mcps_json',
    allowedSkillsJson: 'allowed_skills_json', corePermissionsJson: 'core_permissions_json',
    allowedDelegatesJson: 'allowed_delegates_json', modelProvider: 'model_provider',
    modelId: 'model_id', ocAgent: 'oc_agent', sessionSelectable: 'session_selectable',
    schedulable: 'schedulable', reasoningEffort: 'reasoning_effort',
    autoApproveActions: 'auto_approve_actions',
};
export function skillSlug(name) {
    if (!name || name === '.' || name === '..' || name.includes('..') || /[\\/]/.test(name))
        throw new Error('Managed skill snapshot name is unsafe');
    return name.trim().replace(/[^a-zA-Z0-9_-]+/g, '__');
}
function seedManagedSkills(snapshot, sourceConfigRoot) {
    const root = join(sourceConfigRoot, 'skills');
    for (const dependency of snapshot.managedSkillDependencies) {
        const destination = join(root, skillSlug(dependency.name), 'SKILL.md');
        if (dependency.state === 'absent') {
            if (existsSync(destination))
                throw new Error('Absent source skill appeared in private fixture');
            continue;
        }
        const bytes = Buffer.from(dependency.bytesBase64, 'base64');
        mkdirSync(join(root, skillSlug(dependency.name)), { recursive: true, mode: 0o700 });
        writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
        if (sha256(readFileSync(destination)) !== dependency.sha256)
            throw new Error('Private managed skill differs from pinned source bytes');
    }
}
function seedActualProfiles(snapshot, seedPath, selectedProfileIds) {
    const source = new Map(snapshot.tables.agent_configs.map(row => [String(row.id), row]));
    const original = JSON.parse(readFileSync(seedPath, 'utf8'));
    if (!Array.isArray(original.profiles) || original.profiles.some(row => !['secretary', 'workflow-orchestrator',
        'coding-agent', 'verification-gate'].includes(row.id)))
        throw new Error('Only the untouched owned qualification profile seed may be replaced');
    // The Reviewer may inspect the complete copied catalog, but this run only
    // executes selected case profiles. Startup migrations of unrelated agents
    // must not be mistaken for changes to the selected original behavior.
    const projected = new Set(selectedProfileIds);
    const dependencies = [...projected].flatMap(id => {
        const profile = source.get(id);
        const parsed = JSON.parse(String(profile?.allowed_delegates_json ?? '[]'));
        if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string'))
            throw new Error('Actual delegate catalog is malformed');
        return parsed;
    });
    if ([...projected].some(id => !source.has(id)))
        throw new Error('A selected actual profile is absent from the snapshot');
    const profiles = [...projected].map(id => {
        const row = source.get(id);
        const values = { id, revision: row.revision };
        for (const [camel, snake] of Object.entries(seedFields)) {
            const value = row[snake];
            values[camel] = ['enabled', 'isAgent', 'isManager', 'sessionSelectable', 'autoApproveActions'].includes(camel)
                ? Boolean(value) : camel === 'schedulable' && value !== null ? Boolean(value) : value;
        }
        if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1)
            throw new Error('Actual profile revision cannot be projected');
        return values;
    });
    writeFileSync(seedPath, JSON.stringify({ profiles }, null, 2) + '\n', { mode: 0o600 });
    return { projectedIds: [...projected], unprojectedDependencies: [...new Set(dependencies)].filter(id => !projected.has(id)) };
}
export function readPaidOrgSnapshot(path, expectedSha, ownerUserId) {
    if (!path.startsWith('/private/tmp/') || resolve(path) !== path || realpathSync(path) !== path)
        throw new Error('Actual review snapshot must be an exact private canonical path');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
        throw new Error('Actual review snapshot is not one private owned ordinary file');
    const bytes = readFileSync(path);
    if (!/^[a-f0-9]{64}$/.test(expectedSha) || sha256(bytes) !== expectedSha)
        throw new Error('Actual review snapshot differs from operator-pinned SHA-256');
    const value = JSON.parse(bytes.toString('utf8'));
    if (value.schemaVersion !== 1 || value.sourceKind !== 'actual-electron-owner-snapshot' ||
        value.sourceReadOnly !== true || value.sourceOwnerUserId !== ownerUserId ||
        value.sourcePath === path || value.windowDays !== 14 ||
        !Array.isArray(value.provenance) || !Array.isArray(value.excludedControlProfiles) ||
        !Array.isArray(value.managedSkillDependencies) ||
        !Array.isArray(value.omissions) || !Number.isFinite(Date.parse(value.capturedAt)))
        throw new Error('Actual review snapshot provenance or owner differs from fixture');
    const names = ['agent_configs', 'agent_sessions', 'agent_session_messages',
        'agent_scheduled_tasks', 'agent_skills', 'agent_cookbook'];
    if (Object.keys(value.tables ?? {}).sort().join(',') !== [...names].sort().join(',') ||
        names.some(name => !Array.isArray(value.tables[name])))
        throw new Error('Actual review snapshot contains an unexpected table collection');
    const profiles = new Set(value.tables.agent_configs.map(row => String(row.id)));
    const sessions = new Map(value.tables.agent_sessions.map(row => [String(row.id), row]));
    if (profiles.size !== value.tables.agent_configs.length || sessions.size !== value.tables.agent_sessions.length ||
        value.tables.agent_configs.some(row => value.excludedControlProfiles.includes(String(row.id))) ||
        value.tables.agent_sessions.some(row => row.owner_user_id !== null && row.owner_user_id !== ownerUserId ||
            !profiles.has(String(row.profile_id)) || row.cwd !== '__QUALIFICATION_WORKSPACE__' ||
            row.sdk_session_id !== null || row.session_token !== null || row.worktree_path !== null) ||
        value.tables.agent_session_messages.some(row => !sessions.has(String(row.session_id))) ||
        value.tables.agent_scheduled_tasks.some(row => row.created_by_user_id !== null && row.created_by_user_id !== ownerUserId) ||
        value.tables.agent_cookbook.some(row => row.owner_user_id !== null && row.owner_user_id !== ownerUserId))
        throw new Error('Actual review snapshot contains a foreign owner or live execution handle');
    const allowedNames = new Set();
    for (const profile of value.tables.agent_configs) {
        if (profile.allowed_skills_json === null)
            continue;
        const names = JSON.parse(String(profile.allowed_skills_json));
        if (!Array.isArray(names) || names.some(name => typeof name !== 'string'))
            throw new Error('Actual managed skill scope is malformed');
        for (const name of names)
            allowedNames.add(name);
    }
    if (value.managedSkillDependencies.length !== allowedNames.size ||
        value.managedSkillDependencies.length > 512 ||
        new Set(value.managedSkillDependencies.map(item => item.name)).size !== allowedNames.size)
        throw new Error('Managed skill source inventory is incomplete');
    if (new Set(value.managedSkillDependencies.map(item => skillSlug(item.name))).size !== allowedNames.size)
        throw new Error('Managed skill names collide at the private engine path');
    for (const dependency of value.managedSkillDependencies) {
        skillSlug(dependency.name);
        if (!allowedNames.has(dependency.name))
            throw new Error('Unexpected managed skill dependency');
        if (dependency.state === 'absent') {
            if (dependency.sha256 !== undefined || dependency.bytesBase64 !== undefined)
                throw new Error('Absent managed skill claims file bytes');
        }
        else if (dependency.state === 'present') {
            if (!/^[a-f0-9]{64}$/.test(dependency.sha256 ?? '') ||
                typeof dependency.bytesBase64 !== 'string' ||
                Buffer.from(dependency.bytesBase64, 'base64').toString('base64') !== dependency.bytesBase64 ||
                sha256(Buffer.from(dependency.bytesBase64, 'base64')) !== dependency.sha256)
                throw new Error('Managed skill bytes or digest differ from source receipt');
        }
        else
            throw new Error('Managed skill source state is invalid');
    }
    for (const provenance of value.provenance) {
        const session = sessions.get(provenance.sessionId);
        if (!session || session.profile_id !== provenance.profileId ||
            session.status !== provenance.sourceStatus || session.created_at !== provenance.sourceCreatedAt ||
            !['failure', 'counterexample'].includes(provenance.selectionRole) ||
            value.tables.agent_session_messages.filter(row => row.session_id === provenance.sessionId).length !== provenance.sourceMessageCount)
            throw new Error('Actual review session provenance differs from captured evidence rows');
    }
    return value;
}
/** Preboot only. The fixed runner calls this before DB creation, config sealing or a model loan. */
export function preparePaidOrgSnapshot({ manifestPath, sourceRevision, sourceConfigRoot, snapshotPath, snapshotSha256, profileIds }) {
    if (!Array.isArray(profileIds) || !profileIds.length || new Set(profileIds).size !== profileIds.length ||
        profileIds.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim()))
        throw new Error('Explicit unique captured profile IDs are required');
    const { manifest } = readQualificationFixture(manifestPath, sourceRevision);
    if (!manifest.profileSeedPath || existsSync(manifest.dbPath) || manifest.syntheticActor?.modelLoan)
        throw new Error('Actual profile seed must precede DB bootstrap and model loan');
    if (!sourceConfigRoot.startsWith('/private/tmp/') || resolve(sourceConfigRoot) !== sourceConfigRoot ||
        realpathSync(sourceConfigRoot) !== sourceConfigRoot || dirname(sourceConfigRoot) !== '/private/tmp' ||
        sourceConfigRoot === manifest.fixtureRoot)
        throw new Error('Actual source config requires a separate canonical private temp root');
    const configStat = lstatSync(sourceConfigRoot);
    if (!configStat.isDirectory() || configStat.isSymbolicLink() || configStat.uid !== process.getuid?.() ||
        (configStat.mode & 0o777) !== 0o700 || readdirSync(sourceConfigRoot).length !== 0)
        throw new Error('Actual source config requires a new empty private owned directory');
    const snapshot = readPaidOrgSnapshot(snapshotPath, snapshotSha256, manifest.ownerUserId);
    const captured = new Set(snapshot.provenance.map(item => item.profileId));
    if (profileIds.some(id => !captured.has(id)))
        throw new Error('Selected case profiles must be exact captured IDs');
    const seedPlan = seedActualProfiles(snapshot, manifest.profileSeedPath, profileIds);
    mkdirSync(join(sourceConfigRoot, 'skills'), { mode: 0o700 });
    seedManagedSkills(snapshot, sourceConfigRoot);
    // Revalidate both authority inputs after projection; never return a receipt for changed source bytes.
    readPaidOrgSnapshot(snapshotPath, snapshotSha256, manifest.ownerUserId);
    readQualificationFixture(manifestPath, sourceRevision);
    if (existsSync(manifest.dbPath))
        throw new Error('Actual profile seed crossed DB bootstrap');
    return { schemaVersion: 1, kind: 'web-paid-org-seed-v1', sourceRevision,
        fixtureRoot: manifest.fixtureRoot, manifestPath, profileSeedPath: manifest.profileSeedPath,
        profileSeedSha256: sha256(readFileSync(manifest.profileSeedPath)), sourceConfigRoot,
        managedSkillsSha256: digestArtifact(join(sourceConfigRoot, 'skills')), snapshotSha256,
        profileIds: [...profileIds], projectedProfileIds: seedPlan.projectedIds,
        unprojectedDependencyIds: seedPlan.unprojectedDependencies };
}
