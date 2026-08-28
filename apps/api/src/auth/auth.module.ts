import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';
import { WorkspaceModule } from '../workspaces/workspaces.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WorkspaceGuard } from './jwt-auth.guard';
import { JwtStrategy, JWT_SECRET } from './jwt.strategy';
import { RefreshTokensRepository } from './refresh-tokens.repository';

@Module({
  imports: [
    UsersModule,
    WorkspaceModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: JWT_SECRET!,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokensRepository, JwtStrategy, WorkspaceGuard],
  exports: [AuthService, JwtModule, PassportModule, WorkspaceGuard],
})
export class AuthModule {}
