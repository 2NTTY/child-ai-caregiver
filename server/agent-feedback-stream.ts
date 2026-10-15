import type { AgentProgress } from '../src/shared/agent-feedback.ts';

/** One response channel, not an execution queue. Disconnect never starts or cancels a business operation. */
export function agentFeedbackStream(execute: (publish: (progress: AgentProgress) => void) => Promise<Response>,
  isCurrentUser: () => Promise<boolean>): Response {
  const encoder = new TextEncoder(); let closed = false, heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let pending = Promise.resolve(), count = 0;
      const send = (value: unknown, terminal = false) => {
        if (closed || !terminal && (controller.desiredSize ?? 0) <= 0) return;
        const frame = encoder.encode('data: ' + JSON.stringify(value) + '\n\n');
        if (frame.length > 256 * 1024) throw new Error('feedback_frame_limit');
        controller.enqueue(frame);
      };
      const publish = (progress: AgentProgress) => {
        if (closed || count++ >= 48) return;
        pending = pending.then(async () => {
          if (!closed && await isCurrentUser()) send({ type: 'progress', progress }, progress.phase === 'help' || progress.phase === 'started');
        }).catch(() => {});
      };
      heartbeat = setInterval(() => { if (!closed && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 15000);
      void (async () => {
        try {
          const response = await execute(publish);
          await pending;
          if (!closed) {
            if (await isCurrentUser()) send({ type: 'result', status: response.status, body: await response.json() }, true);
            else send({ type: 'result', status: 401, body: { error: { code: 'unauthorized', message: '登入已失效。' } } }, true);
          }
        } catch {
          if (!closed) send({ type: 'result', status: 503, body: { error: { code: 'ai_unavailable', message: '未能確認結果，請查核原運行。' } } }, true);
        } finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'private, no-store, no-transform', 'x-accel-buffering': 'no' } });
}
