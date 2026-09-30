import { PREDICTION_RUNS, VICTORY_LABEL } from '../rules';
import type { Quality } from '../types';
import { buildArmy } from './army';
import { createBattleFromArmies } from './battle';
import type { Prediction, VictoryLabel } from './types';

/** Runs matches 1..runs; armies are built once since only the seed changes between matches. */
export function predict(a: Quality, b: Quality, runs: number = PREDICTION_RUNS): Prediction {
  const armyA = buildArmy(a);
  const armyB = buildArmy(b);
  const out: Prediction = { runs, aWins: 0, bWins: 0, draws: 0 };
  for (let match = 1; match <= runs; match++) {
    const { winner } = createBattleFromArmies(armyA, armyB, match).run();
    if (winner === 'a') out.aWins++;
    else if (winner === 'b') out.bWins++;
    else out.draws++;
  }
  return out;
}

/** `prior` = the winner's share of wins in the prediction (0..1). */
export function victoryLabel(prior: number): VictoryLabel {
  if (prior >= VICTORY_LABEL.skill) return 'skill';
  if (prior >= VICTORY_LABEL.close) return 'close';
  return 'upset';
}
