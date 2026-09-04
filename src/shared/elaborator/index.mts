// TODO: extract to types.mts
import { Trace as TraceV2 } from './trace_v2.mjs';

import * as A from './analysis.mjs';
import * as E from './elaboration.mjs';
import * as C from './presentation.mjs';
import * as P from './parsing.mjs';

export function elaborate(input: string): { cards: TraceV2, elaborated: E.Elaboration } {
  const raw = P.parseTrace(input);
  const elaborated = E.elaborateSteps(raw);
  const analysis = A.analyze(elaborated.steps);
  const cards = C.materialize(elaborated, analysis);
  return { cards, elaborated };
}
