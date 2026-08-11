export const worshipCalendar = {
  title: "Worship Calendar",
  workspace_id: 1,
  visibility: "shared",
  collaborators: [],
  declared_capabilities: ["pco.services.read"],
  bundle: {
    html: "<main id=\"calendar\"></main>",
    css: "main { color: #222; }",
    js: "window.renderCalendar = true;",
  },
  state: {
    entries: [{
      id: "worship-2026-08-09",
      serviceDate: "2026-08-09",
      title: "Sunday Worship",
      scripture: "John 3:16",
      theme: "Grace",
      serviceDetails: { startTime: "10:00" },
      pco: { serviceTypeId: null, planId: null, lastSyncedAt: null },
    }],
  },
};
