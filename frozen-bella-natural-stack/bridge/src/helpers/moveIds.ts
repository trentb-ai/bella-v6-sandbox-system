export type MoveIdType = 'question' | 'synthesis' | 'wow' | 'delivery' | 'complete';

export function getMoveId(channel: string, stage: string, type: MoveIdType): string {
  return `v2_${channel}_${stage}_${type}`;
}

export const STAGE_MOVE_IDS = {
  ch_alex: {
    question:  getMoveId('ch_alex', 'alex', 'question'),
    synthesis: getMoveId('ch_alex', 'alex', 'synthesis'),
    complete:  getMoveId('ch_alex', 'alex', 'complete'),
  },
  ch_chris: {
    question:  getMoveId('ch_chris', 'chris', 'question'),
    synthesis: getMoveId('ch_chris', 'chris', 'synthesis'),
    complete:  getMoveId('ch_chris', 'chris', 'complete'),
  },
  ch_maddie: {
    question:  getMoveId('ch_maddie', 'maddie', 'question'),
    synthesis: getMoveId('ch_maddie', 'maddie', 'synthesis'),
    complete:  getMoveId('ch_maddie', 'maddie', 'complete'),
  },
  wow: {
    wow_1: getMoveId('wow', 'wow_1', 'delivery'),
    wow_2: getMoveId('wow', 'wow_2', 'delivery'),
    wow_3: getMoveId('wow', 'wow_3', 'delivery'),
    wow_4: getMoveId('wow', 'wow_4', 'delivery'),
    wow_5: getMoveId('wow', 'wow_5', 'delivery'),
    wow_6: getMoveId('wow', 'wow_6', 'delivery'),
  },
} as const;
