// Node 24 can exit zero for a skipped/TODO run, or count an empty file as one passing test.
// Require both the named file's own summary and the runner's final summary.
import { resolve } from 'node:path';

export default async function* requireExecutedCases(events) {
  const expected = resolve(process.env.REQ005_TEST_FILE);
  let executed;
  let fileSummaries = 0;
  let finalSummaries = 0;
  for await (const {type, data} of events) {
    if (type !== 'test:summary') continue;
    if (data.file) {
      if (resolve(data.entryFile) !== expected || resolve(data.file) !== expected) {
        throw new Error('Unexpected closeout test file: ' + data.file);
      }
      fileSummaries++;
    } else {
      finalSummaries++;
    }
    const c = data.counts;
    if (!data.success || !Number.isSafeInteger(c?.tests) || c.tests < 1 || c.passed !== c.tests ||
        (executed !== undefined && c.tests !== executed) || c.failed !== 0 || c.cancelled !== 0 || c.skipped !== 0 || c.todo !== 0) {
      throw new Error('Incomplete closeout test run for ' + expected + ': ' + JSON.stringify(c));
    }
    executed = c.tests;
  }
  if (fileSummaries !== 1 || finalSummaries !== 1) {
    throw new Error('Missing or repeated closeout test summary for ' + expected);
  }
  yield 'closeout-executed-cases: PASS ' + expected + '\n';
}
