import { agentProgressSchema, type AgentProgress } from '../shared/agent-feedback.ts';

/** Bounded SSE decoding. Missing final receipt is unknown, never an invitation to POST again. */
export async function readAgentFeedback(response: Response, onProgress: (event: AgentProgress) => void): Promise<{ status: number; body: unknown }> {
  if (!response.body) throw new Error('feedback_body_missing');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('feedback_result_missing');
      bytes += value.byteLength; if (bytes > 512 * 1024) throw new Error('feedback_limit');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('feedback_invalid');
        if (event.type === 'progress' && 'progress' in event) onProgress(agentProgressSchema.parse(event.progress));
        else if (event.type === 'result' && 'status' in event && Number.isInteger(event.status) && Number(event.status) >= 200 && Number(event.status) <= 599 && 'body' in event)
          return { status: Number(event.status), body: event.body };
        else throw new Error('feedback_invalid');
      }
      if (buffer.length > 256 * 1024) throw new Error('feedback_frame_limit');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
