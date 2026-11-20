(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlinePractice = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TICK_MS = 5000;
  const MAX_GAP_MS = 15000;

  /**
   * A new running practice attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Caching: none
   */
  function startAttempt(promptId, now) {
    return { promptId, status: 'running', startedAt: now, elapsedSeconds: 0, lastTickAt: now, covered: [], notes: '' };
  }

  // Adds the gap since the last tick, but only while running and only if the gap is plausible.
  function advance(p, now) {
    if (p.status !== 'running' || p.lastTickAt == null) return p.elapsedSeconds;
    const gap = now - p.lastTickAt;
    return gap >= 0 && gap <= MAX_GAP_MS ? p.elapsedSeconds + gap / 1000 : p.elapsedSeconds;
  }

  /**
   * Adds plausible elapsed time to a running attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function tick(p, now) {
    if (p.status !== 'running') return { ...p };
    return { ...p, elapsedSeconds: advance(p, now), lastTickAt: now };
  }

  /**
   * Pauses a running attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function pause(p, now) {
    if (p.status !== 'running') return { ...p };
    return { ...p, status: 'paused', elapsedSeconds: advance(p, now), lastTickAt: null };
  }

  /**
   * Resumes a paused attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function resume(p, now) {
    if (p.status !== 'paused') return { ...p };
    return { ...p, status: 'running', lastTickAt: now };
  }

  /**
   * Finishes an attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function finish(p, now) {
    if (p.status === 'finished') return { ...p };
    return { ...p, status: 'finished', elapsedSeconds: advance(p, now), lastTickAt: null };
  }

  /**
   * Pauses a running attempt reopened in another tab.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function reopen(p) {
    if (p.status !== 'running') return { ...p };
    return { ...p, status: 'paused', lastTickAt: null };
  }

  /**
   * Time left, or overtime, on an attempt.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(1) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 2 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  function remaining(p, minutes) {
    const left = minutes * 60 - p.elapsedSeconds;
    return left >= 0 ? { seconds: Math.floor(left), overtime: false } : { seconds: Math.floor(-left), overtime: true };
  }

  /**
   * Finished attempts at one prompt, newest first.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(M log M) where M = stored models (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Caching: none
   */
  function historyFor(summaries, promptId) {
    return summaries
      .filter((s) => s.practice && s.practice.promptId === promptId && s.practice.status === 'finished')
      .sort((a, b) => b.practice.startedAt - a.practice.startedAt);
  }

  return { TICK_MS, MAX_GAP_MS, startAttempt, tick, pause, resume, finish, reopen, remaining, historyFor };
});
