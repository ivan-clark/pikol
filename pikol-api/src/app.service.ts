import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { applyMatchResult, assignCourts, getWinner, pickMatch, STARTING_MMR } from './game.logic';
import { bestPairings, buildInsights } from './insights.logic';
import { PrismaService } from './prisma.service';
import type {
  GameHistoryItem,
  Match,
  Player,
  PlayerSnapshot,
  RecordGameBody,
  Score,
  ScoringEvent,
  TeamName,
} from './types';

const CURRENT_MATCH_ID = 1;

type DbPlayer = {
  id: number;
  name: string;
  games: number;
  wins: number;
  mmr: number;
  available: boolean;
};

type DbGame = {
  id: number;
  playedAt: Date;
  teamA: Prisma.JsonValue;
  teamB: Prisma.JsonValue;
  scoreTeamA: number;
  scoreTeamB: number;
  winner: string;
  durationSeconds: number;
  scoringEvents: Prisma.JsonValue;
};

type DbCurrentMatch = {
  teamA: Prisma.JsonValue;
  teamB: Prisma.JsonValue;
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth() {
    return { ok: true, service: 'pikol-api' };
  }

  async getPlayers() {
    const players = await this.prisma.player.findMany();
    return this.sortPlayers(players.map(mapPlayer));
  }

  async addPlayer(name: string) {
    const trimmedName = name.trim();

    if (!trimmedName) throw new BadRequestException('Player name is required.');

    const existingPlayer = await this.prisma.player.findUnique({
      where: { name: trimmedName },
    });
    if (existingPlayer) throw new BadRequestException('Player already exists.');

    return this.prisma.player.create({
      data: {
        name: trimmedName,
        games: 0,
        wins: 0,
        mmr: STARTING_MMR,
        available: true,
      },
    });
  }

  async updatePlayerAvailability(playerId: number, available: boolean) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });
    if (!player) throw new NotFoundException('Player not found.');

    return mapPlayer(
      await this.prisma.player.update({
        where: { id: playerId },
        data: { available },
      }),
    );
  }

  async resetTestingData() {
    await this.prisma.$transaction([
      this.prisma.currentMatch.deleteMany(),
      this.prisma.game.deleteMany(),
      this.prisma.player.deleteMany(),
    ]);

    return {
      players: await this.getPlayers(),
      history: await this.getHistory(),
      currentMatch: null,
    };
  }

  async pickMatch() {
    const [players, history] = await Promise.all([this.getPlayers(), this.getHistory()]);
    const availablePlayers = players.filter((player) => player.available);
    const match = pickMatch(availablePlayers, history);
    if (!match) throw new BadRequestException('At least four available players are required.');

    await this.prisma.currentMatch.upsert({
      where: { id: CURRENT_MATCH_ID },
      create: {
        id: CURRENT_MATCH_ID,
        teamA: toJson(match.teamA),
        teamB: toJson(match.teamB),
      },
      update: {
        teamA: toJson(match.teamA),
        teamB: toJson(match.teamB),
      },
    });

    return match;
  }

  // Open play: balance up to `courtCount` courts from an ordered queue of player ids
  // (front of the list has waited longest). Stateless — the live session is managed
  // by the client; recording a finished court goes through recordGame as usual.
  async assignOpenPlayCourts(playerIds: number[], courtCount: number) {
    if (!Array.isArray(playerIds)) {
      throw new BadRequestException('playerIds must be an array.');
    }

    const courts = Math.floor(courtCount);
    if (!Number.isFinite(courts) || courts < 1 || courts > 8) {
      throw new BadRequestException('courts must be between 1 and 8.');
    }

    const [players, history] = await Promise.all([this.getPlayers(), this.getHistory()]);
    const playerById = new Map(players.map((player) => [player.id, player]));
    const orderedPlayers = playerIds
      .map((id) => playerById.get(id))
      .filter((player): player is Player => Boolean(player));

    return assignCourts(orderedPlayers, history, courts);
  }

  async getCurrentMatch() {
    const currentMatch = await this.prisma.currentMatch.findUnique({
      where: { id: CURRENT_MATCH_ID },
    });

    return currentMatch ? mapCurrentMatch(currentMatch) : null;
  }

  async clearCurrentMatch() {
    await this.prisma.currentMatch.deleteMany({
      where: { id: CURRENT_MATCH_ID },
    });

    return { currentMatch: null };
  }

  async getHistory() {
    const games = await this.prisma.game.findMany({
      orderBy: { playedAt: 'desc' },
    });

    return games.map(mapGame);
  }

  async getPairHistory() {
    return bestPairings(await this.getHistory());
  }

  async getInsights() {
    const [players, history] = await Promise.all([this.getPlayers(), this.getHistory()]);
    return buildInsights(players, history);
  }

  async recordGame(body: RecordGameBody) {
    if (!body.match || !body.score || !body.winner) {
      throw new BadRequestException('Match, score, and winner are required.');
    }

    const winner = getWinner(body.score);
    if (winner !== body.winner) {
      throw new BadRequestException('Winner does not match the score.');
    }

    const currentPlayers = await this.getPlayers();
    const playerById = new Map(currentPlayers.map((player) => [player.id, player]));
    const matchPlayerIds = [...body.match.teamA, ...body.match.teamB].map((player) => player.id);
    const uniqueMatchPlayerIds = new Set(matchPlayerIds);

    if (matchPlayerIds.length !== 4 || uniqueMatchPlayerIds.size !== 4) {
      throw new BadRequestException('Match must contain four unique players.');
    }
    if (matchPlayerIds.some((playerId) => !playerById.has(playerId))) {
      throw new BadRequestException('Match must contain four existing players.');
    }

    const matchFromDb: Match = {
      teamA: body.match.teamA.map((player) => playerById.get(player.id)!),
      teamB: body.match.teamB.map((player) => playerById.get(player.id)!),
    };
    const updatedPlayers = applyMatchResult(currentPlayers, matchFromDb, body.winner);
    const updatedSelectedPlayers = updatedPlayers.filter((player) => uniqueMatchPlayerIds.has(player.id));

    const game = await this.prisma.$transaction(async (tx) => {
      const createdGame = await tx.game.create({
        data: {
          playedAt: new Date(),
          teamA: toJson(snapshotTeam(matchFromDb.teamA)),
          teamB: toJson(snapshotTeam(matchFromDb.teamB)),
          scoreTeamA: body.score.teamA,
          scoreTeamB: body.score.teamB,
          winner: body.winner,
          durationSeconds: Math.max(0, Math.floor(body.durationSeconds)),
          scoringEvents: toJson(body.scoringEvents ?? []),
        },
      });

      await Promise.all(
        updatedSelectedPlayers.map((player) =>
          tx.player.update({
            where: { id: player.id },
            data: {
              games: player.games,
              wins: player.wins,
              mmr: player.mmr,
            },
          }),
        ),
      );

      await tx.currentMatch.deleteMany({
        where: { id: CURRENT_MATCH_ID },
      });

      return createdGame;
    });

    return {
      game: mapGame(game),
      players: await this.getPlayers(),
    };
  }

  async getPlayerHistory(playerId: number) {
    const playerExists = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });
    if (!playerExists) throw new NotFoundException('Player not found.');

    return (await this.getHistory())
      .reverse()
      .filter((game) => [...game.teamA, ...game.teamB].some((player) => player.id === playerId));
  }

  private sortPlayers(players: Player[]) {
    return [...players].sort((a, b) => b.mmr - a.mmr || b.wins - a.wins || a.name.localeCompare(b.name));
  }
}

function mapPlayer(player: DbPlayer): Player {
  return {
    id: player.id,
    name: player.name,
    games: player.games,
    wins: player.wins,
    mmr: player.mmr,
    available: player.available,
  };
}

function mapGame(game: DbGame): GameHistoryItem {
  return {
    id: game.id,
    playedAt: game.playedAt.getTime(),
    teamA: asPlayerSnapshots(game.teamA),
    teamB: asPlayerSnapshots(game.teamB),
    score: {
      teamA: game.scoreTeamA,
      teamB: game.scoreTeamB,
    },
    winner: asTeamName(game.winner),
    durationSeconds: game.durationSeconds,
    scoringEvents: asScoringEvents(game.scoringEvents),
  };
}

function mapCurrentMatch(currentMatch: DbCurrentMatch): Match {
  return {
    teamA: asPlayers(currentMatch.teamA),
    teamB: asPlayers(currentMatch.teamB),
  };
}

function snapshotTeam(team: Player[]): PlayerSnapshot[] {
  return team.map((player) => ({
    id: player.id,
    name: player.name,
    mmr: player.mmr,
  }));
}

function asTeamName(value: string): TeamName {
  if (value === 'Team A' || value === 'Team B') return value;
  throw new Error(`Invalid team name from database: ${value}`);
}

function asPlayerSnapshots(value: Prisma.JsonValue): PlayerSnapshot[] {
  return value as PlayerSnapshot[];
}

function asPlayers(value: Prisma.JsonValue): Player[] {
  return value as Player[];
}

function asScoringEvents(value: Prisma.JsonValue): ScoringEvent[] {
  return value as ScoringEvent[];
}

function toJson(value: Player[] | PlayerSnapshot[] | ScoringEvent[]): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
