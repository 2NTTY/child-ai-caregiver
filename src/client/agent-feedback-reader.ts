import { agentProgressSchema, type AgentProgress } from '../shared/agent-feedback.ts';

type FeedbackResult = { status: number; body: unknown };

/** Bounded SSE decoding. Missing final receipt is unknown, never an invitation to POST again. */
export async function readAgentFeedback(response: Response, onProgress: (event: AgentProgress) => void,
  onResult?: (result: FeedbackResult) => void, onActivity?: () => void): Promise<FeedbackResult> {
  if (!response.body) throw new Error('feedback_body_missing');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('feedback_result_missing');
      if (value.byteLength) onActivity?.();
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
        else if (event.type === 'result' && 'status' in event && Number.isInteger(event.status) && Number(event.status) >= 200 && Number(event.status) <= 599 && 'body' in event) {
          const result = { status: Number(event.status), body: event.body };
          onResult?.(result); // At frame observation, before asynchronous stream cleanup.
          return result;
        }
        else throw new Error('feedback_invalid');
      }
      if (buffer.length > 256 * 1024) throw new Error('feedback_frame_limit');
    }
  } finally {
    // Cancel releases transport resources. Its acknowledgement is not part of the reply receipt.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
