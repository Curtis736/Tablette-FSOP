const LancementTempsRestantService = require('../services/LancementTempsRestantService');

// Test unitaire des helpers via buildStepPayload indirect — on exporte toHours via re-require internals
// Ici on valide la structure du module et la logique documentée.

describe('LancementTempsRestantService', () => {
    it('expose getTempsRestant', () => {
        expect(typeof LancementTempsRestantService.getTempsRestant).toBe('function');
    });

    it('retourne null pour code vide', async () => {
        const r = await LancementTempsRestantService.getTempsRestant('');
        expect(r).toBeNull();
    });
});
