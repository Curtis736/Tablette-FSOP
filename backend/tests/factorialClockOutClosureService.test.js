import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const OperationStopService = require('../services/OperationStopService.js');
const mockStopOperation = vi.fn().mockResolvedValue({});
// Réassignation directe pour éviter les effets de cache Vitest
OperationStopService.stopOperation = mockStopOperation;

const ClosureService = require('../services/FactorialClockOutClosureService');

describe('FactorialClockOutClosureService', () => {
  beforeEach(() => {
    mockStopOperation.mockReset().mockResolvedValue({});
    OperationStopService.stopOperation = mockStopOperation;
  });

  it('calls stopOperation for each open operator step', async () => {
    const operatorSteps = [
      { OperatorCode: '931', CodeLanctImprod: 'LT1', Phase: 'PRODUCTION', CodeRubrique: 'X' },
      { OperatorCode: '931', CodeLanctImprod: 'LT2', Phase: 'PRODUCTION', CodeRubrique: 'X' }
    ];

    const clockOutAt = new Date('2026-03-24T16:00:00+01:00');
    const res = await ClosureService.closeOpenOperatorSteps({ operatorSteps, clockOutAt });

    expect(mockStopOperation).toHaveBeenCalledTimes(2);
    const firstCallArgs = mockStopOperation.mock.calls[0][0];
    expect(firstCallArgs.operatorId).toBe('931');
    expect(firstCallArgs.lancementCode).toBe('LT1');
  });
});

