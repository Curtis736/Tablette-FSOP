const AdmZip = require('adm-zip');
const fs = require('fs/promises');

/**
 * Extract tag values from a docx file.
 * Tags are in format {{TAG_NAME}} and must be contiguous (not split across runs).
 * 
 * @param {string} docxPath - Path to the docx file
 * @param {RegExp} tagPattern - Pattern to match tags (default: /\{\{([A-Z0-9_]+)\}\}/)
 * @returns {Promise<Object>} Object with tag names as keys and their values as values
 */
async function extractTagsFromDocx(docxPath, tagPattern = /\{\{([A-Z0-9_]+)\}\}/) {
    try {
        const zip = new AdmZip(docxPath);
        const entry = zip.getEntry('word/document.xml');
        
        if (!entry) {
            throw new Error('DOCX_DOCUMENT_XML_NOT_FOUND');
        }

        const xml = entry.getData().toString('utf8');
        const tags = {};
        
        // Strategy: Find all tag placeholders first
        const tagMatches = Array.from(xml.matchAll(new RegExp(tagPattern.source, 'g')));
        
        if (tagMatches.length === 0) {
            // No tags found - return empty object
            return tags;
        }
        
        // For each tag, find its value
        // In Word XML, when a placeholder is replaced, the value appears in text nodes
        // We need to find the text content that replaced the placeholder
        
        for (let i = 0; i < tagMatches.length; i++) {
            const match = tagMatches[i];
            const fullTag = match[0]; // e.g., "{{HOI_23_199_TEMP}}"
            const tagName = match[1]; // e.g., "HOI_23_199_TEMP"
            const tagStart = match.index;
            
            // Skip if we already processed this tag
            if (tags.hasOwnProperty(tagName)) {
                continue;
            }
            
            // Find the position after this tag
            const afterTagStart = tagStart + fullTag.length;
            
            // Find the next tag (if any) to know where to stop looking
            const nextTagMatch = i + 1 < tagMatches.length ? tagMatches[i + 1] : null;
            const searchEnd = nextTagMatch ? nextTagMatch.index : xml.length;
            
            // Extract the XML segment between this tag and the next
            const segment = xml.substring(afterTagStart, searchEnd);
            
            // Parse text nodes in this segment
            // Word XML structure: <w:t>value</w:t> or <w:t xml:space="preserve">value</w:t>
            const textMatches = segment.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
            
            let valueText = '';
            if (textMatches && textMatches.length > 0) {
                // Extract text from all text nodes and concatenate
                valueText = textMatches
                    .map(m => {
                        const textMatch = m.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
                        return textMatch ? textMatch[1] : '';
                    })
                    .join('')
                    .trim();
            } else {
                // Fallback: try to extract any text content (remove XML tags)
                valueText = segment
                    .replace(/<[^>]+>/g, '')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&nbsp;/g, ' ')
                    .trim();
            }
            
            // If the tag was replaced, valueText should contain the actual value
            // If the tag is still a placeholder, valueText might be empty or contain the placeholder itself
            if (valueText && valueText !== fullTag && !valueText.match(tagPattern)) {
                tags[tagName] = valueText;
            } else {
                // Tag placeholder still present or empty - check if it's in the original XML
                // If the placeholder is still there, it means it wasn't replaced yet
                if (xml.substring(tagStart, tagStart + fullTag.length) === fullTag) {
                    // Placeholder still present - set empty or skip
                    tags[tagName] = '';
                } else {
                    // Tag was replaced but we couldn't extract the value - try harder
                    // Look for text immediately after the tag position
                    const immediateAfter = xml.substring(tagStart, Math.min(tagStart + 500, searchEnd));
                    const immediateText = immediateAfter
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/&[a-z]+;/gi, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    // Remove the tag itself if it appears
                    const cleanedText = immediateText.replace(fullTag, '').trim();
                    if (cleanedText) {
                        tags[tagName] = cleanedText;
                    } else {
                        tags[tagName] = '';
                    }
                }
            }
        }
        
        return tags;
    } catch (error) {
        throw new Error(`Failed to extract tags from docx: ${error.message}`);
    }
}

/**
 * Check if a docx file is currently being edited (Word lock file exists).
 * 
 * @param {string} docxPath - Path to the docx file
 * @returns {Promise<boolean>} True if file is locked/being edited
 */
async function isDocxLocked(docxPath) {
    const path = require('path');
    const dir = path.dirname(docxPath);
    const basename = path.basename(docxPath, '.docx');
    const lockFile = path.join(dir, `~$${basename}.docx`);
    
    try {
        await fs.access(lockFile);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Check if a docx file has been stable (not modified) for a given duration.
 * 
 * @param {string} docxPath - Path to the docx file
 * @param {number} stabilityDelayMs - Minimum time since last modification (ms)
 * @returns {Promise<boolean>} True if file is stable
 */
async function isDocxStable(docxPath, stabilityDelayMs = 5000) {
    try {
        const stat = await fs.stat(docxPath);
        const now = Date.now();
        const mtime = stat.mtimeMs;
        const age = now - mtime;
        
        return age >= stabilityDelayMs;
    } catch (_) {
        return false;
    }
}

module.exports = {
    extractTagsFromDocx,
    isDocxLocked,
    isDocxStable
};

