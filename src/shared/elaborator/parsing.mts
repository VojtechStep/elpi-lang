import { readItem as readItem1 } from './trace_v1.mjs';
import { readItem as readItem2 } from './trace_v2.mjs';
import { readItem as readItem3 } from './trace_v3.mjs';
import StepMap from './StepMap.mjs';
import type { Timed, Timestamped, ParsedTrace } from './types.mjs';

export type Parsable = {
  kind: { kind: string }[],
  step: number,
  runtime_id: number,
};
export type Parser<T extends Parsable> = (x: any) => T;
export type Parsed<T> = Timestamped<{ items: Timed<{ item: T }>[] }>;

function runParser<T extends Parsable>(parser: Parser<T>, input: string): { steps: StepMap<Parsed<T>>, meta: T[]} {
  const steps: StepMap<Parsed<T>> = new StepMap();
  const meta: T[] = [];

  let tick = 0;
  input.split(/\n/).forEach(line => {
    if (!line) return;

    const item = parser(JSON.parse(line));
    if (item.kind.length !== 1)
      return;
    if (item.kind[0]?.kind === 'Meta') {
      meta.push(item);
      return;
    }
    if (item.kind[0]?.kind !== 'Info') {
      return;
    }

    tick += 1;
    const id = { step: item.step, runtime: item.runtime_id };
    const next = steps.get(id) ?? {
      timestamp: { start: tick, stop: tick },
      items: []
    };
    next.timestamp.stop = tick;
    next.items.push({
      time: tick,
      item
    });

    steps.set(id, next)
  })

  return { steps, meta };
}

export function parseTrace(input: string): ParsedTrace {
  const [header] = input.split('\n', 1);
  if (!header) {
    throw new Error('Trace with no newline');
  }
  try {
    // The header should be version independent
    const h = readItem3(JSON.parse(header));
    if (h.kind[0]?.kind !== 'Meta' || h.payload[0] !== '3') {
      throw new Error('Unknown trace format')
    }
    return { kind: 'V3', ...runParser(readItem3, input) }
  } catch {
    try {
      return { kind: 'V2', ...runParser(readItem2, input) }
    } catch {
      try {
        return { kind: 'V1', ...runParser(readItem1, input) }
      } catch (e) {
        throw new Error('Trace format not recognized')
      }
    }
  }
}
