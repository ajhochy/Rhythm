import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface QualificationFixtureAuthority {
  schemaVersion: 1; ownerId: string; ownerUserId: number; fixtureRoot: string;
  dbPath: string; sourceRevision: string; tokenSha256: string;
  publicUserSeed: {id:number;name:string;email:string;googleSub:string;timezone:string};
  profileSeedPath?: string;
}
export const qualificationApiBootId=randomUUID();
let cached: QualificationFixtureAuthority | null | undefined;
let authorityBytes:string|undefined;
/** Explicit private startup authority, never an HTTP-selected filesystem path. */
export function loadQualificationFixtureAuthority(): QualificationFixtureAuthority | null {
  if(cached!==undefined){if(cached){const file=process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST!;const st=lstatSync(file);if(realpathSync(file)!==file || !st.isFile() || st.isSymbolicLink() || st.nlink!==1 || st.uid!==process.getuid?.() || (st.mode&0o777)!==0o600 || readFileSync(file,'utf8')!==authorityBytes)throw new Error('qualification startup authority changed');}return cached;}
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
  Object.freeze(m.publicUserSeed);cached=Object.freeze(m);return cached;
}
export function qualificationFixtureTokenValid(header: unknown): boolean {
  const m=loadQualificationFixtureAuthority();
  if(!m || typeof header!=='string' || !header.startsWith('Bearer '))return false;
  const actual=createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(actual,Buffer.from(m.tokenSha256,'hex'));
}
