/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { apiContract } from '@bigmind/contracts';
import { generateOpenApi } from '@ts-rest/open-api';
import { AppModule } from './app/app.module';

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
      'Set JWT_SECRET to a secure random string before starting the API.',
    );
  }

  const app = await NestFactory.create(AppModule);

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });

  if (process.env.NODE_ENV !== 'production') {
    const document = generateOpenApi(apiContract, {
      info: {
        title: 'BigMind Sync API',
        version: '1.0.0',
      },
    });
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
