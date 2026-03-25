const OperationStopService = require('./OperationStopService');

class FactorialClockOutClosureService {
    static _toParisDateKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    }

    static _toParisTimeHHMMSS(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return null;
        // toLocaleTimeString can include seconds; force 2-digit and 24h
        return d.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    static async closeOpenOperatorSteps({ operatorSteps = [], clockOutAt }) {
        if (!operatorSteps || operatorSteps.length === 0) return { closedCount: 0, skipped: true, reason: 'no_steps' };

        const currentDate = this._toParisDateKey(clockOutAt);
        const currentTime = this._toParisTimeHHMMSS(clockOutAt);

        if (!currentDate || !currentTime) {
            return { closedCount: 0, skipped: true, reason: 'invalid_clockOutAt' };
        }

        let closedCount = 0;

        for (const step of operatorSteps) {
            const operatorId = String(step.OperatorCode || '').trim();
            const lancementCode = step.CodeLanctImprod;
            const phase = step.Phase || 'PRODUCTION';
            const codeRubrique = step.CodeRubrique || operatorId;

            if (!operatorId || !lancementCode) continue;

            try {
                const stopResult = await OperationStopService.stopOperation({
                    operatorId,
                    lancementCode,
                    phase,
                    codeRubrique,
                    currentTime,
                    currentDate
                });

                if (!stopResult?.alreadyFinished) {
                    closedCount += 1;
                }
            } catch (_) {
                // Non bloquant: on veut clore le maximum possible
            }
        }

        return { closedCount, skipped: false, reason: 'ok' };
    }
}

module.exports = FactorialClockOutClosureService;

