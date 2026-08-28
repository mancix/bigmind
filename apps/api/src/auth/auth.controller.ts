import { Controller, UseGuards } from '@nestjs/common';
import { authContract } from '@bigmind/contracts';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { AuthService } from './auth.service';
import { RateLimiterGuard } from './rate-limiter.guard';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(new RateLimiterGuard(5, 60_000))
  @TsRestHandler(authContract.register)
  register() {
    return tsRestHandler(authContract.register, async ({ body }) => ({
      status: 201 as const,
      body: await this.authService.register(body.email, body.password),
    }));
  }

  @UseGuards(new RateLimiterGuard(10, 60_000))
  @TsRestHandler(authContract.login)
  login() {
    return tsRestHandler(authContract.login, async ({ body }) => ({
      status: 200 as const,
      body: await this.authService.login(body.email, body.password),
    }));
  }

  @UseGuards(new RateLimiterGuard(10, 60_000))
  @TsRestHandler(authContract.refresh)
  refresh() {
    return tsRestHandler(authContract.refresh, async ({ body }) => ({
      status: 200 as const,
      body: await this.authService.refresh(body.refreshToken),
    }));
  }

  @TsRestHandler(authContract.logout)
  logout() {
    return tsRestHandler(authContract.logout, async ({ body }) => {
      await this.authService.logout(body.refreshToken);

      return {
        status: 200 as const,
        body: { message: 'Logged out successfully' },
      };
    });
  }
}
