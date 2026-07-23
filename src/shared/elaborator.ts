// TODO: this should end up in types
import type * as C from './trace_v2.js';
import { RuntimeId, Item, Kind, RawTrace, readItem, Stop } from './trace_v2.js';

import * as D from './decode.js';
import type { CHRAttempt, Constraint, Cut, Event, FileLocation, GoalId, Location, R, StepId, StepIdx, Time, TimedItem, Timestamp, V } from './types.js';
import StepMap, { SortedStepMap } from './StepMap.js'

// Note: some of the Map operations can be cleaner with the new API
// available in Node 26

type GoalMap<T> = Map<GoalId, T>;
type GoalSet = Set<GoalId>;

type RawStep = {
  timestamp: Timestamp,
  items: TimedItem[]
};

class Unreachable extends Error {
  constructor(proof: never) {
    super(`This code path was assumed to be unreachable, but object was not handled: ${proof}`)
  }
}

namespace Elaborate {

  export type Outcome =
    | R<'Success', { siblings: GoalId[] }>
    | R<'Fail'>;

  type BuiltinRule = {
    name: string,
    kind: 'Logic' | 'FFI',
    payload: string[]
  };

  type UserRule = {
    ruleText: string,
    ruleLoc: Location,
  };

  export type Rule =
    | R<'BuiltinRule', V<BuiltinRule>>
    | R<'UserRule', V<UserRule>>;

  export type Attempt = {
    loc: Location,
    code: string,
    events: Event[]
  };

  type Action =
    | R<'Builtin', { name: BuiltinRule, outcome: Outcome, events: Event[] }>
    | R<'Backchain', { trylist: Attempt[], outcome: Outcome }>

  export type ResumeStep = R<'Resume', V<{ goalId: GoalId, goal: string }[]>>;
  export type Step =
    | R<'Init', { goalId: GoalId }>
    | R<'Findall', { goal: string, goalId: GoalId, timestamp: Timestamp, result: string[] }>
    | R<'Inference', { goal: string, pred: string, goalId: GoalId, action: Action, rid: number }>
    | R<'Suspend', { goal: string, goalId: GoalId, sibling: GoalId }>
    | R<'Cut', { goalId: GoalId, cut: Cut[] }>
    | ResumeStep
    | R<'CHR', { failed: CHRAttempt[], successful: CHRAttempt[], storeBefore: Constraint[], storeAfter: Constraint[] }>
    | R<'Broken', { step: StepIdx, time: Time }>;

  export type TimedStep = {
    timestamp: Timestamp,
    step: Step
  }

  class ElaborationError extends Error {
    public step: RawStep;
    constructor(message: string, step: RawStep) {
      super(message);
      this.name = 'ElaborationError';
      this.step = step;
    }
  }

  function builtinName(l: TimedItem[]): BuiltinRule | null {
    const name = D.has('user:rule:builtin:name', l);
    if (!name)
      return null;
    return {
      kind: 'FFI',
      name: D.decodeString(name),
      payload: []
    }
  }

  function pushFrame(
    stepId: StepId,
    goalId: GoalId,
    rule: Rule,
    siblings: GoalId[],
    stacks: StepMap<Stack>,
    seedStacks: GoalMap<Stack>
  ) {
    const thisStack = stacks.get(stepId) ?? seedStacks.get(goalId) ?? [];
    const newStack: Stack = [{ rule, stepId }, ...thisStack];
    stacks.set(stepId, newStack);
    siblings.forEach(g => {
      seedStacks.set(g, newStack);
    })
  }

  function updateSeedFrame(
    stepId: StepId,
    goalId: GoalId,
    rule: Rule,
    seedStacks: GoalMap<Stack>
  ) {
    const thisStack = seedStacks.get(goalId) ?? [];
    const newStack: Stack = [{ rule, stepId }, ...thisStack];
    seedStacks.set(goalId, newStack);
  }

  function pushEndFrame(
    stepId: StepId,
    goalId: GoalId,
    stacks: StepMap<Stack>,
    seedStacks: GoalMap<Stack>
  ) {
    const thisStack = stacks.get(stepId) ?? seedStacks.get(goalId) ?? [];
    stacks.set(stepId, thisStack)
  }

  function elaborateStep(
    stepId: StepId,
    step: RawStep,
    stacks: StepMap<Stack>,
    seedStacks: GoalMap<Stack>
  ): Step {
    const { runtime: rid, step: stepIdx } = stepId;
    const { items } = step;
    if (!items.every(i => i.item.runtime_id === rid)) {
      throw new ElaborationError('Found step with multiple runtime IDs', step);
    }
    const decoded = D.decodeStep(items);
    switch (decoded.kind) {
      case 'Init':
      case 'Broken':
        return decoded;
      case 'Findall': {
        const { goal_id: goalId, payload: [_pred, goal] } = decoded.origin.item;
        const result = D.all('user:assign', asm => ({
          payload: D.decodeString(asm), time: asm.time
        }), items);
        if (result.length === 0) {
          // TODO: should this be an elaboration error?
          throw new ElaborationError('Findall without assignment', step)
        }
        pushFrame(
          stepId,
          goalId,
          {
            kind: 'BuiltinRule',
            value: {
              kind: 'FFI',
              name: 'findall',
              payload: []
            }
          },
          [],
          stacks, seedStacks
        )
        return {
          kind: 'Findall',
          goal, goalId,
          result: result.map(a => a.payload),
          // TODO: is this why we reverse items? And [0] should be .last()?
          timestamp: { start: decoded.start, stop: result[0].time }
        }
      }
      case 'Suspend': {
        const { goal_id: goalId, payload: [_pred, goal] } = decoded.value.item;
        const siblings = D.all('user:subgoal', D.decodeInt, items);
        if (siblings.length !== 1) {
          throw new ElaborationError(`Suspension expects one subgoal, found ${siblings.length}`, step);
        }
        pushFrame(
          stepId,
          goalId,
          {
            kind: 'BuiltinRule',
            value: {
              kind: 'Logic',
              name: 'suspend',
              payload: []
            }
          },
          siblings,
          stacks, seedStacks
        )
        return {
          kind: 'Suspend',
          goal, goalId, sibling: siblings[0]
        }
      }
      case 'Cut': {
        const { goal_id: goalId, payload: [_pred, _goal] } = decoded.value.item;
        const cut = D.all('user:rule:cut:branch', D.decodeCut, items);
        pushFrame(
          stepId,
          goalId,
          {
            kind: 'BuiltinRule',
            value: {
              kind: 'FFI',
              name: '!',
              payload: []
            }
          },
          [],
          stacks, seedStacks
        )
        return {
          kind: 'Cut',
          goalId, cut
        }
      }
      case 'Resumption': {
        const resumed = decoded.value.map(item => {
          const { item: { goal_id: goalId } } = item;
          // TODO: understand this
          updateSeedFrame(
            stepId,
            goalId,
            {
              kind: 'BuiltinRule',
              value: {
                kind: 'Logic',
                name: 'resume',
                payload: []
              }
            },
            seedStacks
          )
          return { goalId: item.item.goal_id, goal: D.decodeString(item) }
        });
        return {
          kind: 'Resume',
          value: resumed
        };
      }
      case 'CHR': {
        const trylist = D.chrEventChains('user:CHR:try', items);
        const { successful, failed } = D.decodeCHRTryList(trylist);
        const { storeBefore, storeAfter } = decoded;
        return {
          kind: 'CHR',
          successful, failed, storeBefore, storeAfter
        }
      }
      case 'Focus': {
        const { item: { goal_id: goalId, payload: [pred, goal] }, time } = decoded.value;
        const rule = D.has('user:rule', items);
        if (!rule || rule.item.payload.length !== 1) {
          throw new ElaborationError('Malformed execution step', step)
        }
        const [name] = rule.item.payload;
        const siblings = D.all('user:subgoal', D.decodeInt, items);

        let outcome: Outcome;
        {
          const result = D.has(`user:rule:${name}`, items);
          if (result?.item.payload[0] === 'success') {
            outcome = { kind: 'Success', siblings }
          } else if (result?.item.payload[0] === 'fail') {
            outcome = { kind: 'Fail' }
          } else {
            return {
              kind: 'Broken',
              step: stepIdx,
              time
            };
          }
        }

        let action: Action;
        switch (name) {
          case 'backchain': {
            const trylist = D.inferChains('user:rule:backchain:try', items)
                             .map(c => D.decodeInferAttempt(c));
            if (trylist.length !== 0) {
              pushFrame(
                stepId,
                goalId,
                {
                  kind: 'UserRule',
                  value: {
                    ruleLoc: trylist[0].loc,
                    ruleText: trylist[0].code
                  }
                },
                siblings,
                stacks, seedStacks
              )
            } else {
              if (siblings.length !== 0) {
                throw new ElaborationError('Backchain step has siblings but no attempts left', step)
              }
              pushEndFrame(stepId, goalId, stacks, seedStacks)
            }
            action = {
              kind: 'Backchain',
              trylist, outcome
            }
            break;
          }
          case 'builtin': {
            const name = builtinName(items);
            if (!name) {
              throw new ElaborationError('Builtin has no name', step);
            }
            pushFrame(
              stepId,
              goalId,
              {
                kind: 'BuiltinRule',
                value: name
              },
              siblings,
              stacks,
              seedStacks
            )
            const events = D.inferChains('user:rule:builtin:name', items);
            if (events.length !== 1) {
              // TODO: what does this mean?
              throw new ElaborationError('Builtin step produced unexpected number of inferences', step)
            }
            action = {
              kind: 'Builtin',
              name, outcome,
              events: events[0].tail.map(e => D.decodeInferEvent(e))
            }
            break;
          }
          case 'implication': {
            const newHypsItem = D.has('user:new-hyps', items);
            const newHyps = newHypsItem?.item.payload ?? [];
            pushFrame(
              stepId,
              goalId,
              {
                kind: 'BuiltinRule',
                value: {
                  kind: 'Logic',
                  name: 'implication',
                  payload: newHyps
                }
              },
              siblings,
              stacks,
              seedStacks
            )
            action = {
              kind: 'Builtin',
              name: {
                name,
                kind: 'Logic',
                payload: []
              },
              events: [],
              outcome,
            }
            break;
          }
          default: {
            const ruleName: BuiltinRule = {
              kind: 'Logic',
              name,
              payload: []
            };
            pushFrame(
              stepId,
              goalId,
              {
                kind: 'BuiltinRule',
                value: ruleName
              },
              siblings,
              stacks,
              seedStacks
            )
            const events = D.inferChains('user:rule:builtin:name', items);
            action = {
              kind: 'Builtin',
              name: ruleName,
              events: (events.length > 0)
                ? events[0].tail.map(e => D.decodeInferEvent(e))
                : [],
              outcome
            }
            break;
          }
        }

        return {
          kind: 'Inference',
          goalId, goal, pred, rid, action
        }
      }
      default:
        throw new Unreachable(decoded)
    }
  }

  export type Frame = {
    rule: Rule,
    stepId: StepId
  };

  export type Stack = Frame[];

  export type Elaboration = {
    steps: SortedStepMap<TimedStep>,
    stackFrames: StepMap<Stack>,
    goalText: GoalMap<string>
  };

  export function elaborateSteps(steps: StepMap<RawStep>): Elaboration {
    const goals: GoalMap<string> = new Map();
    const elaborated: StepMap<TimedStep> = new StepMap();
    const stacks: StepMap<Stack> = new StepMap();
    const seedStacks: GoalMap<Stack> = new Map();

    steps.forEach((val, key) => {
      val.items.forEach(i => {
        const goal = D.has('user:newgoal', [i]);
        if (goal) {
          goals.set(goal.item.goal_id, D.decodeString(goal));
        }
      })

      elaborated.set(key, {
        timestamp: val.timestamp,
        step: elaborateStep(key, val, stacks, seedStacks)
      });
    });

    return {
      goalText: goals,
      steps: elaborated.increasing(),
      stackFrames: stacks
    }
  }
}

namespace Analyze {
  export type GoalAttempt = StepId;
  export type GoalAttempts = {
    successful: GoalAttempt[],
    failing: GoalAttempt[]
  }

  export type Analysis = {
    successful: GoalSet,
    attempts: GoalMap<GoalAttempts>
  }

  export function analyze(steps: SortedStepMap<Elaborate.TimedStep>): Analysis {
    const success: Set<GoalId> = new Set();

    // TODO This is weird: the OCaml implementation's default ordering is decreasing,
    // and then this is iterated in reverse, so in increasing order.
    // But we are analysing siblings, which come after a goal, so they have no
    // chance of being added yet???
    steps.decreasing().forEach(({ step }) => {
      switch (step.kind) {
        case 'Init':
        case 'Broken':
        case 'Resume':
        case 'CHR':
          break;
        case 'Suspend':
        case 'Cut':
        case 'Findall':
          success.add(step.goalId)
          break;
        case 'Inference':
          if (step.action.outcome.kind === 'Fail') {
            break;
          }
          const siblingsSuccessful =
            step.action.outcome.siblings.every(g => success.has(g))
          if (siblingsSuccessful) {
            success.add(step.goalId)
          }
          break;
        default:
          throw new Unreachable(step)
      }
    })

    const attempts: GoalMap<GoalAttempts> = new Map();
    // Steps are already sorted in increasing order
    steps.forEach(({ step }, stepId) => {
      switch (step.kind) {
        case 'Init':
        case 'Broken':
        case 'Resume':
        case 'CHR':
        case 'Suspend':
        case 'Cut':
        case 'Findall':
          break;
        case 'Inference':
          if (step.action.kind === 'Builtin') {
            break;
          }
          // Note: pushing instead of consing, look into consequences
          if (step.action.outcome.kind === 'Success') {
            const prev = attempts.get(step.goalId);
            if (prev) {
              prev.successful.push(stepId);
            } else {
              attempts.set(step.goalId, {
                successful: [stepId],
                failing: []
              });
            }
          }
          if (step.action.outcome.kind === 'Fail') {
            const prev = attempts.get(step.goalId);
            if (prev) {
              prev.failing.push(stepId);
            } else {
              attempts.set(step.goalId, {
                successful: [],
                failing: [stepId]
              });
            }
          }
          break;
        default:
          throw new Unreachable(step)
      }
    })

    return {
      successful: success,
      attempts
    };
  }
}

namespace Cards {
  import E = Elaborate;
  export class CardError extends Error {
    constructor(message: string) {
      super(message)
    }
  }

  function getGoalText<T>(key: GoalId, map: GoalMap<T>): T {
    const result = map.get(key);
    if (!result)
      throw new CardError(`Goal text not found for goal ${key}`);
    return result;
  }

  function getStack(key: StepId, map: StepMap<E.Stack>): E.Stack {
    const result = map.get(key);
    if (!result)
      throw new CardError(`Stack not found for step ${key}`);
    return result;
  }

  type PreCut = {
    goalId: GoalId,
    goal: string,
    cutBranch: {
      clause: string,
      loc: Location
    }
  };

  type Attempt = {
    rule: E.Rule,
    events: Event[]
  }

  type SuccessfulAttempt = {
    attempt: Attempt,
    siblings: { goalId: GoalId, goal: string }[],
    siblingsOutcome: 'Fail' | 'Success'
  }

  type Inference = {
    goalId: GoalId,
    goal: string,
    predicate: string,
    failed: Attempt[],
    successful: { current: SuccessfulAttempt, more: StepIdx[] } | null,
    moreFailed: StepIdx[],
    stack: E.Stack
  };

  type PreStep =
    | R<'Init', { goalId: GoalId, goal: string }>
    | R<'Findall_TODO', { goal: string, goalId: GoalId, timestamp: Timestamp, result: string[] }>
    | R<'CHR_TODO', { failed: CHRAttempt[], successful: CHRAttempt[], storeBefore: Constraint[], storeAfter: Constraint[] }>
    | R<'Cut', { goalId: GoalId, cuts: PreCut[] }>
    | R<'Resume', V<{ goalId: GoalId, goal: string }[]>>
    | R<'Suspend', {
      goalId: GoalId,
      goal: string,
      siblingId: GoalId,
      sibling: string,
      stack: E.Stack
    }>
    | R<'Inference', Inference>;

  type PreCard = {
    timestamp: Timestamp,
    stepId: StepId,
    step: PreStep
  };

  type Color = C.Color['kind'];

  function contained(outer: Timestamp, inner: Timestamp): boolean {
    return outer.start < inner.start && inner.stop <= outer.stop
  }

  const toColor = (color: Color): C.Color => ({ kind: color })

  const toGoal = (g: {goalId: GoalId, goal: string}) => ({
    goal_id: g.goalId,
    goal_text: g.goal
  });
  const toConstraint = (c: Constraint): C.Goal => ({
    goal_id: c.id,
    goal_text: c.text
  })
  const toLoc = (l: Location): C.Location => {
    if (l.kind === 'Context') {
      return { kind: 'Context', value: l.step }
    }
    if (l.kind === 'File') {
      return { kind: 'File', value: l.file }
    }
    throw new Unreachable(l)
  }
  const toRule = (r: E.Rule): C.Rule => {
    if (r.kind === 'BuiltinRule') {
      return {
        kind: 'BuiltinRule',
        value: { ...r.value, kind: { kind: r.value.kind } }
      }
    }
    if (r.kind === 'UserRule') {
      return {
        kind: 'UserRule',
        value: { rule_text: r.value.ruleText, rule_loc: toLoc(r.value.ruleLoc) }
      }
    }
    throw new Unreachable(r)
  }
  const toEvent = (e: Event): C.Event => {
    if (e.kind === 'Assign') {
      return { kind: 'Assign', value: e.repr }
    }
    if (e.kind === 'Fail') {
      return { kind: 'Fail', value: e.failedGoal }
    }
    if (e.kind === 'ResumeGoal') {
      return { kind: 'ResumeGoal', value: e.goals }
    }
    throw new Unreachable(e)
  };
  const toAttempt = (a: Attempt): C.Attempt => ({
    rule: toRule(a.rule),
    events: a.events.map(toEvent)
  })
  const toSuccess = (e: SuccessfulAttempt): C.SuccessfulAttempt => ({
    attempt: toAttempt(e.attempt),
    siblings: e.siblings.map(toGoal),
    siblings_aggregated_outcome: { kind: e.siblingsOutcome }
  })
  const toFrame = (e: E.Frame): C.Frame => ({
    rule: toRule(e.rule),
    step_id: e.stepId.step,
    runtime_id: e.stepId.runtime
  });

  export function materialize(
    elaboration: E.Elaboration,
    analysis: Analyze.Analysis
  ): C.Trace {
    const preCards: PreCard[] = [];
    const broken: { step: StepIdx, time: Time }[] = [];
    let maxStepIdx = Number.MIN_SAFE_INTEGER;
    let minRuntimeIdx = Number.MAX_SAFE_INTEGER;

    // TODO: Some of the later processing might be merged into this pass
    elaboration.steps.forEach(({ timestamp, step }, stepId) => {
      let preStep: PreStep;
      switch (step.kind) {
        case 'Broken':
          broken.push({ time: step.time, step: step.step })
          return
        case 'Resume':
          preStep = step;
          break;
        case 'Findall':
          preStep = { ...step, kind: 'Findall_TODO' }
          break;
        case 'CHR':
          preStep = { ...step, kind: 'CHR_TODO' }
          break;
        case 'Init':
          preStep = {
            ...step,
            goal: getGoalText(step.goalId, elaboration.goalText)
          }
          break;
        case 'Cut':
          preStep = {
            kind: 'Cut',
            goalId: step.goalId,
            cuts: step.cut.map(c => ({
              goalId: c.goalId,
              goal: getGoalText(c.goalId, elaboration.goalText),
              cutBranch: {
                clause: c.clause,
                loc: c.loc
              }
            }))
          }
          break;
        case 'Suspend':
          preStep = {
            kind: 'Suspend',
            goalId: step.goalId,
            goal: getGoalText(step.goalId, elaboration.goalText),
            siblingId: step.sibling,
            sibling: getGoalText(step.sibling, elaboration.goalText),
            stack: getStack(stepId, elaboration.stackFrames)
          }
          break
        case 'Inference': {
          let failed: Attempt[];
          let successful: SuccessfulAttempt | null;

          const mkSuccess = (rule: E.Rule, events: Event[], siblings: GoalId[]): SuccessfulAttempt => ({
            attempt: { rule, events },
            siblings: siblings.map(g => ({
              goalId: g,
              goal: getGoalText(g, elaboration.goalText)
            })),
            siblingsOutcome: siblings.every(
              s => analysis.successful.has(s)
            ) ? 'Success' : 'Fail'
          });
          const mkFailed = (attempts: E.Attempt[]): Attempt[] => attempts.map(a => ({
            rule: {
              kind: 'UserRule',
              value: { ruleText: a.code, ruleLoc: a.loc }
            },
            events: a.events
          }))

          if (step.action.kind === 'Builtin') {
            if (step.action.outcome.kind === 'Fail') {
              failed = [{
                rule: { kind: 'BuiltinRule', value: step.action.name },
                events: step.action.events
              }]
              successful = null
            } else if (step.action.outcome.kind === 'Success') {
              successful = mkSuccess(
                { kind: 'BuiltinRule', value: step.action.name },
                step.action.events,
                step.action.outcome.siblings
              )
              failed = []
            } else {
              throw new Unreachable(step.action.outcome)
            }
          } else if (step.action.kind === 'Backchain') {
            if (step.action.outcome.kind === 'Fail') {
              failed = mkFailed(step.action.trylist)
              successful = null
            } else if (step.action.outcome.kind === 'Success') {
              const attempts = [...step.action.trylist];
              const { loc, code, events } = attempts.pop()!;
              successful = mkSuccess(
                { kind: 'UserRule', value: { ruleText: code, ruleLoc: loc } },
                events,
                step.action.outcome.siblings,
              )
              failed = mkFailed(attempts)
            } else {
              throw new Unreachable(step.action.outcome)
            }
          } else {
            throw new Unreachable(step.action);
          }

          // TODO: merge these nicely
          const moreFailed = analysis.attempts.get(step.goalId)?.failing
            .filter(i => i.runtime === stepId.runtime && i.step > stepId.step)
            .map(i => i.step) ?? [];
          moreFailed.sort();
          const moreSuccessful = analysis.attempts.get(step.goalId)?.successful
            .filter(i => i.runtime === stepId.runtime && i.step > stepId.step)
            .map(i => i.step) ?? [];
          moreSuccessful.sort();
          // TODO: assert that no successful -> no more successful
          preStep = {
            kind: 'Inference',
            goalId: step.goalId,
            goal: step.goal,
            predicate: step.pred,
            failed,
            successful: successful ? {
              current: successful,
              more: moreSuccessful
            } : null,
            moreFailed,
            stack: getStack(stepId, elaboration.stackFrames)
          }
          break;
        }
        default:
          throw new Unreachable(step)
      }

      maxStepIdx = Math.max(maxStepIdx, stepId.step)
      minRuntimeIdx = Math.min(minRuntimeIdx, stepId.runtime)
      preCards.push({ timestamp, stepId, step: preStep })
    })

    // TODO: why is it okay only if there's exactly one old broken step?
    if (broken.length !== 0) {
      if (broken.length > 1 || broken[0].step < maxStepIdx) {
        const { step, time } = broken[0];
        throw new CardError(
          `Input trace is broken since step_id ${step}, json object ${time}`
        )
      }
    }

    const toChrAttempt = (a: CHRAttempt): C.ChrAttempt => {
      if (a.loc.kind !== 'File')
        throw new CardError(`CHR attempt had a non-file location ${a.loc}`);
      // TODO: port sanity checks
      return {
        chr_loc: a.loc.file,
        chr_text: a.code,
        chr_condition_cards: preCards
          .filter(p => contained(a.timestamp, p.timestamp))
          .map(preCardToCard)
      }
    };

    const toSuccessfulChrAttempt = (a: CHRAttempt): C.SuccessfulChrAttempt => {
      const attempt = toChrAttempt(a);
      return {
        chr_attempt: attempt,
        chr_removed_goals: a.removed,
        chr_new_goals: a.resumed.map(g => ({
          goal_id: g,
          goal_text: getGoalText(g, elaboration.goalText)
        }))
      }
    }

    const inferenceColor = (rid: RuntimeId, { successful }: Inference): Color => {
      if (!successful) {
        return 'Red';
      }
      if (successful.current.siblingsOutcome === 'Success') {
        if (successful.more.length === 0) {
          return 'Green'
        } else {
          return 'YellowGreen'
        }
      }
      if (successful.current.siblingsOutcome === 'Fail') {
        if (successful.more.length === 0) {
          return 'YellowRed';
        } else {
          const last = successful.more[successful.more.length - 1];
          const lastCard = preCards.find(c => c.stepId.runtime === rid && c.stepId.step === last)
          if (!lastCard) {
            throw new CardError(`Last successful sibling [${rid}, ${last}] does not have a card`);
          }
          if (lastCard.step.kind !== 'Inference') {
            throw new CardError(`Last successful sibling [${rid}. ${last}] is not an inference`)
          }
          const lastColor = inferenceColor(rid, lastCard.step);
          if (lastColor === 'Green') {
            return 'YellowGreen'
          }
          if (lastColor === 'Red') {
            return 'YellowRed'
          }
          return lastColor
        }
      }
      throw new Unreachable(successful.current.siblingsOutcome)
    }

    const preCardToCard = ({ step, stepId }: PreCard): C.Card => {
      const base = { step_id: stepId.step, runtime_id: stepId.runtime };
      switch (step.kind) {
        case 'Init':
          return {
            ...base,
            step: { kind: 'Init', value: toGoal(step) },
            color: { kind: 'Grey' }
          }
        case 'Resume':
          return {
            ...base,
            step: { kind: 'Resume', value: step.value.map(toGoal) },
            color: { kind: 'Grey' }
          }
        case 'Inference':
          return {
            ...base,
            step: { kind: 'Inference', value: {
              current_goal_id: step.goalId,
              current_goal_text: step.goal,
              current_goal_predicate: step.predicate,
              failed_attempts: step.failed.map(toAttempt),
              successful_attempts: step.successful ? [toSuccess(step.successful.current)] : [],
              more_failing_attempts: step.moreFailed,
              more_successful_attempts: step.successful?.more ?? [],
              stack: step.stack.map(toFrame)
            } },
            color: toColor(inferenceColor(stepId.runtime, step))
          }
        case 'Suspend':
          return {
            ...base,
            step: { kind: 'Suspend', value: {
              suspend_goal_id: step.goalId,
              suspend_goal_text: step.goal,
              suspend_sibling: {
                goal_id: step.siblingId,
                goal_text: step.sibling
              },
              suspend_stack: step.stack.map(toFrame)
            } },
            color: { kind: 'Grey' }
          }
        case 'Cut':
          return {
            ...base,
            step: { kind: 'Cut', value: {
              cut_goal_id: step.goalId,
              cut_victims: step.cuts.map(c => ({
                cut_branch_for_goal: {
                  goal_id: c.goalId,
                  goal_text: c.goal
                },
                cut_branch: {
                  rule_text: c.cutBranch.clause,
                  rule_loc: toLoc(c.cutBranch.loc)
                }
              }))
            } },
            color: { kind: 'Grey' }
          }
        case 'CHR_TODO':
          return {
            ...base,
            step: { kind: 'CHR', value: {
              chr_failed_attempts: step.failed.map(toChrAttempt),
              chr_successful_attempts: step.successful.map(toSuccessfulChrAttempt),
              chr_store_before: step.storeBefore.map(toConstraint),
              chr_store_after: step.storeAfter.map(toConstraint)
            } },
            color: { kind: 'Grey' }
          }
        case 'Findall_TODO':
          return {
            ...base,
            step: { kind: 'Findall', value: {
              findall_goal_id: step.goalId,
              findall_goal_text: step.goal,
              findall_cards: preCards
                .filter(p => contained(step.timestamp, p.timestamp))
                .map(preCardToCard),
              findall_solution_text: step.result,
              findall_stack: getStack(stepId, elaboration.stackFrames).map(toFrame)
            } },
            color: { kind: 'Green' }
          }
        default:
          throw new Unreachable(step)
      }
    }

    return preCards.filter(c => c.stepId.runtime === minRuntimeIdx).map(preCardToCard)
  }
}

function readTrace(input: string): StepMap<RawStep> {
  const steps: StepMap<RawStep> = new StepMap();

  let tick = 0;
  input.split(/\n/).forEach(line => {
    if (!line) return;
    const item = readItem(JSON.parse(line));
    if (item.kind.length !== 1 || item.kind[0]?.kind !== 'Info')
      return;

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

  return steps;
}

export function elaborate(input: string): C.Trace {
  const raw = readTrace(input);
  const elaborated = Elaborate.elaborateSteps(raw);
  const analysis = Analyze.analyze(elaborated.steps);
  const cards = Cards.materialize(elaborated, analysis);
  return cards;
}
