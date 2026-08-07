export interface SseFrame {
  event: string;
  data: string;
}

export function parseSseBuffer(buffer: string, flush = false): {
  frames: SseFrame[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const remainder = flush ? '' : (parts.pop() ?? '');
  const complete = flush ? parts.filter(Boolean) : parts;
  const frames = complete.flatMap((block) => {
    let event = 'message';
    const data: string[] = [];
    block.split('\n').forEach((line) => {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    });
    return data.length > 0 ? [{ event, data: data.join('\n') }] : [];
  });
  return { frames, remainder };
}

export async function* readSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parsed = parseSseBuffer(buffer, done);
      buffer = parsed.remainder;
      for (const frame of parsed.frames) yield frame;
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
