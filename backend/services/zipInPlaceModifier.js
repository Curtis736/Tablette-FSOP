/**
 * Modification d'un fichier ZIP en place pour préserver les métadonnées
 * Cette approche modifie seulement l'entrée nécessaire sans réécrire tout le ZIP
 */

const fs = require('fs');
const fsp = require('fs/promises');
const { createHash } = require('crypto');

/**
 * Calcule le CRC32 d'un buffer (algorithme ZIP)
 */
function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    const table = [];
    
    // Générer la table CRC32
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    
    // Calculer le CRC
    for (let i = 0; i < buffer.length; i++) {
        crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Lit un entier 32 bits little-endian depuis un buffer
 */
function readUInt32LE(buffer, offset) {
    return buffer.readUInt32LE(offset);
}

/**
 * Écrit un entier 32 bits little-endian dans un buffer
 */
function writeUInt32LE(buffer, value, offset) {
    buffer.writeUInt32LE(value, offset);
    return offset + 4;
}

/**
 * Modifie un fichier dans un ZIP en place
 * @param {string} zipPath - Chemin du fichier ZIP
 * @param {string} entryPath - Chemin de l'entrée à modifier (ex: "xl/worksheets/sheet1.xml")
 * @param {Buffer} newData - Nouvelles données pour l'entrée
 * @returns {Promise<void>}
 */
async function modifyZipEntryInPlace(zipPath, entryPath, newData, options = {}) {
    const lockRetryMs = options.lockRetryMs || 500;
    const lockMaxRetries = options.lockMaxRetries || 5;
    
    // Lire le fichier ZIP complet avec retry si verrouillé
    let zipBuffer;
    let lockAttempt = 0;
    while (lockAttempt < lockMaxRetries) {
        try {
            zipBuffer = await fsp.readFile(zipPath);
            break;
        } catch (error) {
            if ((error.code === 'EBUSY' || error.code === 'EPERM' || error.message?.includes('locked')) && lockAttempt < lockMaxRetries) {
                lockAttempt++;
                if (lockAttempt >= lockMaxRetries) {
                    throw new Error(`ZIP file is locked after ${lockMaxRetries} attempts: ${zipPath}`);
                }
                await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                continue;
            }
            throw error;
        }
    }
    
    // Trouver l'entrée locale file header
    let localHeaderOffset = -1;
    let entrySize = 0;
    let compressionMethod = 0;
    let fileNameLength = 0;
    let extraFieldLength = 0;
    
    // Rechercher l'entrée dans le fichier
    for (let i = 0; i < zipBuffer.length - 4; i++) {
        // Signature du local file header: 0x04034b50
        if (zipBuffer.readUInt32LE(i) === 0x04034b50) {
            const fileNameLen = zipBuffer.readUInt16LE(i + 26);
            const extraLen = zipBuffer.readUInt16LE(i + 28);
            const fileName = zipBuffer.toString('utf8', i + 30, i + 30 + fileNameLen);
            
            if (fileName === entryPath) {
                localHeaderOffset = i;
                compressionMethod = zipBuffer.readUInt16LE(i + 8);
                entrySize = zipBuffer.readUInt32LE(i + 18); // compressed size
                fileNameLength = fileNameLen;
                extraFieldLength = extraLen;
                break;
            }
            
            // Passer à l'entrée suivante
            const compressedSize = zipBuffer.readUInt32LE(i + 18);
            i += 30 + fileNameLen + extraLen + compressedSize - 1;
        }
    }
    
    if (localHeaderOffset === -1) {
        throw new Error(`Entry not found: ${entryPath}`);
    }
    
    // Calculer le CRC32 des nouvelles données
    const newCrc = crc32(newData);
    const newSize = newData.length;
    
    // Trouver la central directory pour mettre à jour aussi
    let centralDirOffset = -1;
    for (let i = zipBuffer.length - 4; i >= 0; i--) {
        // Signature de la central directory: 0x02014b50
        if (zipBuffer.readUInt32LE(i) === 0x02014b50) {
            const fileNameLen = zipBuffer.readUInt16LE(i + 28);
            const extraLen = zipBuffer.readUInt16LE(i + 30);
            const commentLen = zipBuffer.readUInt16LE(i + 32);
            const fileName = zipBuffer.toString('utf8', i + 46, i + 46 + fileNameLen);
            
            if (fileName === entryPath) {
                centralDirOffset = i;
                break;
            }
            
            // Passer à l'entrée précédente
            i -= (46 + fileNameLen + extraLen + commentLen - 1);
        }
    }
    
    // Créer un nouveau buffer avec les modifications
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    const dataEnd = dataStart + entrySize;
    const beforeData = zipBuffer.slice(0, dataStart);
    const afterData = zipBuffer.slice(dataEnd);
    
    // Mettre à jour le local file header
    const newLocalHeader = Buffer.from(beforeData);
    writeUInt32LE(newLocalHeader, newCrc, localHeaderOffset + 14); // CRC-32
    newLocalHeader.writeUInt32LE(newSize, localHeaderOffset + 18); // compressed size
    newLocalHeader.writeUInt32LE(newSize, localHeaderOffset + 22); // uncompressed size (si stored)
    
    // Mettre à jour la central directory si trouvée
    let finalBuffer;
    if (centralDirOffset !== -1) {
        const beforeCentral = Buffer.concat([newLocalHeader, newData, afterData]);
        const centralDirStart = beforeCentral.length - (zipBuffer.length - centralDirOffset);
        
        // Mettre à jour la central directory entry
        const newCentralDir = Buffer.from(beforeCentral);
        writeUInt32LE(newCentralDir, newCrc, centralDirStart + 16); // CRC-32
        newCentralDir.writeUInt32LE(newSize, centralDirStart + 20); // compressed size
        newCentralDir.writeUInt32LE(newSize, centralDirStart + 24); // uncompressed size
        newCentralDir.writeUInt32LE(localHeaderOffset, centralDirStart + 42); // relative offset
        
        finalBuffer = newCentralDir;
    } else {
        finalBuffer = Buffer.concat([newLocalHeader, newData, afterData]);
    }
    
    // Écrire le fichier modifié avec retry si verrouillé
    lockAttempt = 0;
    while (lockAttempt < lockMaxRetries) {
        try {
            await fsp.writeFile(zipPath, finalBuffer);
            break;
        } catch (error) {
            if ((error.code === 'EBUSY' || error.code === 'EPERM' || error.message?.includes('locked')) && lockAttempt < lockMaxRetries) {
                lockAttempt++;
                if (lockAttempt >= lockMaxRetries) {
                    throw new Error(`ZIP file is locked during write after ${lockMaxRetries} attempts: ${zipPath}`);
                }
                await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                continue;
            }
            throw error;
        }
    }
}

module.exports = {
    modifyZipEntryInPlace,
    crc32
};
