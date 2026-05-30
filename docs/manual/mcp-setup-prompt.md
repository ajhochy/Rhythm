# Rhythm + Claude — Onboarding Interview Prompt

This is the standalone copy of the interview prompt embedded in the staff guide
section [Let Claude set up Rhythm for you](https://rhythmguide.vcrcapps.com/#onboarding).
Use this file if you want to read the prompt outside the guide, customize it
for your role, or share it with another staff member.

## How to use

1. Wire the Rhythm MCP server into Claude Desktop (or Claude Code). See the
   staff guide section linked above for the config snippet, or the
   [MCP server README](https://github.com/ajhochy/Rhythm/blob/main/apps/mcp_server/README.md)
   on GitHub.
2. Open a fresh Claude conversation.
3. Copy the prompt below and paste it as your first message.
4. Answer Claude's questions one at a time. Expect 10–20 minutes.
5. Claude creates real Rhythms, Projects, and Tasks in your account as it
   goes. Spot-check the desktop app as you answer.

## The prompt

```text
I'd like you to interview me about my role so you can set up Rhythm — a desktop
productivity app for church staff — to match my actual work.

You have access to Rhythm via the rhythm_* MCP tools (rhythm_ping, rhythm_create_rhythm,
rhythm_create_project_template, rhythm_add_project_step, rhythm_create_task,
rhythm_list_rhythms, rhythm_get_dashboard, etc.). Use them as you go.

Please conduct the interview in this order. Ask ONE focused question at a time,
wait for my answer, and only move on when you have what you need:

1. ROLE AND CONTEXT
   - What's my role at the church? (worship leader, pastoral staff, finance/admin,
     facilities, AV/tech, children's ministry, etc.)
   - Roughly how big is the staff and the congregation?
   - What tools do I already use heavily (Planning Center, Google Calendar, a CCM,
     accounting software, etc.)?

2. WEEKLY OBLIGATIONS — the recurring stuff
   - Walk me through a typical week. What do I do every week, without exception?
   - For each recurring thing: what's the cadence (weekly, bi-weekly, monthly)?
     What are the steps inside it?
   - Create one rhythm per recurring obligation with rhythm_create_rhythm; then
     add each step with rhythm_add_rhythm_step.

3. ANNUAL / PROJECT-LIKE WORK — the date-anchored stuff
   - What annual or one-time events do I run? (Christmas Eve, Easter, summer
     retreat, annual budget, year-end report, etc.)
   - For each, what's the target date and what are the milestones, with offsets
     from that date? ("Pick a theme — 8 weeks before," "Send invitations — 4
     weeks before," "Debrief — 1 week after.")
   - Create one project template per recurring event with
     rhythm_create_project_template, then add offset steps with
     rhythm_add_project_step. If it's annual, say so in the description.

4. ONE-OFF TASKS ON MY MIND RIGHT NOW
   - Anything coming up in the next 2-4 weeks that doesn't fit a rhythm or
     project but I shouldn't forget?
   - Create each with rhythm_create_task; set a sensible due date.

5. PEOPLE AND COORDINATION
   - Who do I coordinate with regularly? (Worship leader, pastor, treasurer,
     custodian, etc.)
   - Are any of my rhythms or projects shared with them? Note this in the
     rhythm/project description so I can add them as collaborators later.

GUIDELINES:
- Keep questions short. Don't lecture me about productivity.
- Ask follow-ups when I'm vague ("when you say 'sermon prep,' what are the steps?").
- After each completed item, briefly summarize what you created and move on.
- Don't try to create every possible task — focus on the load-bearing recurring
  work and the major annual events. We can add more later.
- At the end, call rhythm_get_dashboard and show me the summary so I can spot-check.

Start with question 1. Just one question at a time.
```

## Design notes

The prompt is structured to map 1:1 to Rhythm's data model:

| Interview phase | Rhythm concept | MCP tools used |
|---|---|---|
| Phase 2 — Weekly obligations | Rhythms | `rhythm_create_rhythm`, `rhythm_add_rhythm_step` |
| Phase 3 — Annual / project work | Projects | `rhythm_create_project_template`, `rhythm_add_project_step` |
| Phase 4 — One-off tasks | Tasks | `rhythm_create_task` |
| Phase 5 — People | Collaborators (descriptive) | Noted in description today; full collaborator MCP integration is on the roadmap |

The prompt explicitly tells Claude to call `rhythm_get_dashboard` at the end.
This is the load-bearing spot-check step — without it, Claude tends to finish
without showing you what it built, and you have to switch to the app to find
out.

It also asks for one question at a time, not a bulk questionnaire. Bulk
questionnaires produce noisy, half-thought answers; sequential interviewing
produces structures that actually match the staffer's work.

## Variations

### Seed from a starter pack

If your role matches one of the [starter packs](starter-packs/) (worship,
pastoral, finance), prefix the interview prompt with this paragraph and
paste the pack JSON below it:

> Before you interview me, here's a starter pack for my role. Create the
> rhythms, projects, and tasks it describes first, then only ask me about
> things that aren't already covered.
>
> ```json
> { ...paste the pack contents... }
> ```

The staff-guide page (`https://rhythmguide.vcrcapps.com`) is behind Cloudflare
Access, so Claude can't fetch the pack URL directly. Downloading the JSON in
your browser and pasting it inline is the reliable path.

### Shorter interview for time-pressed staff

If you only have 10 minutes, replace phase 4 with:

> Skip one-off tasks; I'll add those manually as they come up.

### Different language

The prompt is in English and assumes Claude responds in English. Translate
the bracketed instructions if needed; Claude will mirror the language.
