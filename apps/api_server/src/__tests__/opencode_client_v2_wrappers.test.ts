/**
 * OCU-27 (#1068) — contract tests for the direct-fetch shims converted to
 * typed v2 SDK calls: listSkills, listSkillsWithContent, listQuestions,
 * replyToQuestion, rejectQuestion. Asserts each produces the SAME request
 * shape (method params) the prior raw fetch sent, and that responses map
 * through unchanged.
 *
 * Uses __setTestV2Client (mirrors __setTestClient for the v1 client) since
 * the real v2 client is created via a runtime dynamic `import()` vitest
 * cannot intercept.
 */
import { describe, expect, it, vi } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

function svcWithV2Client(client: any): OpencodeClientService {
  const s = new OpencodeClientService();
  s.__setTestV2Client(client);
  return s;
}

describe('v2 SDK wrappers (OCU-27 #1068)', () => {
  describe('#1132 fork-only generated methods', () => {
    it('updates MCP and skill allowlists through session.update, including null clear', async () => {
      const update = vi.fn().mockResolvedValue({ data: { id: 'sdk-1' } });
      const s = svcWithV2Client({ session: { update } });

      await expect(s.updateSessionAllowlist('sdk-1', null)).resolves.toBe(true);
      await expect(s.updateSessionSkillAllowlist('sdk-1', null)).resolves.toBe(true);
      await expect(s.updateSessionSkillAllowlist('sdk-1', ['coding-agent'])).resolves.toBe(true);

      expect(update).toHaveBeenNthCalledWith(1, {
        sessionID: 'sdk-1',
        mcpAllowlist: null,
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        sessionID: 'sdk-1',
        skillAllowlist: null,
      });
      expect(update).toHaveBeenNthCalledWith(3, {
        sessionID: 'sdk-1',
        skillAllowlist: { skills: ['coding-agent'] },
      });
    });

    it('reloads skills through app.skills2.reload and maps the generated response', async () => {
      const reload = vi.fn().mockResolvedValue({
        data: [
          {
            name: 'coding-agent',
            description: 'implements issues',
            location: '/skills/coding-agent',
            content: '# coding-agent',
          },
        ],
      });
      const s = svcWithV2Client({ app: { skills2: { reload } } });

      await expect(s.reloadSkills('/work')).resolves.toEqual([
        {
          name: 'coding-agent',
          description: 'implements issues',
          location: '/skills/coding-agent',
        },
      ]);
      expect(reload).toHaveBeenCalledWith({ directory: '/work' });
    });

    it('reloads default and directory config instances through app.config.reload', async () => {
      const reload = vi.fn().mockResolvedValue({ data: true });
      const s = svcWithV2Client({ app: { config: { reload } } });

      await expect(s.reloadConfig('/work')).resolves.toBe(true);
      expect(reload).toHaveBeenNthCalledWith(1, undefined);
      expect(reload).toHaveBeenNthCalledWith(2, { directory: '/work' });
    });

    it('preserves fail-safe results for generated error envelopes', async () => {
      const error = { message: 'engine unavailable' };
      const s = svcWithV2Client({
        session: { update: vi.fn().mockResolvedValue({ error }) },
        app: {
          skills2: { reload: vi.fn().mockResolvedValue({ error }) },
          config: { reload: vi.fn().mockResolvedValue({ error }) },
        },
      });

      await expect(s.updateSessionAllowlist('sdk-1', null)).resolves.toBe(false);
      await expect(s.updateSessionSkillAllowlist('sdk-1', null)).resolves.toBe(false);
      await expect(s.reloadSkills()).resolves.toEqual([]);
      await expect(s.reloadConfig()).resolves.toBe(false);
    });
  });

  describe('listSkills / listSkillsWithContent — client.app.skills()', () => {
    const skills = vi.fn().mockResolvedValue({
      data: [
        { name: 'coding-agent', description: 'implements issues', location: 'managed', content: '# coding-agent\nbody' },
      ],
    });

    it('listSkills calls app.skills with directory and strips content', async () => {
      const s = svcWithV2Client({ app: { skills } });
      const result = await s.listSkills('/work');
      expect(skills).toHaveBeenCalledWith({ directory: '/work' });
      expect(result).toEqual([
        { name: 'coding-agent', description: 'implements issues', location: 'managed' },
      ]);
    });

    it('listSkillsWithContent calls app.skills with directory and keeps content', async () => {
      const s = svcWithV2Client({ app: { skills } });
      const result = await s.listSkillsWithContent('/work');
      expect(skills).toHaveBeenCalledWith({ directory: '/work' });
      expect(result).toEqual([
        {
          name: 'coding-agent',
          description: 'implements issues',
          location: 'managed',
          content: '# coding-agent\nbody',
        },
      ]);
    });

    it('both return [] on an error envelope (never throw)', async () => {
      const s = svcWithV2Client({ app: { skills: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) } });
      await expect(s.listSkills()).resolves.toEqual([]);
      await expect(s.listSkillsWithContent()).resolves.toEqual([]);
    });
  });

  describe('listQuestions — client.question.list()', () => {
    it('calls question.list with directory and returns the raw data array', async () => {
      const data = [{ id: 'q1', sessionID: 'sdk-1', questions: [{ question: 'ok?', header: 'ok', options: [] }] }];
      const list = vi.fn().mockResolvedValue({ data });
      const s = svcWithV2Client({ question: { list } });
      const result = await s.listQuestions('/proj');
      expect(list).toHaveBeenCalledWith({ directory: '/proj' });
      expect(result).toEqual(data);
    });

    it('returns [] on error envelope or thrown exception', async () => {
      const s1 = svcWithV2Client({ question: { list: vi.fn().mockResolvedValue({ error: { message: 'x' } }) } });
      await expect(s1.listQuestions()).resolves.toEqual([]);
      const s2 = svcWithV2Client({ question: { list: vi.fn().mockRejectedValue(new Error('down')) } });
      await expect(s2.listQuestions()).resolves.toEqual([]);
    });
  });

  describe('replyToQuestion — client.question.reply()', () => {
    it('calls question.reply with requestID, answers, directory', async () => {
      const reply = vi.fn().mockResolvedValue({ data: true });
      const s = svcWithV2Client({ question: { reply } });
      const ok = await s.replyToQuestion('req-1', [['Yes']], '/proj');
      expect(reply).toHaveBeenCalledWith({ requestID: 'req-1', answers: [['Yes']], directory: '/proj' });
      expect(ok).toBe(true);
    });

    it('returns false on error envelope or thrown exception (never throws)', async () => {
      const s1 = svcWithV2Client({ question: { reply: vi.fn().mockResolvedValue({ error: { message: 'x' } }) } });
      await expect(s1.replyToQuestion('req-2', [['No']])).resolves.toBe(false);
      const s2 = svcWithV2Client({ question: { reply: vi.fn().mockRejectedValue(new Error('down')) } });
      await expect(s2.replyToQuestion('req-3', [['No']])).resolves.toBe(false);
    });
  });

  describe('rejectQuestion — client.question.reject()', () => {
    it('calls question.reject with requestID, directory', async () => {
      const reject = vi.fn().mockResolvedValue({ data: true });
      const s = svcWithV2Client({ question: { reject } });
      const ok = await s.rejectQuestion('req-9', '/proj');
      expect(reject).toHaveBeenCalledWith({ requestID: 'req-9', directory: '/proj' });
      expect(ok).toBe(true);
    });

    it('returns false on error envelope (never throws)', async () => {
      const s = svcWithV2Client({ question: { reject: vi.fn().mockResolvedValue({ error: { message: 'x' } }) } });
      await expect(s.rejectQuestion('req-10')).resolves.toBe(false);
    });
  });
});
