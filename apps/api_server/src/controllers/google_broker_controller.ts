import type { NextFunction, Request, Response } from 'express';
import { GmailApiService } from '../integrations/gmail/gmail_api_service';
import { GoogleCalendarService } from '../integrations/google_calendar/google_calendar_service';
import { NeedsScopeUpgradeError } from '../integrations/google_scope_guard';
import { IntegrationsService } from '../services/integrations_service';

const integrationsService = new IntegrationsService();
const calendar = new GoogleCalendarService();
const gmail = new GmailApiService();

/**
 * Brokered Google tools (F3) — mirrors the PlanningCenter broker. Each handler
 * refreshes the stored Google credential and delegates to the integration
 * helper. A `NeedsScopeUpgradeError` (the credential lacks a write scope) is
 * mapped to a structured HTTP 409 so callers can prompt a re-consent; anything
 * else flows to the Express error handler.
 */
export class GoogleBrokerController {
  private handleError(err: unknown, res: Response, next: NextFunction) {
    if (err instanceof NeedsScopeUpgradeError) {
      res
        .status(409)
        .json({ code: 'needs_scope_upgrade', requiredScope: err.requiredScope });
      return;
    }
    next(err);
  }

  async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const calendarId = (req.query.calendarId as string) || 'primary';
      const result = await calendar.listUpcomingEvents(account, [calendarId]);
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const { calendarId, summary, start, end, location, description } =
        req.body as Record<string, string | undefined>;
      const result = await calendar.createEvent(account, calendarId ?? 'primary', {
        summary,
        start: { dateTime: start },
        end: { dateTime: end },
        location,
        description,
      });
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const { calendarId, ...patch } = req.body as Record<string, unknown>;
      const result = await calendar.updateEvent(
        account,
        (calendarId as string) ?? 'primary',
        req.params.id,
        patch,
      );
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async deleteEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const calendarId = (req.query.calendarId as string) || 'primary';
      await calendar.deleteEvent(account, calendarId, req.params.id);
      res.status(204).end();
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async searchGmail(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const result = await gmail.searchMessages(
        account,
        (req.query.q as string) ?? '',
      );
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async readEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const result = await gmail.readMessage(account, req.params.id);
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await integrationsService.ensureFreshGoogleAccount(
        req.auth!.user.id,
      );
      const { to, subject, body } = req.body as Record<string, string>;
      const result = await gmail.sendMessage(account, { to, subject, body });
      res.json(result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  }
}
