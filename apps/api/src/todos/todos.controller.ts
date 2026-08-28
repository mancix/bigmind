import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { TodosService } from './todos.service';

@UseGuards(AuthGuard('jwt'))
@Controller('notes/:noteId/todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get()
  async list(@Param('noteId') noteId: string, @Req() req: any) {
    return this.todosService.getItems(noteId, req.user.userId);
  }

  @Post()
  async create(
    @Param('noteId') noteId: string,
    @Body('text') text: string,
    @Req() req: any,
  ) {
    return this.todosService.createItem(noteId, text, req.user.userId);
  }

  @Patch(':itemId')
  async update(
    @Param('noteId') noteId: string,
    @Param('itemId') itemId: string,
    @Body('text') text: string,
    @Req() req: any,
  ) {
    return this.todosService.updateItem(noteId, itemId, text, req.user.userId);
  }

  @Put(':itemId/toggle')
  async toggle(
    @Param('noteId') noteId: string,
    @Param('itemId') itemId: string,
    @Req() req: any,
  ) {
    return this.todosService.toggleItem(noteId, itemId, req.user.userId);
  }

  @Delete(':itemId')
  async delete(
    @Param('noteId') noteId: string,
    @Param('itemId') itemId: string,
    @Req() req: any,
  ) {
    await this.todosService.deleteItem(noteId, itemId, req.user.userId);
    return { message: 'Todo item deleted' };
  }

  @Put(':itemId/reorder')
  async reorder(
    @Param('noteId') noteId: string,
    @Param('itemId') itemId: string,
    @Body('position') position: number,
    @Req() req: any,
  ) {
    return this.todosService.reorderItem(noteId, itemId, position, req.user.userId);
  }
}
