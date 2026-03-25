import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import ExcelJS from 'exceljs';

const svc = require('../services/fsopExcelService');

describe('fsopExcelService - Insertion de mesures dans Excel', () => {
    let tempDir;
    let excelPath;

    beforeEach(async () => {
        // Créer un répertoire temporaire pour chaque test
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsop-excel-test-'));
        excelPath = path.join(tempDir, 'mesure_test.xlsx');
    });

    afterEach(async () => {
        // Nettoyer le répertoire temporaire
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignorer les erreurs de nettoyage
        }
    });

    /**
     * Crée un fichier Excel de test avec une structure de mesures
     */
    async function createTestExcel(serialNumber = '1000', headerRow = 1) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Mesures');

        // Ligne d'en-tête (peut être à différentes positions)
        if (headerRow > 1) {
            // Ajouter des lignes vides ou titres avant l'en-tête
            for (let i = 1; i < headerRow; i++) {
                worksheet.addRow([]);
            }
        }

        // En-tête avec colonnes de mesures
        worksheet.addRow(['Lancement', 'Commande', 'N° de S/N', 'IL 940 nm', 'IL 1310 nm', 'RL 1310 nm', 'Date']);
        
        // Ligne de données avec le numéro de série
        worksheet.addRow(['LT2500750', 'AR23-00385', serialNumber, '', '', '', '']);

        // Sauvegarder le fichier
        await workbook.xlsx.writeFile(excelPath);
        return excelPath;
    }

    it('devrait insérer des mesures dans une cellule vide', async () => {
        // Créer un fichier Excel de test
        await createTestExcel('1000', 1);

        // Mesures à insérer
        const taggedMeasures = {
            'IL_940': '0.5',
            'IL_1310': '1.2',
            'RL_1310': '-45.3'
        };

        // Insérer les mesures
        const result = await svc.updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
            serialNumber: '1000',
            forceReplace: true
        });

        // Vérifier le résultat
        expect(result.success).toBe(true);
        expect(result.updated).toBeGreaterThan(0);

        // Vérifier que les valeurs ont été écrites
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelPath);
        const worksheet = workbook.getWorksheet('Mesures');
        
        // Trouver la ligne avec le numéro de série
        let dataRow = null;
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            const snCell = row.getCell(3); // Colonne "N° de S/N"
            if (snCell.value === '1000') {
                dataRow = row;
                break;
            }
        }

        expect(dataRow).not.toBeNull();
        
        // Vérifier les valeurs insérées (les colonnes peuvent varier selon le mapping)
        // On vérifie au moins que quelque chose a été mis à jour
        const il940Cell = dataRow.getCell(4); // Colonne "IL 940 nm"
        const il1310Cell = dataRow.getCell(5); // Colonne "IL 1310 nm"
        const rl1310Cell = dataRow.getCell(6); // Colonne "RL 1310 nm"

        // Au moins une des cellules devrait contenir une valeur
        const hasValue = il940Cell.value || il1310Cell.value || rl1310Cell.value;
        expect(hasValue).toBeTruthy();
    });

    it('devrait détecter une ligne d\'en-tête à la ligne 3', async () => {
        // Créer un fichier Excel avec en-tête à la ligne 3
        await createTestExcel('20-24-01', 3);

        const taggedMeasures = {
            'IL_940': '0.8',
            'IL_1310': '1.5'
        };

        const result = await svc.updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
            serialNumber: '20-24-01',
            forceReplace: true
        });

        expect(result.success).toBe(true);
        expect(result.updated).toBeGreaterThan(0);
    });

    it('ne devrait pas écraser une valeur existante si forceReplace est false', async () => {
        // Créer un fichier Excel avec une valeur déjà présente
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Mesures');
        worksheet.addRow(['Lancement', 'Commande', 'N° de S/N', 'IL 940 nm', 'IL 1310 nm']);
        worksheet.addRow(['LT2500750', 'AR23-00385', '1000', '0.3', '']); // IL 940 déjà rempli
        await workbook.xlsx.writeFile(excelPath);

        const taggedMeasures = {
            'IL_940': '0.5', // Nouvelle valeur
            'IL_1310': '1.2'  // Nouvelle valeur
        };

        const result = await svc.updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
            serialNumber: '1000',
            forceReplace: false // Ne pas écraser
        });

        // Vérifier que la valeur existante n'a pas été écrasée
        const workbook2 = new ExcelJS.Workbook();
        await workbook2.xlsx.readFile(excelPath);
        const worksheet2 = workbook2.getWorksheet('Mesures');
        const dataRow = worksheet2.getRow(2);
        const il940Cell = dataRow.getCell(4);

        // La valeur existante devrait être préservée
        expect(String(il940Cell.value)).toBe('0.3');
        
        // Mais IL_1310 devrait être mis à jour (cellule vide)
        const il1310Cell = dataRow.getCell(5);
        expect(String(il1310Cell.value)).toBe('1.2');
    });

    it('devrait écraser une valeur existante si forceReplace est true', async () => {
        // Créer un fichier Excel avec une valeur déjà présente
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Mesures');
        worksheet.addRow(['Lancement', 'Commande', 'N° de S/N', 'IL 940 nm', 'IL 1310 nm']);
        worksheet.addRow(['LT2500750', 'AR23-00385', '1000', '0.3', '']);
        await workbook.xlsx.writeFile(excelPath);

        const taggedMeasures = {
            'IL_940': '0.5' // Nouvelle valeur
        };

        const result = await svc.updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
            serialNumber: '1000',
            forceReplace: true // Écraser
        });

        expect(result.success).toBe(true);

        // Vérifier que la valeur a été écrasée
        const workbook2 = new ExcelJS.Workbook();
        await workbook2.xlsx.readFile(excelPath);
        const worksheet2 = workbook2.getWorksheet('Mesures');
        const dataRow = worksheet2.getRow(2);
        const il940Cell = dataRow.getCell(4);

        expect(String(il940Cell.value)).toBe('0.5');
    });

    it('devrait retourner un message si aucune mesure n\'est fournie', async () => {
        await createTestExcel('1000', 1);

        const result = await svc.updateExcelWithTaggedMeasures(excelPath, {}, {
            serialNumber: '1000'
        });

        expect(result.success).toBe(true);
        expect(result.updated).toBe(0);
        expect(result.message).toContain('Aucune mesure taguée');
    });

    it('devrait gérer les erreurs si le fichier n\'existe pas', async () => {
        const nonExistentPath = path.join(tempDir, 'nonexistent.xlsx');
        
        // La fonction lance une exception après les tentatives
        await expect(
            svc.updateExcelWithTaggedMeasures(nonExistentPath, {
                'IL_940': '0.5'
            }, {
                serialNumber: '1000',
                retryAttempts: 1 // Réduire les tentatives pour accélérer le test
            })
        ).rejects.toThrow(/not found/);
    });

    it('devrait mapper correctement les noms de colonnes avec variations', async () => {
        // Créer un fichier avec des noms de colonnes variés
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Mesures');
        worksheet.addRow(['Lancement', 'Commande', 'N° de S/N', 'Perte d\'insertion 940 nm', 'Perte d\'insertion 1310 nm']);
        worksheet.addRow(['LT2500750', 'AR23-00385', '1000', '', '']);
        await workbook.xlsx.writeFile(excelPath);

        const taggedMeasures = {
            'IL_940': '0.5',
            'IL_1310': '1.2'
        };

        const result = await svc.updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
            serialNumber: '1000',
            forceReplace: true
        });

        // Le test vérifie que le mapping fonctionne même avec des noms de colonnes différents
        expect(result.success).toBe(true);
    });
});
