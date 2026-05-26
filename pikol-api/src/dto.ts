import { ApiProperty } from '@nestjs/swagger';

import type { TeamName } from './types';

export class PlayerDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Alex' })
  name!: string;

  @ApiProperty({ example: 4 })
  games!: number;

  @ApiProperty({ example: 3 })
  wins!: number;

  @ApiProperty({ example: 1032 })
  mmr!: number;

  @ApiProperty({ example: true })
  available!: boolean;
}

export class PlayerSnapshotDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Alex' })
  name!: string;

  @ApiProperty({ example: 1000 })
  mmr!: number;
}

export class ScoreDto {
  @ApiProperty({ example: 11 })
  teamA!: number;

  @ApiProperty({ example: 9 })
  teamB!: number;
}

export class ScoringEventDto {
  @ApiProperty({ enum: ['Team A', 'Team B'], example: 'Team A' })
  team!: TeamName;

  @ApiProperty({ type: ScoreDto })
  score!: ScoreDto;

  @ApiProperty({ example: 42 })
  elapsedSeconds!: number;
}

export class MatchDto {
  @ApiProperty({ type: [PlayerDto] })
  teamA!: PlayerDto[];

  @ApiProperty({ type: [PlayerDto] })
  teamB!: PlayerDto[];
}

export class GameHistoryItemDto {
  @ApiProperty({ example: 1760000000000 })
  id!: number;

  @ApiProperty({ example: 1760000000000 })
  playedAt!: number;

  @ApiProperty({ type: [PlayerSnapshotDto] })
  teamA!: PlayerSnapshotDto[];

  @ApiProperty({ type: [PlayerSnapshotDto] })
  teamB!: PlayerSnapshotDto[];

  @ApiProperty({ type: ScoreDto })
  score!: ScoreDto;

  @ApiProperty({ enum: ['Team A', 'Team B'], example: 'Team A' })
  winner!: TeamName;

  @ApiProperty({ example: 420 })
  durationSeconds!: number;

  @ApiProperty({ type: [ScoringEventDto] })
  scoringEvents!: ScoringEventDto[];
}

export class AddPlayerDto {
  @ApiProperty({ example: 'John' })
  name!: string;
}

export class UpdatePlayerAvailabilityDto {
  @ApiProperty({ example: true })
  available!: boolean;
}

export class RecordGameDto {
  @ApiProperty({ type: MatchDto })
  match!: MatchDto;

  @ApiProperty({ type: ScoreDto })
  score!: ScoreDto;

  @ApiProperty({ enum: ['Team A', 'Team B'], example: 'Team A' })
  winner!: TeamName;

  @ApiProperty({ example: 420 })
  durationSeconds!: number;

  @ApiProperty({ type: [ScoringEventDto] })
  scoringEvents!: ScoringEventDto[];
}

export class HealthDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 'pikol-api' })
  service!: string;
}

export class PairStatsDto {
  @ApiProperty({ example: '1:2' })
  key!: string;

  @ApiProperty({ example: 'Alex / Bea' })
  names!: string;

  @ApiProperty({ example: 4 })
  games!: number;

  @ApiProperty({ example: 3 })
  wins!: number;
}

export class ResetTestingDataDto {
  @ApiProperty({ type: [PlayerDto] })
  players!: PlayerDto[];

  @ApiProperty({ type: [GameHistoryItemDto] })
  history!: GameHistoryItemDto[];

  @ApiProperty({ type: MatchDto, nullable: true })
  currentMatch!: MatchDto | null;
}
