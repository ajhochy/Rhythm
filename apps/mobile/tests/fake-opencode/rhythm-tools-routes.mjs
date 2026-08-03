const now = () => new Date().toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRhythmToolsRoutes({ readJson, sendJson }) {
  let nextId = 1;
  let responseState = 'data';
  const responseStates = new Set([
    'data',
    'empty',
    'offline',
    'expired-auth',
    'forbidden',
    'error',
  ]);
  const createState = () => ({
    brain: [
      {
        id: 'memory-sunday-checklist',
        title: 'Sunday service checklist',
        content: 'Confirm volunteers, slides, and room readiness.',
        tags: ['sunday'],
        updatedAt: now(),
      },
    ],
    research: [
      {
        id: 'research-target',
        query: 'Selected research target',
        status: 'complete',
        report: 'Selected research result rendered from Activity.',
      },
    ],
    schedules: [
      {
        id: 'schedule-target',
        name: 'Selected schedule target',
        cron: '0 8 * * 1',
        enabled: true,
        lastRunStatus: 'complete',
      },
    ],
    webhooks: [
      {
        id: 'webhook-target',
        name: 'Selected webhook target',
        status: 'connected',
        enabled: true,
        url: 'http://127.0.0.1/webhooks/webhook-target/receive',
      },
      {
        id: 'webhook-planning-center',
        name: 'Planning Center intake',
        status: 'connected',
        enabled: true,
        url: 'http://127.0.0.1/webhooks/webhook-planning-center/receive',
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
    cookbook: [
      {
        id: 'cookbook-target',
        title: 'Selected recipe target',
        description: 'Selected recipe rendered from Activity.',
      },
    ],
    proposals: [
      {
        id: 'proposal-high-risk',
        title: 'High-risk model change',
        status: 'proposed',
        risk: 'high',
        rationale: 'Move the executive agent to a frontier model.',
      },
    ],
    designs: [
      {
        id: 'design-sunday',
        title: 'Sunday service graphic',
        provider: 'built-in',
        artifactType: 'png',
        status: 'ready',
        createdAt: now(),
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
  });
  let state = createState();

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
    if (
      req.method === 'POST' &&
      pathname === '/__control/rhythm-tools-state'
    ) {
      const body = await readJson(req);
      if (!responseStates.has(body?.state)) {
        sendJson(res, 400, {
          error: `Unsupported Rhythm tools state: ${String(body?.state)}`,
        });
        return true;
      }
      responseState = body.state;
      if (responseState === 'data') {
        nextId = 1;
        state = createState();
      }
      sendJson(res, 200, { state: responseState });
      return true;
    }

    const isToolRead =
      req.method === 'GET' &&
      (pathname.startsWith('/mobile-gateway/tools/') ||
        pathname.startsWith('/mobile-gateway/opencode/') ||
        pathname === '/integrations/gmail-signals');
    if (isToolRead && responseState !== 'data') {
      const statusByState = {
        offline: 503,
        'expired-auth': 401,
        forbidden: 403,
        error: 500,
      };
      if (responseState === 'empty') {
        sendJson(res, 200, []);
      } else {
        sendJson(res, statusByState[responseState], {
          error: {
            code: responseState.toUpperCase().replace('-', '_'),
            message:
              responseState === 'offline'
                ? 'The paired Mac is offline.'
                : `Rhythm tools ${responseState} fixture.`,
          },
        });
      }
      return true;
    }

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
    if (req.method === 'GET' && pathname === '/mobile-gateway/opencode/provider') {
      sendJson(res, 200, {
        all: [
          {
            id: 'openai',
            name: 'OpenAI',
            providerID: 'openai',
            models: {
              'gpt-4.1-mini': {
                id: 'gpt-4.1-mini',
                name: 'GPT-4.1 mini',
              },
            },
          },
        ],
        connected: ['openai'],
      });
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
      sendJson(
        res,
        200,
        mcpAction[2] === 'auth'
          ? {
              authorizationUrl: `https://example.test/mcp/${name}/authorize`,
              oauthState: `oauth-${name}`,
            }
          : item ?? { name, status: 'pending' },
      );
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
          url: `http://127.0.0.1/webhooks/${nextId}/receive`,
        };
        state.webhooks.unshift({ ...item, secret: undefined });
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'POST' && id && action === 'rotate-secret') {
        const item = find(state.webhooks, id);
        sendJson(res, 200, {
          ...clone(item),
          secret: 'rotated-e2e-webhook-secret',
        });
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
      if (req.method === 'POST' && parts.length === 1) {
        const slug = String(body?.label ?? createdId('profile'))
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const item = {
          id: slug || createdId('profile'),
          ...body,
          projection: { status: 'projected', updatedAt: now() },
        };
        state.profiles.unshift(item);
        sendJson(res, 201, clone(item));
        return true;
      }
      if (req.method === 'PATCH' && id) {
        if (body?.systemPrompt === 'forbidden profile change') {
          sendJson(res, 403, {
            error: {
              code: 'FORBIDDEN',
              message: 'Only workspace administrators can edit agent profiles.',
            },
          });
          return true;
        }
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
      if (req.method === 'DELETE' && id) {
        remove(state.profiles, id);
        endEmpty(res);
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
      if (req.method === 'PATCH' && id) {
        Object.assign(find(state.cookbook, id) ?? {}, body, { updatedAt: now() });
        sendJson(res, 200, clone(find(state.cookbook, id)));
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

    if (resource === 'agent-designs') {
      if (req.method === 'GET' && parts.length === 1) {
        sendJson(res, 200, clone(state.designs));
        return true;
      }
      if (req.method === 'GET' && id && parts.length === 2) {
        sendJson(res, 200, clone(find(state.designs, id)));
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
