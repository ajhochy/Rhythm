// Synthetic expectations chosen before evaluating revised cutoffs. This is a small regression set, not a production quality benchmark.
export const routerCalibrationCases = [
  { name: 'formatting is tier 4', prompt: 'Convert this text to lowercase and return only the result: HELLO WORLD', tiers: [4] },
  { name: 'extraction is tier 4', prompt: 'Extract only the email address from this text: Please contact sam@example.test tomorrow.', tiers: [4] },
  { name: 'one literal edit does not become tier 2', prompt: 'In the supplied JavaScript function, change the greeting to Hello: function greet() { return "Hi"; }', tiers: [3, 4] },
  { name: 'hard architecture reaches tier 1', prompt: 'Design and implement a fault-tolerant multi-region database replication protocol. Prove safety under network partitions, formalize conflict resolution and recovery invariants, and develop a comprehensive adversarial test plan.', tiers: [1] },
  { name: 'one parameter rename stays routine', prompt: 'Rename the parameter x to value in this one JavaScript function, preserving behavior: function double(x) { return x * 2; }', tiers: [3, 4] },
  { name: 'one documentation typo stays routine', prompt: 'Fix the typo in this README sentence: Run npm instal to install dependencies.', tiers: [3, 4] },
  { name: 'one CSS spacing edit stays routine', prompt: 'In this supplied CSS rule, change padding from 8px to 12px without changing anything else: .card { padding: 8px; color: black; }', tiers: [3, 4] },
  { name: 'one obvious bounds fix stays routine', prompt: 'Fix the off-by-one in this single function so it returns the last array item: function last(items) { return items[items.length]; }', tiers: [3, 4] },
  { name: 'a routine email stays routine', prompt: 'Draft a short friendly email thanking Sam for attending yesterday and confirming our meeting next Tuesday at 10am.', tiers: [3, 4] },
  { name: 'a multi-file feature retains a capable tier', prompt: 'Implement a paginated task list with filtering, typed API contracts, loading and error states, and integration tests across the existing frontend and backend.', tiers: [1, 2] },
  { name: 'moderate research retains a capable tier', prompt: 'Write a research report comparing three database migration strategies for a growing SaaS product, analyze operational tradeoffs, and propose a phased rollout with validation criteria.', tiers: [1, 2] },
  { name: 'hard debugging retains a capable tier', prompt: 'Diagnose and fix an intermittent distributed transaction data-loss bug across three services under network partitions. Reconstruct the race, prove the repair preserves consistency, and add deterministic fault-injection tests.', tiers: [1] },
];
