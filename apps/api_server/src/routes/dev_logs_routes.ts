import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  apiServerLogPath,
  isLoopbackAddress,
  readApiLogTail,
} from '../utils/logger';

export const devLogsRouter = Router();

export function requireLoopbackDevLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'LOOPBACK_ONLY' });
    return;
  }
  next();
}

devLogsRouter.use(requireLoopbackDevLogs);

devLogsRouter.get('/logs/tail', (req, res) => {
  const requested = Number(req.query.lines ?? 200);
  const lines = Number.isFinite(requested) ? requested : 200;
  const logPath = apiServerLogPath();
  res.json({
    path: logPath,
    lines: readApiLogTail(logPath, lines),
  });
});
