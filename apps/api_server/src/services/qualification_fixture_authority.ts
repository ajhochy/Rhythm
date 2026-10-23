import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface QualificationFixtureAuthority {
  schemaVersion: 1; ownerId: string; ownerUserId: number; fixtureRoot: string;
  dbPath: string; sourceRevision: string; tokenSha256: string;
  publicUserSeed: {id:number;name:string;email:string;googleSub:string;timezone:string};
  profileSeedPath?: string;
  syntheticActor?: { tokenPath: string; expiresAt: string; modelLoan?: QualificationModelLoan };
}
type QualificationModelLoan = {
  accountPath: string; accountProjectionSha256: string; selectorSha256: string;
  issuedAt: number; expires: number; stopAt: number;
} & ({ provider: 'anthropic' } | {
  provider?: never; decisionPath: string; decisionSha256: string; gridPath: string; gridSha256: string;
});
const loanUnavailable = () => new Error('Qualification model loan unavailable');
const loanHash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const canonicalLoan = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function privateLoanBytes(file: string): Buffer {
  try {
    const st = lstatSync(file);
    if (realpathSync(file) !== file || !st.isFile() || st.isSymbolicLink() || st.nlink !== 1
      || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) throw loanUnavailable();
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd), bytes = readFileSync(fd), after = fstatSync(fd);
      const final = lstatSync(file);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode
        || !final.isFile() || final.isSymbolicLink() || final.nlink !== 1 || final.uid !== process.getuid?.()
        || (final.mode & 0o777) !== 0o600 || before.dev !== final.dev || before.ino !== final.ino
        || before.size !== final.size || before.mtimeMs !== final.mtimeMs || before.mode !== final.mode)
        throw loanUnavailable();
      return bytes;
    } finally { closeSync(fd); }
  } catch { throw loanUnavailable(); }
}
/** Recheck the exact private credential projection and deadline on each authority read. */
export function assertQualificationModelLoan(m: Pick<QualificationFixtureAuthority, 'fixtureRoot' | 'syntheticActor'>,
  now = Date.now()): QualificationModelLoan | null {
  const loan = m.syntheticActor?.modelLoan;
  if (!loan) return null;
  if (loan.provider === 'anthropic') {
    if (loan.accountPath !== join(m.fixtureRoot, 'anthropic-accounts.json')
      || Object.keys(loan).some(key => !['provider', 'accountPath', 'accountProjectionSha256',
        'selectorSha256', 'issuedAt', 'expires', 'stopAt'].includes(key))
      || ![loan.accountProjectionSha256, loan.selectorSha256].every(v => /^[a-f0-9]{64}$/.test(v))
      || !Number.isSafeInteger(loan.issuedAt) || !Number.isSafeInteger(loan.expires)
      || !Number.isSafeInteger(loan.stopAt) || loan.issuedAt > now || loan.stopAt <= loan.issuedAt
      || loan.stopAt > loan.issuedAt + 10 * 60_000 || loan.stopAt > loan.expires - 20 * 60_000
      || now >= loan.stopAt) throw loanUnavailable();
    let file: Record<string, unknown>;
    try { file = JSON.parse(privateLoanBytes(loan.accountPath).toString('utf8')) as Record<string, unknown>; }
    catch { throw loanUnavailable(); }
    if (file.version !== 1 || !Array.isArray(file.accounts) || file.accounts.length !== 1
      || file.defaultAccountId !== 'qualification-model'
      || Object.keys(file).some(key => !['version', 'accounts', 'defaultAccountId', 'routing', 'pinned'].includes(key))
      || !file.routing || typeof file.routing !== 'object' || Array.isArray(file.routing)
      || !file.pinned || typeof file.pinned !== 'object' || Array.isArray(file.pinned)
      || Object.values(file.routing).some(id => id !== 'qualification-model')
      || Object.values(file.pinned).some(pinned => pinned !== true)) throw loanUnavailable();
    const account = file.accounts[0] as Record<string, unknown>;
    if (!account || Object.keys(account).some(key => !['id', 'label', 'access', 'refresh', 'expires', 'status'].includes(key))
      || account.id !== 'qualification-model' || account.label !== '[smoke] selected model'
      || typeof account.access !== 'string' || !account.access || account.refresh !== ''
      || account.status !== 'ok' || account.expires !== loan.expires
      || loanHash(canonicalLoan(account)) !== loan.accountProjectionSha256) throw loanUnavailable();
    return loan;
  }
  if (loan.provider !== undefined) throw loanUnavailable();
  if (loan.accountPath !== join(m.fixtureRoot, 'openai-accounts.json')
    || loan.decisionPath !== join(m.fixtureRoot, 'decision-router.json')
    || loan.gridPath !== join(m.fixtureRoot, 'router-grid.json')
    || ![loan.accountProjectionSha256, loan.decisionSha256, loan.gridSha256, loan.selectorSha256].every(v => /^[a-f0-9]{64}$/.test(v))
    || !Number.isSafeInteger(loan.issuedAt) || !Number.isSafeInteger(loan.expires) || !Number.isSafeInteger(loan.stopAt)
    || loan.issuedAt > now || loan.stopAt <= loan.issuedAt
    || loan.stopAt > loan.issuedAt + 10 * 60_000 || loan.stopAt > loan.expires - 20 * 60_000
    || now >= loan.stopAt) throw loanUnavailable();
  let file: Record<string, unknown>;
  try { file = JSON.parse(privateLoanBytes(loan.accountPath).toString('utf8')) as Record<string, unknown>; }
  catch { throw loanUnavailable(); }
  if (file.version !== 1 || !Array.isArray(file.accounts) || file.accounts.length !== 1
    || file.defaultAccountId !== 'qualification-model'
    || Object.keys(file).some(key => !['version', 'accounts', 'defaultAccountId', 'routing', 'pinned'].includes(key))
    || !file.routing || typeof file.routing !== 'object' || Array.isArray(file.routing)
    || !file.pinned || typeof file.pinned !== 'object' || Array.isArray(file.pinned)
    || Object.values(file.routing).some(id => id !== 'qualification-model')
    || Object.values(file.pinned).some(pinned => pinned !== true)) throw loanUnavailable();
  const account = file.accounts[0] as Record<string, unknown>;
  if (!account || Object.keys(account).some(key => !['id', 'label', 'access', 'refresh', 'expires', 'status', 'chatgptAccountId'].includes(key))
    || account.id !== 'qualification-model' || account.label !== '[smoke] selected model'
    || typeof account.access !== 'string' || !account.access || account.refresh !== ''
    || account.status !== 'ok' || account.expires !== loan.expires
    || typeof account.chatgptAccountId !== 'string' || !account.chatgptAccountId) throw loanUnavailable();
  const projection = { id: account.id, label: account.label, access: account.access,
    refresh: account.refresh, expires: account.expires, status: account.status,
    chatgptAccountId: account.chatgptAccountId };
  if (loanHash(canonicalLoan(projection)) !== loan.accountProjectionSha256
    || loanHash(privateLoanBytes(loan.decisionPath)) !== loan.decisionSha256
    || loanHash(privateLoanBytes(loan.gridPath)) !== loan.gridSha256) throw loanUnavailable();
  return loan;
}
export const qualificationApiBootId=randomUUID();
let cached: QualificationFixtureAuthority | null | undefined;
let authorityBytes:string|undefined;
let actorTokenBytes:string|undefined;
/** A private disposable bearer is accepted only with the exact-build fixture authority. */
export function qualificationSyntheticActorToken(m:QualificationFixtureAuthority):string {
  if(!m.syntheticActor)throw new Error('qualification synthetic actor absent');
  const {tokenPath,expiresAt}=m.syntheticActor;
  const expiry=Date.parse(expiresAt);
  if(!Number.isFinite(expiry) || expiry<=Date.now() ||
    tokenPath!==join(m.fixtureRoot,'actor-token') || !tokenPath.startsWith('/private/tmp/') || resolve(tokenPath)!==tokenPath)
    throw new Error('qualification synthetic actor scope invalid');
  const st=lstatSync(tokenPath);
  if(realpathSync(tokenPath)!==tokenPath || !st.isFile() || st.isSymbolicLink() || st.nlink!==1 ||
    st.uid!==process.getuid?.() || (st.mode&0o777)!==0o600)
    throw new Error('qualification synthetic actor token ownership invalid');
  const token=readFileSync(tokenPath,'utf8');
  if(!/^[a-f0-9]{64}$/.test(token) || createHash('sha256').update(token).digest('hex')!==m.tokenSha256)
    throw new Error('qualification synthetic actor token invalid');
  return token;
}
/** Explicit private startup authority, never an HTTP-selected filesystem path. */
export function loadQualificationFixtureAuthority(): QualificationFixtureAuthority | null {
  if(cached!==undefined){if(cached){const file=process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST!;const st=lstatSync(file);if(realpathSync(file)!==file || !st.isFile() || st.isSymbolicLink() || st.nlink!==1 || st.uid!==process.getuid?.() || (st.mode&0o777)!==0o600 || readFileSync(file,'utf8')!==authorityBytes)throw new Error('qualification startup authority changed');if(cached.syntheticActor && qualificationSyntheticActorToken(cached)!==actorTokenBytes)throw new Error('qualification synthetic actor changed');assertQualificationModelLoan(cached);}return cached;}
  const manifest=process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
  if(!manifest)return cached=null;
  const owned=(p:string,mode:number,directory=false)=>{
    const st=lstatSync(p);
    if(realpathSync(p)!==p || st.isSymbolicLink() || (directory?!st.isDirectory():!st.isFile()) || st.uid!==process.getuid?.() || (!directory && st.nlink!==1) || (st.mode&0o777)!==mode)throw new Error('qualification authority ownership invalid');
  };
  if(!manifest.startsWith('/private/tmp/') || resolve(manifest)!==manifest)throw new Error('qualification authority must be canonical private tmp');
  owned(dirname(manifest),0o700,true);owned(manifest,0o600);
  authorityBytes=readFileSync(manifest,'utf8');
  const m=JSON.parse(authorityBytes) as QualificationFixtureAuthority;
  const build=JSON.parse(readFileSync(join(__dirname,'../../build-identity.json'),'utf8'));
  if(m.schemaVersion!==1 || !/^[a-f0-9]{40}$/.test(m.sourceRevision) || build.schemaVersion!==1 || build.sourceRevision!==m.sourceRevision ||
    !/^[a-f0-9]{64}$/.test(m.tokenSha256) || typeof m.ownerId!=='string' || !m.ownerId || !Number.isSafeInteger(m.ownerUserId) || m.ownerUserId<=0 ||
    typeof m.fixtureRoot!=='string' || !m.fixtureRoot.startsWith('/private/tmp/') || resolve(m.fixtureRoot)!==m.fixtureRoot ||
    m.dbPath!==join(m.fixtureRoot,'rhythm.db') || m.publicUserSeed?.id!==m.ownerUserId || !m.publicUserSeed.googleSub || !m.publicUserSeed.email ||
    (process.env.DB_PATH && process.env.DB_PATH!==m.dbPath))throw new Error('qualification authority binding invalid');
  owned(m.fixtureRoot,0o700,true);
  if(process.env.DB_CLIENT && process.env.DB_CLIENT!=='sqlite')throw new Error('qualification requires SQLite');
  try { const db=lstatSync(m.dbPath);if(!db.isFile() || db.isSymbolicLink() || realpathSync(m.dbPath)!==m.dbPath || db.uid!==process.getuid?.() || db.nlink!==1 || (db.mode&0o077)!==0)throw new Error('qualification database must be private owned regular bytes'); } catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(m.profileSeedPath){if(!m.profileSeedPath.startsWith(m.fixtureRoot+'/'))throw new Error('qualification profile seed out of scope');owned(m.profileSeedPath,0o600);}
  if(m.syntheticActor){
    const actor=m.syntheticActor,expiry=Date.parse(actor.expiresAt);
    if(actor.tokenPath!==join(m.fixtureRoot,'actor-token') || !/^qualification-fixture:[A-Za-z0-9_-]{1,128}$/.test(m.publicUserSeed.googleSub) ||
      !/^[^@\s]+@[^@\s]+\.invalid$/.test(m.publicUserSeed.email) || !Number.isFinite(expiry) || expiry<=Date.now() || expiry>Date.now()+86_400_000)
      throw new Error('qualification synthetic actor scope invalid');
    owned(actor.tokenPath,0o600);
    actorTokenBytes=qualificationSyntheticActorToken(m);
    Object.freeze(actor);
  }
  assertQualificationModelLoan(m);
  Object.freeze(m.publicUserSeed);cached=Object.freeze(m);return cached;
}
export function qualificationFixtureTokenValid(header: unknown): boolean {
  const m=loadQualificationFixtureAuthority();
  if(!m || typeof header!=='string' || !header.startsWith('Bearer '))return false;
  const actual=createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(actual,Buffer.from(m.tokenSha256,'hex'));
}
