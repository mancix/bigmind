import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { WorkspaceGuard } from '../auth/jwt-auth.guard';
import { NotesService } from './notes.service';

@UseGuards(AuthGuard('jwt'), WorkspaceGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post(':noteId/move')
  async move(
    @Param('noteId') noteId: string,
    @Body('destinationWorkspaceId') destinationWorkspaceId: string,
    @Req() req: any,
  ) {
    if (!destinationWorkspaceId) {
      throw new BadRequestException('destinationWorkspaceId is required');
    }
    const note = await this.notesService.moveNote(
      noteId,
      destinationWorkspaceId,
      req.user.userId,
    );
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      categoryId: note.categoryId,
      workspaceId: note.workspaceId,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  @Post(':noteId/copy')
  async copy(
    @Param('noteId') noteId: string,
    @Body('destinationWorkspaceId') destinationWorkspaceId: string,
    @Req() req: any,
  ) {
    if (!destinationWorkspaceId) {
      throw new BadRequestException('destinationWorkspaceId is required');
    }
    const note = await this.notesService.copyNote(
      noteId,
      destinationWorkspaceId,
      req.user.userId,
    );
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      categoryId: note.categoryId,
      workspaceId: note.workspaceId,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
