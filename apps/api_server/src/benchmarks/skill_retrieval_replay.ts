/**
 * Checked-in issue #1209 replay corpus.
 *
 * Prompts are anonymized, realistic church-staff session requests shaped from
 * the same workflows represented by Rhythm's existing skill fixtures. Labels
 * are adjudicated skill ids, not scorer output. Keep this dependency-free so it
 * can be rerun with `npx tsx src/benchmarks/skill_retrieval_replay.ts`.
 */

type ReplaySkill = { id: string; text: string };
type ReplayCase = { prompt: string; relevant: string[] };

const skills: ReplaySkill[] = [
  { id: 'weekly-email', text: 'Send the weekly staff email. Compose a concise update for church staff with ministry news, deadlines, calendar reminders, links, proofreading, recipient review, and final Gmail delivery.' },
  { id: 'room-booking', text: 'Reserve a facility room. Find available rooms, check capacity and equipment, avoid calendar conflicts, create the reservation, and notify the event owner.' },
  { id: 'pco-people', text: 'Planning Center people lookup. Search PCO People records, find household and contact details, review membership information, and return the requested person record.' },
  { id: 'propresenter-slides', text: 'Prepare ProPresenter service slides. Build and edit presentation playlists, sermon slides, lower thirds, stage display cues, media, and announcement graphics for worship.' },
  { id: 'volunteer-schedule', text: 'Schedule ministry volunteers. Review availability, service positions, conflicts, preferences, team assignments, and send scheduling notifications.' },
  { id: 'meeting-notes', text: 'Turn meeting notes into action items. Summarize decisions, owners, due dates, follow-ups, blockers, and create trackable tasks.' },
  { id: 'calendar-event', text: 'Create or update a calendar event. Confirm date, time, timezone, attendees, location, recurrence, reminders, and invitation details.' },
  { id: 'expense-report', text: 'Prepare an expense reimbursement report. Collect receipts, merchant, date, ministry code, approver, totals, and submission notes.' },
  { id: 'sermon-research', text: 'Research a sermon topic. Gather scripture context, trusted commentary, themes, illustrations, citations, and a structured teaching outline.' },
  { id: 'social-post', text: 'Draft a church social media post. Write platform-appropriate copy, accessibility text, hashtags, timing, links, and a review-ready caption.' },
];

const cases: ReplayCase[] = [
  { prompt: 'Can you get the staff update email ready for Friday?', relevant: ['weekly-email'] },
  { prompt: 'Find me a room for the newcomer lunch that seats 40', relevant: ['room-booking'] },
  { prompt: 'Look up Jordan’s household in Planning Center', relevant: ['pco-people'] },
  { prompt: 'Build the worship announcement slides in ProPresenter', relevant: ['propresenter-slides'] },
  { prompt: 'Fill the remaining volunteer positions for Sunday', relevant: ['volunteer-schedule'] },
  { prompt: 'Pull owners and due dates out of these meeting notes', relevant: ['meeting-notes'] },
  { prompt: 'Put the elders meeting on the calendar next Tuesday', relevant: ['calendar-event'] },
  { prompt: 'Turn these receipts into a reimbursement report', relevant: ['expense-report'] },
  { prompt: 'Research the biblical context for hospitality', relevant: ['sermon-research'] },
  { prompt: 'Write an Instagram caption for the youth retreat', relevant: ['social-post'] },
  { prompt: 'Who is this phone number attached to in PCO People?', relevant: ['pco-people'] },
  { prompt: 'The service deck needs lower thirds and stage display cues', relevant: ['propresenter-slides'] },
];

/**
 * Hand-derived threshold guard from the established P3-2 multi-skill fixture.
 *
 * Query: "help me build the weekly staff report"
 * Both 8-token documents have avgdl=8, so BM25 length normalization is 1.
 * Shared terms {the, weekly, report}: IDF = ln(1 + 0.5/2.5) = 0.1823215568.
 * Primary-only {staff}: IDF = ln(1 + 1.5/1.5) = 0.6931471806.
 * With confidence=0.9 and existing exact-tag boosts:
 *   primary   = (3*0.1823215568 + 0.6931471806 + 2*1.5) * 1.09 = 4.6217
 *   secondary = (3*0.1823215568 + 1*1.5) * 1.09             = 2.2312
 *   ratio     ≈ 0.4828
 *
 * Therefore 0.5 is a false-negative cutoff; 0.45 retains both genuinely
 * matching skills without changing their ordering or the top-N=5 bound.
 */
export const multiSkillThresholdDerivation = {
  primaryBoostedScore: 4.6217,
  secondaryBoostedScore: 2.2312,
  secondaryToPrimaryRatio: 0.4828,
  selectedRelativeThreshold: 0.45,
};

const tokenize = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const word = raw.replace(/^[.,!?";:()[\]]+/, '').replace(/[.,!?";:()[\]]+$/, '');
    if (word.length > 1) out.add(word);
  }
  return out;
};

const jaccard = (query: Set<string>, document: Set<string>): number => {
  let intersection = 0;
  for (const token of query) if (document.has(token)) intersection++;
  const union = query.size + document.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export function bm25Scores(queryText: string, documents: string[]): number[] {
  const query = tokenize(queryText);
  const tokenized = documents.map(tokenize);
  const averageLength =
    tokenized.reduce((sum, document) => sum + document.size, 0) / Math.max(tokenized.length, 1);
  const k1 = 1.2;
  const b = 0.75;

  return tokenized.map((document) => {
    let score = 0;
    for (const term of query) {
      if (!document.has(term)) continue;
      const documentFrequency = tokenized.reduce(
        (count, candidate) => count + (candidate.has(term) ? 1 : 0),
        0,
      );
      const idf = Math.log(1 + (tokenized.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      const lengthNormalization = 1 - b + b * (document.size / Math.max(averageLength, 1));
      score += idf * ((k1 + 1) / (1 + k1 * lengthNormalization));
    }
    return score;
  });
}

function evaluate(kind: 'jaccard' | 'bm25') {
  let relevantFound = 0;
  let returned = 0;
  let relevantReturned = 0;
  let paraphraseMisses = 0;
  const misses: string[] = [];

  for (const replay of cases) {
    const scores =
      kind === 'jaccard'
        ? skills.map((skill) => jaccard(tokenize(replay.prompt), tokenize(skill.text)))
        : bm25Scores(replay.prompt, skills.map((skill) => skill.text));
    const threshold =
      kind === 'jaccard'
        ? 0.3
        : Math.max(...scores, 0) * multiSkillThresholdDerivation.selectedRelativeThreshold;
    const ranked = scores
      .map((score, index) => ({ score, id: skills[index].id }))
      .filter((entry) => entry.score > 0 && entry.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const found = ranked.some((entry) => replay.relevant.includes(entry.id));
    if (found) relevantFound++;
    else {
      paraphraseMisses++;
      misses.push(replay.prompt);
    }
    returned += ranked.length;
    relevantReturned += ranked.filter((entry) => replay.relevant.includes(entry.id)).length;
  }

  return {
    recallAt5: relevantFound / cases.length,
    // Conventional precision@k uses k as the denominator even when a
    // threshold returns fewer than k items. This prevents an overly strict
    // scorer that returns one correct item from appearing perfectly precise.
    precisionAt5: relevantReturned / (cases.length * 5),
    paraphraseMisses,
    missExamples: misses.slice(0, 3),
    returned,
  };
}

export function runSkillRetrievalReplay() {
  return {
    cases: cases.length,
    skills: skills.length,
    jaccard: evaluate('jaccard'),
    bm25: evaluate('bm25'),
    bm25RelativeThreshold: multiSkillThresholdDerivation.selectedRelativeThreshold,
    thresholdDerivation: multiSkillThresholdDerivation,
    topN: 5,
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runSkillRetrievalReplay(), null, 2)}\n`);
}
