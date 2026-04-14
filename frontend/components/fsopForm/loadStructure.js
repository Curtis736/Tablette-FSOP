export async function loadStructure(templateCode) {
    try {
        const response = await this.apiService.get(`/fsop/template/${templateCode}/structure`);
        this.structure = response.structure || response;
        this.structureMeta = {
            templateCode: response.templateCode || templateCode,
            templatePath: response.templatePath || null,
            templatesSource: response.templatesSource || null
        };

        console.log('📋 Structure chargée:', {
            sections: this.structure.sections?.length || 0,
            tables: this.structure.sections?.filter(s => s.table).length || 0,
            passFail: this.structure.sections?.filter(s => s.type === 'pass_fail').length || 0,
            headerFields: this.structure.headerFields?.length || 0
        });
        console.log('📌 Source structure FSOP:', this.structureMeta);

        if (this.structure.sections) {
            console.log('📑 Détail des sections:');
            this.structure.sections.forEach(section => {
                console.log(`  - Section ${section.id}: "${section.title || 'SANS TITRE'}" (type: ${section.type}, fields: ${section.fields?.length || 0}, table: ${section.table ? 'Oui' : 'Non'})`);
            });
        } else {
            console.error('❌ Aucune section trouvée dans la structure!');
        }

        return this.structure;
    } catch (error) {
        console.error('Erreur lors du chargement de la structure:', error);
        this.notificationManager.error('Impossible de charger la structure du formulaire');
        throw error;
    }
}

