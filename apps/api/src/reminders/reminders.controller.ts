import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { WorkspaceGuard } from '../auth/jwt-auth.guard';
import { RemindersService } from './reminders.service';

@UseGuards(AuthGuard('jwt'), WorkspaceGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  list(@Req() req: any) {
    return this.remindersService.list(req.workspaceId, req.user.userId);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.remindersService.create(
      req.workspaceId,
      body,
      req.user.userId,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.remindersService.update(req.workspaceId, id, body, req.user.userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.remindersService.remove(req.workspaceId, id, req.user.userId);
    return { message: 'Reminder deleted' };
  }
}
