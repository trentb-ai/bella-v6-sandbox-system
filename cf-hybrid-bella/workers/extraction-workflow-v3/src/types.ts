/**
 * extraction-workflow-v3/src/types.ts
 * Internal types for the extraction workflow.
 */

export type StageId =
  | 'greeting'
  | 'wow_1'
  | 'wow_2'
  | 'wow_3'
  | 'wow_4'
  | 'wow_5'
  | 'wow_6'
  | 'wow_7'
  | 'wow_8'
  | 'anchor_acv'
  | 'ch_alex'
  | 'ch_chris'
  | 'ch_maddie'
  | 'ch_sarah'
  | 'ch_james'
  | 'recommendation'
  | 'roi_delivery'
  | 'optional_side_agents'
  | 'close';

export type ResponseSpeedBand =
  | 'under_30_seconds'
  | 'under_5_minutes'
  | '5_to_30_minutes'
  | '30_minutes_to_2_hours'
  | '2_to_24_hours'
  | 'next_day_plus';
