import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { JobRecord, ProductionProject } from './types.ts';

class StudioEventBus extends EventEmitter {
  private clients = new Set<{ res: Response; jobId?: string }>();

  registerClient(res: Response, jobId?: string): () => void {
    const client = { res, jobId };
    this.clients.add(client);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: keepalive\n\n`);
      }
    }, 20000);

    return () => {
      clearInterval(keepAlive);
      this.clients.delete(client);
    };
  }

  emitJobUpdate(job: JobRecord): void {
    const payload = JSON.stringify(job);
    for (const client of this.clients) {
      if (client.res.writableEnded) continue;
      if (client.jobId && client.jobId !== job.id) continue;
      client.res.write(`event: job\ndata: ${payload}\n\n`);
    }
  }

  emitProjectUpdate(project: ProductionProject): void {
    const payload = JSON.stringify(project);
    for (const client of this.clients) {
      if (client.res.writableEnded || client.jobId) continue;
      client.res.write(`event: project\ndata: ${payload}\n\n`);
    }
  }
}

export const eventBus = new StudioEventBus();
