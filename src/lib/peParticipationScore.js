/** Performance evaluation participation scoring — 5 peers given / 5 received per period. */

export const PE_MIN_PEER_EVALUATIONS = 5;

export const PE_SCORE_RULES = {
  min_required: PE_MIN_PEER_EVALUATIONS,
  given_complete_points: 5,
  given_incomplete_points: -10,
  received_complete_points: 5,
  received_incomplete_points: -5,
};

export function computeParticipationPoints(givenCount, receivedCount, minRequired = PE_MIN_PEER_EVALUATIONS) {
  const min = Math.max(1, Number(minRequired) || PE_MIN_PEER_EVALUATIONS);
  const given = Math.max(0, Number(givenCount) || 0);
  const received = Math.max(0, Number(receivedCount) || 0);
  const givenPoints = given >= min ? PE_SCORE_RULES.given_complete_points : PE_SCORE_RULES.given_incomplete_points;
  const receivedPoints = received >= min
    ? PE_SCORE_RULES.received_complete_points
    : PE_SCORE_RULES.received_incomplete_points;
  return {
    min_required: min,
    evaluations_given: given,
    evaluations_received: received,
    given_remaining: Math.max(0, min - given),
    received_remaining: Math.max(0, min - received),
    given_met: given >= min,
    received_met: received >= min,
    given_points: givenPoints,
    received_points: receivedPoints,
    total_points: givenPoints + receivedPoints,
  };
}
