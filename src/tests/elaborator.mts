import { suite, test } from 'node:test';
import * as assert from 'node:assert'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import * as E from '../shared/elaborator/index.mjs';
// TODO: compare IR instead of the ATD format
import { writeTrace } from '../shared/elaborator/trace_v2.mjs';

const traces = [
  'trace_chr',
  'trace',
  'trace2',
  'trace3',
  'trace4',
  'trace_w',
  'trace_cut',
  'trace_findall',
  'trace_implication',
  'broken_trace1',
].map(t => ({ source: t, target: `${t}.elab` }))

const brokenTraces = [
  {
    source: 'broken_trace2',
    validate: /Input trace is broken since step_id 217, json object 1857$/
  }
];

function getTrace(name: string): Promise<string> {
  return fs.readFile(
    path.join(import.meta.dirname, 'sources', `${name}.json`),
    'utf-8'
  )
}

suite('Successful elaboration tests', () => {
  traces.forEach(({ source, target }) => {
    test(`Elaborate ${source}`, async () => {
      const input = await getTrace(source);
      const expectedOutput= JSON.parse(await getTrace(target));

      const elaborated = E.elaborate(input);
      const output = writeTrace(elaborated);
      // TODO: implement promotion
      assert.partialDeepStrictEqual(output, expectedOutput);
      // assert.deepStrictEqual(output, expectedOutput);
    })
  })
})

suite('Failing elaboration tests', () => {
  brokenTraces.forEach(({ source, validate }) => {
    test(`Fail elaboration of ${source}`, async () => {
      const input = await getTrace(source);
      assert.throws(() => E.elaborate(input), validate)
    })
  })
})
