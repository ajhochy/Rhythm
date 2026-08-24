export const taskDensityWeekDates = [
  { date: '2026-08-10', day: 'Monday' },
  { date: '2026-08-11', day: 'Tuesday' },
  { date: '2026-08-12', day: 'Wednesday' },
  { date: '2026-08-13', day: 'Thursday' },
  { date: '2026-08-14', day: 'Friday' },
  { date: '2026-08-15', day: 'Saturday' },
  { date: '2026-08-16', day: 'Sunday' },
] as const;

const taskDensityDefinitions = [
  { title: 'Confirm room access plan', notes: 'Verify keys, door schedules, and the closing owner.' },
  { title: 'Review volunteer coverage', notes: 'Resolve open check-in, childcare, and hospitality assignments.' },
  { title: 'Draft team handoff note', notes: 'Summarize owners, timing changes, and unresolved decisions.' },
  { title: 'Check supply inventory', notes: 'Count print stock, welcome materials, and room supplies.' },
  { title: 'Confirm accessibility needs', notes: 'Verify seating, entry, interpretation, and mobility support.' },
  { title: 'Reconcile schedule conflicts', notes: 'Compare room bookings, team availability, and setup windows.' },
  { title: 'Send owner reminder', notes: 'Confirm responsibility for each open handoff before the next shift.' },
  { title: 'Review vendor delivery', notes: 'Verify the arrival window, receiving contact, and storage location.' },
  { title: 'Prepare print materials', notes: 'Export welcome cards, signs, and the current run sheet.' },
  { title: 'Validate livestream backup', notes: 'Test the backup encoder, audio path, and operator instructions.' },
  { title: 'Confirm childcare roster', notes: 'Reconcile check-in coverage, room assignments, and substitutions.' },
  { title: 'Update facility checklist', notes: 'Record room reset, safety, and closing responsibilities.' },
  { title: 'Review open approvals', notes: 'Resolve pending copy, purchasing, and schedule approvals.' },
  { title: 'Schedule translation review', notes: 'Assign the final multilingual review and delivery time.' },
  { title: 'Close pending follow-ups', notes: 'Capture decisions and return unresolved work to its owner.' },
] as const;

export const taskDensitySeeds = taskDensityWeekDates.flatMap(({ date, day }, dayIndex) =>
  taskDensityDefinitions.map(({ title, notes }, taskIndex) => ({
    id: `density-${date}-${String(taskIndex + 1).padStart(2, '0')}`,
    title: `${day}: ${title}`,
    notes,
    date,
    day,
    dayIndex,
    taskIndex,
    projectStep: taskIndex % 5 === 4,
  })),
);
