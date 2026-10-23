import type { OrgEvaluationProposalKind } from '../models/org_evaluation';

/** Code-owned dialect guide. Validators remain authoritative; never invent IDs, grants, artifacts or evidence. */
const HINTS: Record<OrgEvaluationProposalKind, string> = {
  'create-agent': '{agentSlug,label,systemPrompt,allowedMcpsJson,allowedSkillsJson,allowedDelegatesJson?}; JSON allowlists are strings. Use a new readable slug, existing catalog capabilities only; target agent_config:<slug>, revision absent.',
  'grant-delegation': '{agentConfigId,allowed_delegates_json:{add:[existingDelegateId]}}; target agent_config:<managerId>. Preserve manager/worker eligibility and graph limits.',
  'expand-delegation': '{agentConfigId,allowed_delegates_json:{add:[existingDelegateId]}}; target agent_config:<managerId>. Preserve manager/worker eligibility and graph limits.',
  'broaden-scope': '{agentConfigId,field:"allowedMcpsJson"|"allowedSkillsJson",add:[knownCapabilityName]}; target agent_config:<id>; include a securityNote.',
  'tighten-scope': '{agentConfigId,field:"allowedMcpsJson"|"allowedSkillsJson",remove:[existingCapabilityName]}; target agent_config:<id>; include a securityNote.',
  'prune-scope': '{agentConfigId,field:"allowedMcpsJson"|"allowedSkillsJson",remove:[existingCapabilityName]}; target agent_config:<id>; include a securityNote.',
  'create-recipe': '{title,description,steps_json,boundConfigId?}; steps_json is a JSON string of real bounded steps; target recipe:<new title>, revision absent.',
  'refine-recipe': '{recipeId,priorStepsJson,revisedStepsJson}; exact current legacy steps JSON and tested replacement, target recipe:<id>. Workflow-format recipes require their own workflow-aware adapter.',
  'refine-skill': '{skillName,priorBody,revisedBody}; priorBody is the exact current managed body, not a paraphrase; target skill:<id-or-name>. Write a complete revised procedure.',
  'consolidate-skill': '{survivorSkillId,retiredSkillId,priorSurvivorBody,priorRetiredBody,revisedBody}; target skill:<survivor id>. Preserve both source procedures and test retired capability absence.',
  'external-adoption': '{candidateKind:"skill"|"mcp",skillName?|serverName?,agentConfigId,...pinnedCatalogDescriptor}; use only an actually supplied immutable artifact/source descriptor; never invent a download/install command or provenance; include securityNote.',
  'webhook-wiring': '{targetScheduledTaskId?|targetRecipeId?,triggerSource,eventTypes,targetPromptTemplate?}; exactly one existing target; target webhook:<new trigger name>, revision absent; include securityNote covering HMAC, scope and SSRF.',
  'refine-config': '{configPatch:{agentConfigId,field:"system_prompt"|"model"|"allowedDelegatesJson",value:string}}; target agent_config:<id>. The field is system_prompt, not systemPrompt. Permissions belong to refine-scope.',
  'refine-scope': '{scopePatch:{agentConfigId,field:"allowedMcpsJson"|"allowedSkillsJson",add?:[name],remove?:[name]}} OR {scopePatch:{agentConfigId,field:"corePermissionsJson",set?:{permission:rule},unset?:[permission]}}; no other root operations; include securityNote.',
  'workflow-prompt-fix': '{skillName,concreteFix}; target skill:<existing id-or-name>. concreteFix describes the precise complete skill-body improvement, never a live shell command.',
  'refine-task': '{taskPatch:{scheduledTaskId,field:"prompt"|"description"|"cronExpression"|"scheduledTime"|"agentConfigId",value:string}}; target scheduled_task:<id>; use current updatedAt as targetRevision.',
  'publish-skill-to-org': '{skillName,action:"publish"|"unpublish"}; target skill:<id-or-name>. Publication is tested only against the isolated org receiver before human approval.',
  'tool-install': '{toolName,packageSource,installMethod:"local-tarball",agentConfigId,testPrompts:["version-check","help-check"]}; use only supplied immutable artifact descriptors. Omit evidenceBundle: the server supplies verified target/session evidence. Installation is confined to Docker; never invent artifact paths/evidence; target agent_config:<baseline id>, revision absent.',
};

export function orgEvaluationSchemaHints(kind?: OrgEvaluationProposalKind): string {
  return kind ? `${kind}: ${HINTS[kind]}` : Object.entries(HINTS).map(([name, hint]) => `${name}: ${hint}`).join('\n');
}
