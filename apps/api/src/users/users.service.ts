import { Injectable } from '@nestjs/common';

import type { UserRow, NewUser } from '../database/schema';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findById(id: string): Promise<UserRow | undefined> {
    return this.usersRepository.findById(id);
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    return this.usersRepository.findByEmail(email);
  }

  async create(values: NewUser): Promise<UserRow> {
    return this.usersRepository.create(values);
  }
}
