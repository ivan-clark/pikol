import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppService } from './app.service';
import {
  AddPlayerDto,
  AssignCourtsDto,
  AssignCourtsResultDto,
  GameHistoryItemDto,
  HealthDto,
  MatchDto,
  PairStatsDto,
  PlayerDto,
  RecordGameDto,
  ResetTestingDataDto,
  UpdatePlayerAvailabilityDto,
} from './dto';
import type { AssignCourtsBody, RecordGameBody } from './types';

@ApiTags('Pikol')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check API health' })
  @ApiOkResponse({ type: HealthDto })
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('players')
  @ApiOperation({ summary: 'List ranked players' })
  @ApiOkResponse({ type: [PlayerDto] })
  getPlayers() {
    return this.appService.getPlayers();
  }

  @Post('players')
  @ApiOperation({ summary: 'Add a player' })
  @ApiBody({ type: AddPlayerDto })
  @ApiOkResponse({ type: PlayerDto })
  addPlayer(@Body() body: AddPlayerDto) {
    return this.appService.addPlayer(body.name);
  }

  @Post('players/:playerId/availability')
  @ApiOperation({ summary: 'Mark a player available or unavailable for future matches' })
  @ApiBody({ type: UpdatePlayerAvailabilityDto })
  @ApiOkResponse({ type: PlayerDto })
  updatePlayerAvailability(
    @Param('playerId', ParseIntPipe) playerId: number,
    @Body() body: UpdatePlayerAvailabilityDto,
  ) {
    return this.appService.updatePlayerAvailability(playerId, body.available);
  }

  @Post('testing/reset')
  @ApiOperation({ summary: 'Clear players, games, and current match data' })
  @ApiOkResponse({ type: ResetTestingDataDto })
  resetTestingData() {
    return this.appService.resetTestingData();
  }

  @Post('matches/pick')
  @ApiOperation({ summary: 'Pick the next fair 2v2 match' })
  @ApiOkResponse({ type: MatchDto })
  pickMatch() {
    return this.appService.pickMatch();
  }

  @Post('open-play/assign')
  @ApiOperation({ summary: 'Balance open-play courts from an ordered player queue' })
  @ApiBody({ type: AssignCourtsDto })
  @ApiOkResponse({ type: AssignCourtsResultDto })
  assignOpenPlayCourts(@Body() body: AssignCourtsBody) {
    return this.appService.assignOpenPlayCourts(
      body.playerIds,
      body.courts,
      body.sessionPairCounts,
      body.sessionGamesPlayed,
    );
  }

  @Get('matches/current')
  @ApiOperation({ summary: 'Get the current picked match' })
  @ApiOkResponse({ type: MatchDto })
  getCurrentMatch() {
    return this.appService.getCurrentMatch();
  }

  @Delete('matches/current')
  @ApiOperation({ summary: 'Clear the current picked match' })
  clearCurrentMatch() {
    return this.appService.clearCurrentMatch();
  }

  @Post('games')
  @ApiOperation({ summary: 'Record a completed game and update player stats' })
  @ApiBody({ type: RecordGameDto })
  recordGame(@Body() body: RecordGameBody) {
    return this.appService.recordGame(body);
  }

  @Get('history')
  @ApiOperation({ summary: 'List recorded games' })
  @ApiOkResponse({ type: [GameHistoryItemDto] })
  getHistory() {
    return this.appService.getHistory();
  }

  @Get('history/pairs')
  @ApiOperation({ summary: 'List pair performance history' })
  @ApiOkResponse({ type: [PairStatsDto] })
  getPairHistory() {
    return this.appService.getPairHistory();
  }

  @Get('history/players/:playerId')
  @ApiOperation({ summary: 'List chronological games for one player' })
  @ApiOkResponse({ type: [GameHistoryItemDto] })
  getPlayerHistory(@Param('playerId', ParseIntPipe) playerId: number) {
    return this.appService.getPlayerHistory(playerId);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Get rankings and game insights' })
  getInsights() {
    return this.appService.getInsights();
  }
}
