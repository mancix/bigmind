import { Controller } from '@nestjs/common';
import { healthContract } from '@bigmind/contracts';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

@Controller()
export class HealthController {
  @TsRestHandler(healthContract.check)
  check() {
    return tsRestHandler(healthContract.check, async () => ({
      status: 200,
      body: { status: 'ok' },
    }));
  }
}
