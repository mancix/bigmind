import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { AuthResponse, AuthUser } from '@bigmind/contracts';
import { DatabaseService } from '../database/database.service';
import { UsersRepository } from '../users/users.repository';
import { WorkspaceRepository } from '../workspaces/workspaces.repository';
import type { JwtPayload } from './jwt.strategy';
import { RefreshTokensRepository } from './refresh-tokens.repository';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResponse> {
    const existing = await this.usersRepository.findByEmail(email);

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const now = new Date();
    const passwordHash = await argon2.hash(password);

    const user = await this.database.db.transaction(async (tx) => {
      const newUser = await this.usersRepository.create(
        {
          id: randomUUID(),
          email,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );

      const workspace = await this.workspaceRepository.createWorkspace(
        {
          id: randomUUID(),
          name: `${email} Personal Workspace`,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );

      await this.workspaceRepository.addMember(
        {
          workspaceId: workspace.id,
          userId: newUser.id,
          role: 'OWNER',
          createdAt: now,
        },
        tx,
      );

      return newUser;
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.usersRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, password);

    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.refreshTokensRepository.findValidByHash(tokenHash);

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.refreshTokensRepository.revoke(stored.id);

    const user = await this.usersRepository.findById(stored.userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.refreshTokensRepository.findValidByHash(tokenHash);

    if (stored) {
      await this.refreshTokensRepository.revoke(stored.id);
    }
  }

  private async issueTokens(userId: string, email: string): Promise<AuthResponse> {
    const payload: JwtPayload = { userId, email };
    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_TTL });

    const rawRefreshToken = randomUUID() + randomUUID();
    const tokenHash = hashToken(rawRefreshToken);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await this.refreshTokensRepository.create({
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
    });

    const user: AuthUser = { id: userId, email };

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user,
    };
  }
}
