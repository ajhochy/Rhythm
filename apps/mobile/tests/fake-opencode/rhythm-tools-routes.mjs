const now = () => new Date().toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRhythmToolsRoutes({ readJson, sendJson }) {
  let nextId = 1;
  const state = {
    brain: [],
    research: [],
    schedules: [],
    webhooks: [
      {
        id: 'webhook-planning-center',
        name: 'Planning Center intake',
        status: 'connected',
        enabled: true,
      },
    ],
    profiles: [
      {
        id: 'secretary',
        label: 'Secretary',
        systemPrompt: 'Coordinate church operations clearly.',
        allowedMcpsJson: null,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        projection: { status: 'projected', updatedAt: now() },
      },
    ],
    cookbook: [],
    proposals: [
      {
        id: 'proposal-high-risk',
        title: 'High-risk model change',
        status: 'pending',
        risk: 'high',
        rationale: 'Move the executive agent to a frontier model.',
      },
    ],
    skills: [
      {
        id: 'approved-skill',
        name: 'approved-skill',
        description: 'Approved skills fixture',
        source: 'managed',
        managed: true,
      },
    ],
    playbooks: [
      {
        id: 'weekly-review',
        name: 'weekly-review',
        description: 'Review the week safely.',
        source: 'command',
        managed: true,
      },
    ],
    mcp: [
      { id: 'filesystem', name: 'filesystem', status: 'connected', enabled: true },
      { id: 'planning-center', name: 'planning-center', status: 'connected', enabled: true },
      { id: 'gmail', name: 'gmail', status: 'disabled', enabled: false },
    ],
  };

  const createdId = (prefix) => `${prefix}-${nextId++}`;
  const endEmpty = (res, status = 204) => {
    res.writeHead(status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    });
    res.end();
  };
  const find = (items, id) => items.find((item) => item.id === id || item.name === id);
  const remove = (items, id) => {
    const index = items.findIndex((item) => item.id === id || item.name === id);
    if (index >= 0) items.splice(index, 1);
  };

  return async function handleRhythmTools({ req, res, pathname, requestUrl }) {
    if (req.method === 'GET' && pathname === '/integrations/gmail-signals') {
      sendJson(res, 200, [
        {
          externalId: 'email-volunteer-reply',
          threadId: 'thread-volunteer',
          fromName: 'Taylor',
          fromEmail: 'taylor@example.com',
          subject: 'Volunteer reply',
          snippet: 'I can serve this Sunday.',
          receivedAt: now(),
          isUnread: true,
        },
      ]);
      return true;
    }
    if (req.method === 'GET' && pathname === '/agent-designs') {
      sendJson(res, 200, [
        {
          id: 'design-sunday',
          title: 'Sunday service graphic',
          status: 'ready',
          thumbnailUrl: 'https://example.test/sunday.png',
          createdAt: now(),
        },
      ]);
      return true;
    }
    if (req.method === 'GET' && pathname === '/mobile-gateway/opencode/provider') {
      sendJson(res, 200, [
        {
          id: 'openai',
          name: 'OpenAI',
          providerID: 'openai',
          configured: true,
          enabled: true,
        },
      ]);
      return true;
    }
    if (req.method === 'GET' && pathname === '/mobile-gateway/opencode/provider/auth') {
      sendJson(res, 200, { openai: [{ type: 'api' }] });
      return true;
    }
    if (req.method === 'GET' && pathname === '/mobile-gateway/opencode/config') {
      sendJson(res, 200, { enabled_providers: ['openai'] });
      return true;
    }
    if (req.method === 'GET' && pathname === '/mobile-gateway/opencode/mcp') {
      sendJson(res, 200, clone(state.mcp));
      return true;
    }
    const mcpAction = pathname.match(
      /^\/mobile-gateway\/opencode\/mcp\/([^/]+)\/(connect|disconnect|auth)$/,
    );
    if (req.method === 'POST' && mcpAction) {
      const name = decodeURIComponent(mcpAction[1]);
      const item = find(state.mcp, name);
      if (item && mcpAction[2] !== 'auth') {
        item.status = mcpAction[2] === 'connect' ? 'connected' : 'disabled';
        item.enabled = mcpAction[2] === 'connect';
      }
      sendJson(res, 200, item ?? { name, status: 'pending' });
      return true;
    }
    if (req.method === 'POST' && pathname === '/mobile-gateway/opencode/mcp') {
      const body = await readJson(req);
      const item = {
        id: body?.name ?? createdId('mcp'),
        name: body?.name ?? 'new-mcp',
        status: 'connected',
        enabled: true,
      };
      state.mcp.push(item);
      sendJson(res, 201, clone(item));
      return true;
    }

    const prefix = '/mobile-gateway/tools/';
    if (!pathname.startsWith(prefix)) return false;
    const relative = pathname.slice(prefix.length);
    const parts = relative.split('/').map(decodeURIComponent);
    const resource = parts[0];
    const id = parts[1];
    const action = parts[2];
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
      ? await readJson(req)
      : undefined;

    if (resource === 'agent-memory') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.brain));
        return true;
      }
      if (req.method === 'GET' && id === 'search') {
        const query = (requestUrl.searchParams.get('q') ?? '').toLowerCase();
        sendJson(
          res,
          200,
          clone(state.brain.filter((item) =>
            `${item.title} ${item.content}`.toLowerCase().includes(query))),
        );
        return true;
      }
      if (req.method === 'POST' && parts.length === 1) {
        const item = {
          id: createdId('memory'),
          title: body?.title,
          content: body?.content,
          tags: body?.tags ?? [],
          updatedAt: now(),
        };
        state.brain.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'PATCH' && id) {
        Object.assign(find(state.brain, id) ?? {}, body, { updatedAt: now() });
        sendJson(res, 200, clone(find(state.brain, id)));
        return true;
      }
      if (req.method === 'DELETE' && id) {
        remove(state.brain, id);
        endEmpty(res);
        return true;
      }
    }

    if (resource === 'agent-research') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.research));
        return true;
      }
      if (req.method === 'POST' && parts.length === 1) {
        const item = {
          id: createdId('research'),
          query: body?.query,
          status: 'gathering',
          report: 'Research report is gathering authoritative sources.',
          sourcesJson: '[]',
          createdAt: now(),
          updatedAt: now(),
        };
        state.research.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'POST' && id && action === 'retry') {
        const item = find(state.research, id);
        if (item) Object.assign(item, { status: 'gathering', error: null, report: null });
        sendJson(res, 200, clone(item));
        return true;
      }
      if (req.method === 'DELETE' && id) {
        remove(state.research, id);
        endEmpty(res);
        return true;
      }
      if (req.method === 'GET' && id) {
        sendJson(res, 200, clone(find(state.research, id)));
        return true;
      }
    }

    if (resource === 'agent-schedules') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.schedules));
        return true;
      }
      if (req.method === 'POST' && parts.length === 1) {
        const item = {
          id: createdId('schedule'),
          name: body?.name,
          cron: body?.cronExpression ?? body?.cron,
          enabled: true,
          lastRunStatus: null,
        };
        state.schedules.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'POST' && id && action === 'trigger-now') {
        const item = find(state.schedules, id);
        if (item) item.lastRunStatus = 'queued';
        sendJson(res, 200, clone(item));
        return true;
      }
      if (req.method === 'DELETE' && id) {
        remove(state.schedules, id);
        endEmpty(res);
        return true;
      }
      if (req.method === 'PATCH' && id) {
        Object.assign(find(state.schedules, id) ?? {}, body);
        sendJson(res, 200, clone(find(state.schedules, id)));
        return true;
      }
    }

    if (resource === 'agent-webhooks') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.webhooks));
        return true;
      }
      if (req.method === 'POST' && parts.length === 1) {
        const item = {
          id: createdId('webhook'),
          name: body?.name,
          enabled: true,
          secret: 'e2e-show-once-webhook-secret',
        };
        state.webhooks.unshift({ ...item, secret: undefined });
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'DELETE' && id) {
        remove(state.webhooks, id);
        endEmpty(res);
        return true;
      }
    }

    if (resource === 'agent-configs') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.profiles));
        return true;
      }
      if (req.method === 'PATCH' && id) {
        const item = find(state.profiles, id);
        if (item) Object.assign(item, body, { projection: { status: 'pending' } });
        sendJson(res, 200, clone(item));
        return true;
      }
      if (req.method === 'POST' && id && action === 'resync-agent-file') {
        const item = find(state.profiles, id);
        if (item) item.projection = { status: 'projected', updatedAt: now() };
        sendJson(res, 200, { status: 'projected' });
        return true;
      }
    }

    if (resource === 'agent-cookbook') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.cookbook));
        return true;
      }
      if (req.method === 'POST' && parts.length === 1) {
        const item = { id: createdId('recipe'), ...body, createdAt: now() };
        state.cookbook.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'POST' && id && action === 'run') {
        sendJson(res, 202, { status: 'queued', id });
        return true;
      }
      if (req.method === 'DELETE' && id) {
        remove(state.cookbook, id);
        endEmpty(res);
        return true;
      }
    }

    if (resource === 'agent-org-proposals') {
      if (req.method === 'GET') {
        const status = requestUrl.searchParams.get('status');
        sendJson(
          res,
          200,
          clone(state.proposals.filter((item) => !status || item.status === status)),
        );
        return true;
      }
      if (req.method === 'POST' && id && ['approve', 'reject'].includes(action)) {
        const item = find(state.proposals, id);
        if (item) item.status = action === 'approve' ? 'approved' : 'rejected';
        sendJson(res, 200, clone(item));
        return true;
      }
    }

    if (resource === 'agents' && id === 'run-quality' && req.method === 'GET') {
      sendJson(res, 200, {
        generatedAt: now(),
        windowDays: 30,
        agents: [
          {
            agentKind: 'secretary',
            agentLabel: 'Secretary',
            totalRuns: 12,
            completionRate: 0.92,
            escalationRate: 0.08,
            wastePercentOfSpend: 0.03,
            repeatedMistakes: [],
          },
        ],
      });
      return true;
    }

    const managedCollection =
      resource === 'opencode' && id === 'skills'
        ? state.skills
        : resource === 'opencode' && id === 'commands'
          ? state.playbooks
          : null;
    if (managedCollection) {
      const managedName = parts[2];
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, clone(managedCollection));
        return true;
      }
      if (req.method === 'POST' && parts.length === 2) {
        const item = {
          id: body?.name,
          name: body?.name,
          description: body?.description,
          source: id === 'skills' ? 'managed' : 'command',
          managed: true,
        };
        managedCollection.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'DELETE' && managedName) {
        remove(managedCollection, managedName);
        endEmpty(res);
        return true;
      }
      if (req.method === 'PUT' && managedName) {
        Object.assign(find(managedCollection, managedName) ?? {}, body);
        sendJson(res, 200, clone(find(managedCollection, managedName)));
        return true;
      }
    }

    return false;
  };
}
