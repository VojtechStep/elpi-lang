import { readFileSync } from 'fs';
import * as E from '../shared/elaborator';
import { writeTrace } from '../shared/trace_v2'

const input = readFileSync(process.stdin.fd, { encoding: 'utf-8' });

const trace = E.elaborate(input);

console.log(JSON.stringify(writeTrace(trace)))

