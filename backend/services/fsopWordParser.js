const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const path = require('path');
const fsp = require('fs/promises');

/**
 * Parse a Word document (.docx) to extract its structure:
 * - Placeholders ({{TAG}})
 * - Tables with columns and rows
 * - Sections with PASS/FAIL fields
 * 
 * @param {string} docxPath - Path to the .docx file
 * @returns {Promise<Object>} Structure object with placeholders, sections, and tables
 */
async function parseWordStructure(docxPath) {
    try {
        console.log(`📄 Parsing Word structure from: ${docxPath}`);
        const zip = new AdmZip(docxPath);
        const entry = zip.getEntry('word/document.xml');
        if (!entry) {
            throw new Error('DOCX_DOCUMENT_XML_NOT_FOUND');
        }

        const xmlContent = entry.getData().toString('utf8');
        console.log(`📄 XML content size: ${xmlContent.length} bytes`);
        
        // Configure XML parser to handle namespaces and preserve order
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            parseAttributeValue: true,
            trimValues: true,
            parseTrueNumberOnly: false,
            arrayMode: false,
            preserveOrder: true
        });

        console.log('🔍 Parsing XML...');
        const xmlObj = parser.parse(xmlContent);
        console.log('✅ XML parsed successfully');
        
        // Extract placeholders
        console.log('🔍 Extracting placeholders...');
        const placeholders = extractPlaceholders(xmlContent);
        console.log(`✅ Found ${placeholders.length} placeholders`);
        
        // Extract header fields (Numéro lancement, N° cordon, Référence SILOG, etc.)
        console.log('🔍 Extracting header fields...');
        const headerFields = extractHeaderFields(xmlContent);
        console.log(`✅ Found ${headerFields.length} header fields`);
        
        // Extract text fields (empty cells, form fields, etc.)
        console.log('🔍 Extracting text fields...');
        const textFields = extractTextFields(xmlContent);
        console.log(`✅ Found ${textFields.length} text fields`);
        
        // Extract checkboxes
        console.log('🔍 Extracting checkboxes...');
        const checkboxes = extractCheckboxes(xmlContent);
        console.log(`✅ Found ${checkboxes.length} checkboxes`);
        
        // Extract sections and tables
        console.log('🔍 Extracting sections and tables...');
        let sections;
        try {
            sections = extractSections(xmlObj, xmlContent, textFields, checkboxes);
            console.log(`✅ Extracted ${sections.length} sections`);
        } catch (extractError) {
            console.error('❌ Error in extractSections:', extractError);
            console.error('❌ Stack:', extractError.stack);
            throw new Error(`EXTRACT_SECTIONS_ERROR: ${extractError.message}`);
        }

        // Extract ordered blocks (Word-like rendering)
        console.log('🔍 Extracting ordered blocks (paragraphs/tables/page breaks)...');
        let blocks = null;
        try {
            blocks = extractBlocks(xmlContent);
            console.log(`✅ Extracted ${blocks.length} block(s)`);
        } catch (err) {
            console.warn('⚠️ Failed to extract blocks, continuing without blocks:', err.message);
            blocks = null;
        }
        
        // Extract document title (usually in the first few paragraphs or header)
        console.log('🔍 Extracting document title...');
        let documentTitle;
        try {
            documentTitle = extractDocumentTitle(xmlContent);
            console.log(`✅ Document title: ${documentTitle || 'not found'}`);
        } catch (err) {
            console.warn('⚠️ Error extracting document title:', err.message);
            documentTitle = null;
        }
        
        // Extract reference field (e.g., RETA-697-HOI-23.199)
        console.log('🔍 Extracting reference...');
        let reference;
        try {
            reference = extractReference(xmlContent, placeholders);
            console.log(`✅ Reference: ${reference?.value || 'not found'}`);
        } catch (err) {
            console.warn('⚠️ Error extracting reference:', err.message);
            reference = { detected: false };
        }
        
        // Extract tagged measures (placeholders that start with TAG_ or are marked for Excel transfer)
        console.log('🔍 Extracting tagged measures...');
        let taggedMeasures;
        try {
            taggedMeasures = extractTaggedMeasures(xmlContent, placeholders);
            console.log(`✅ Found ${taggedMeasures.length} tagged measures`);
        } catch (err) {
            console.warn('⚠️ Error extracting tagged measures:', err.message);
            taggedMeasures = [];
        }
        
        console.log('✅ Word structure parsing completed successfully');
        return {
            placeholders,
            headerFields,
            textFields,
            checkboxes,
            sections,
            blocks,
            documentTitle: documentTitle,
            reference: reference,
            taggedMeasures: taggedMeasures,
            metadata: {
                source: path.basename(docxPath),
                parsedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('❌ Fatal error in parseWordStructure:', error);
        console.error('❌ Stack:', error.stack);
        throw new Error(`PARSE_ERROR: ${error.message}`);
    }
}

/**
 * Extract a Word-like ordered representation from document.xml
 * Returns blocks in reading order:
 * - { type: 'paragraph', id, text, hasCheckbox, hasPassFail }
 * - { type: 'table', id, rows: [ [ { text, colspan?, rowspan? } ] ] }
 * - { type: 'page_break' }
 */
function extractBlocks(xmlContent) {
    const bodyMatch = xmlContent.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
    const bodyXml = bodyMatch ? bodyMatch[1] : xmlContent;

    const blocks = [];
    let pId = 0;
    let tId = 0;

    // IMPORTANT:
    // Do NOT use a global regex over bodyXml for <w:p> because tables contain nested paragraphs.
    // We must extract only top-level blocks in reading order: <w:p> and <w:tbl> directly under <w:body>.
    let i = 0;
    while (i < bodyXml.length) {
        const nextP = bodyXml.indexOf('<w:p', i);
        const nextTbl = bodyXml.indexOf('<w:tbl', i);
        if (nextP === -1 && nextTbl === -1) break;

        let kind;
        let start;
        if (nextP !== -1 && (nextTbl === -1 || nextP < nextTbl)) {
            kind = 'p';
            start = nextP;
        } else {
            kind = 'tbl';
            start = nextTbl;
        }

        const extracted = extractOuterElement(bodyXml, kind, start);
        if (!extracted) {
            // Fallback: advance to avoid infinite loop
            i = start + 4;
            continue;
        }

        if (kind === 'p') {
            const paraXml = extracted.xml;
            const text = extractTextFromParagraphXml(paraXml);

            const hasPageBreak =
                /<w:br\b[^>]*w:type="page"[^>]*\/?>/i.test(paraXml) ||
                /<w:lastRenderedPageBreak\b/i.test(paraXml);

            const trimmed = (text || '').trim();
            const hasCheckbox = /^([☐☑✓□]|\[[\sx]\])\s+/i.test(trimmed);
            const hasPassFail = /PASS\s*FAIL/i.test(trimmed) && /:/i.test(trimmed);

            blocks.push({
                type: 'paragraph',
                id: ++pId,
                text: text || '',
                hasCheckbox,
                hasPassFail
            });

            if (hasPageBreak) {
                blocks.push({ type: 'page_break' });
            }
        } else {
            const tblXml = extracted.xml;
            blocks.push({
                type: 'table',
                id: ++tId,
                rows: extractTableMatrix(tblXml)
            });
        }

        i = extracted.endIndex;
    }

    return blocks;
}

function extractOuterElement(xml, tag, startIndex) {
    const open = `<w:${tag}`;
    const close = `</w:${tag}>`;
    if (xml.indexOf(open, startIndex) !== startIndex) {
        return null;
    }

    let depth = 0;
    let i = startIndex;
    while (i < xml.length) {
        const nextOpen = xml.indexOf(open, i);
        const nextClose = xml.indexOf(close, i);

        if (nextClose === -1) return null;

        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            i = nextOpen + open.length;
            continue;
        }

        // close
        depth -= 1;
        i = nextClose + close.length;
        if (depth === 0) {
            return {
                xml: xml.slice(startIndex, i),
                endIndex: i
            };
        }
    }
    return null;
}

function extractTextFromParagraphXml(paraXml) {
    // Preserve Word spacing rules:
    // - xml:space="preserve" nodes must keep leading/trailing spaces
    // - Other nodes: trim, but insert a space between runs when needed to avoid "motscollés"
    const textRegex = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
    const parts = [];
    let m;
    while ((m = textRegex.exec(paraXml)) !== null) {
        const attrs = m[1] || '';
        let raw = (m[2] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        // Safety: if some templates contain literal Word tags inside text, strip them
        raw = raw.replace(/<\/?w:[^>]+>/gi, '');
        const preserve = /xml:space="preserve"/i.test(attrs);

        if (preserve) {
            parts.push(raw);
            continue;
        }

        const trimmed = raw.trim();
        if (!trimmed) continue;

        if (parts.length > 0) {
            const prev = parts[parts.length - 1];
            const needsSpace =
                prev &&
                !prev.endsWith(' ') &&
                !trimmed.startsWith(' ') &&
                // don't insert space before punctuation
                !/^[,.;:!?)]/.test(trimmed) &&
                // don't insert after opening paren
                !/[(]$/.test(prev);
            if (needsSpace) parts.push(' ');
        }

        parts.push(trimmed);
    }

    // Handle tabs and line breaks inside paragraphs (best-effort)
    let text = parts.join('');
    text = text.replace(/<w:tab[^>]*\/>/gi, '\t');
    text = text.replace(/<w:br[^>]*\/>/gi, '\n');
    // Normalize only excessive whitespace, keep single spaces
    return text.replace(/[ \t]+/g, ' ').trim();
}

function extractTableMatrix(tblXml) {
    const rowsOut = [];
    const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rowMatch;

    // Track vertical merges by column index (best-effort)
    const vMergeTrack = new Map(); // colIdx -> { cellRef }

    while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
        const trXml = rowMatch[1];
        const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cellMatch;

        const rowCells = [];
        let colIdx = 0;

        while ((cellMatch = cellRegex.exec(trXml)) !== null) {
            const tcXml = cellMatch[1];
            const colspan = getGridSpan(tcXml);
            const vMerge = getVMerge(tcXml); // 'restart' | 'continue' | null
            const text = extractTextFromCellXml(tcXml);
            const fill = getCellFill(tcXml);

            while (vMergeTrack.has(colIdx)) {
                colIdx++;
            }

            if (vMerge === 'continue') {
                const above = vMergeTrack.get(colIdx);
                if (above?.cellRef) {
                    above.cellRef.rowspan = (above.cellRef.rowspan || 1) + 1;
                }
                // keep tracking
                vMergeTrack.set(colIdx, above || { cellRef: null });
                colIdx += colspan;
                continue;
            }

            const cellObj = {
                text,
                ...(colspan > 1 ? { colspan } : {}),
                ...(vMerge === 'restart' ? { rowspan: 1 } : {}),
                ...(fill ? { fill } : {})
            };
            rowCells.push(cellObj);

            if (vMerge === 'restart') {
                vMergeTrack.set(colIdx, { cellRef: cellObj });
            }

            colIdx += colspan;
        }

        rowsOut.push(rowCells);
    }

    return rowsOut;
}

function getCellFill(tcXml) {
    // Word shading: <w:shd ... w:fill="D9E2F3" .../>
    const m = tcXml.match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"[^>]*\/?>/);
    if (!m) return null;
    return `#${m[1].toUpperCase()}`;
}

function extractTextFromCellXml(tcXml) {
    // Same spacing strategy as paragraphs to avoid concatenating words.
    const textRegex = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
    const parts = [];
    let m;
    while ((m = textRegex.exec(tcXml)) !== null) {
        const attrs = m[1] || '';
        let raw = (m[2] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        raw = raw.replace(/<\/?w:[^>]+>/gi, '');
        const preserve = /xml:space="preserve"/i.test(attrs);

        if (preserve) {
            parts.push(raw);
            continue;
        }

        const trimmed = raw.trim();
        if (!trimmed) continue;

        if (parts.length > 0) {
            const prev = parts[parts.length - 1];
            const needsSpace =
                prev &&
                !prev.endsWith(' ') &&
                !trimmed.startsWith(' ') &&
                !/^[,.;:!?)]/.test(trimmed) &&
                !/[(]$/.test(prev);
            if (needsSpace) parts.push(' ');
        }

        parts.push(trimmed);
    }

    let text = parts.join('');
    text = text.replace(/<w:tab[^>]*\/>/gi, '\t');
    text = text.replace(/<w:br[^>]*\/>/gi, '\n');
    return text.replace(/[ \t]+/g, ' ').trim();
}

function getGridSpan(tcXml) {
    const m = tcXml.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i);
    const n = m ? parseInt(m[1], 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function getVMerge(tcXml) {
    const m = tcXml.match(/<w:vMerge\b([^>]*)\/?>/i);
    if (!m) return null;
    const attrs = m[1] || '';
    const vm = attrs.match(/w:val="([^"]+)"/i);
    const val = (vm?.[1] || '').toLowerCase();
    if (!val) return 'continue';
    if (val === 'restart') return 'restart';
    return 'continue';
}

/**
 * Extract placeholders like {{LT}}, {{SN}}, etc. from XML content
 */
function extractPlaceholders(xmlContent) {
    const placeholderRegex = /\{\{([A-Z0-9_]+)\}\}/g;
    const placeholders = new Set();
    let match;
    
    while ((match = placeholderRegex.exec(xmlContent)) !== null) {
        placeholders.add(match[0]); // Full placeholder: {{TAG}}
    }
    
    return Array.from(placeholders).sort();
}

/**
 * Extract header fields like "Numéro lancement:", "N° cordon:", "Référence SILOG:"
 * These are typically labels followed by empty fields or placeholders
 */
function extractHeaderFields(xmlContent) {
    const headerFields = [];
    
    // Common header field patterns
    const headerPatterns = [
        { label: 'Numéro lancement', key: 'NUMERO_LANCEMENT', placeholder: '{{LT}}' },
        { label: 'N° cordon', key: 'NUMERO_CORDON', placeholder: null },
        { label: 'Référence SILOG', key: 'REFERENCE_SILOG', placeholder: null },
        { label: 'Numéro de série', key: 'NUMERO_SERIE', placeholder: '{{SN}}' }
    ];
    
    // Extract text content to find header fields
    const textContent = extractTextContent(xmlContent);
    
    headerPatterns.forEach(pattern => {
        // Look for the label followed by colon (more flexible pattern)
        const regex = new RegExp(`${pattern.label.replace(/[°]/g, '[°º]')}[\\s:]+([^\\n\\r]*)`, 'i');
        const match = textContent.match(regex);
        
        if (match) {
            const value = match[1].trim();
            // Always add header field if found, even if it has a value (it's still a field)
            headerFields.push({
                key: pattern.key,
                label: pattern.label,
                value: value,
                placeholder: pattern.placeholder,
                isEmpty: !value || /^[_\-]+$/.test(value) || value.length === 0
            });
        }
    });
    
    return headerFields;
}

/**
 * Extract document title from XML content
 * Usually found in the first few paragraphs or in a specific style
 */
function extractDocumentTitle(xmlContent) {
    // Look for common title patterns in the first few paragraphs
    // Titles are often in bold or have specific formatting
    const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
    let paraMatch;
    let firstParagraphs = [];
    let count = 0;
    
    while ((paraMatch = paragraphRegex.exec(xmlContent)) !== null && count < 10) {
        const paraXml = paraMatch[1];
        
        // Extract text from this paragraph
        const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
        const texts = [];
        let textMatch;
        
        while ((textMatch = textRegex.exec(paraXml)) !== null) {
            const text = textMatch[1] || textMatch[2] || '';
            if (text.trim()) {
                texts.push(text);
            }
        }
        
        const paraText = texts.join('').trim();
        if (paraText && paraText.length > 5 && paraText.length < 100) {
            // Check if it looks like a title (contains "Cordon" or similar patterns)
            if (/Cordon|FSOP|Formulaire/i.test(paraText)) {
                return paraText;
            }
            firstParagraphs.push(paraText);
        }
        count++;
    }
    
    // If no specific title found, return the first meaningful paragraph
    if (firstParagraphs.length > 0) {
        return firstParagraphs[0];
    }
    
    return null;
}

/**
 * Extract text fields (empty cells, form fields, etc.) from XML
 */
function extractTextFields(xmlContent) {
    const textFields = [];
    
    // Look for empty cells or cells with placeholder-like content
    // Match cells that are empty or contain only whitespace/underscores
    const emptyCellPattern = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cellMatch;
    let fieldIndex = 0;
    
    while ((cellMatch = emptyCellPattern.exec(xmlContent)) !== null) {
        const cellXml = cellMatch[1];
        const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let cellText = '';
        let textMatch;
        
        while ((textMatch = textRegex.exec(cellXml)) !== null) {
            if (!textMatch) continue;
            
            const text = textMatch[1] || '';
            // Preserve spaces, especially for xml:space="preserve"
            if (textMatch[0] && textMatch[0].includes('xml:space="preserve"')) {
                cellText += text; // Preserve exact spacing
            } else {
                const trimmed = text.trim();
                if (trimmed) {
                    // Add space if needed between words
                    if (cellText && !cellText.endsWith(' ')) {
                        cellText += ' ';
                    }
                    cellText += trimmed;
                }
            }
        }
        
        // Normalize only multiple spaces to single space
        cellText = cellText ? cellText.replace(/[ \t]+/g, ' ').trim() : '';
        
        // If cell is empty or contains only underscores/dashes (form field indicators)
        if (!cellText || /^[_\-]+$/.test(cellText) || cellText.length === 0) {
            // Try to find label from previous cells or context
            textFields.push({
                id: `textfield_${fieldIndex++}`,
                type: 'text',
                value: '',
                label: '' // Will be filled from context
            });
        }
    }
    
    return textFields;
}

/**
 * Extract checkboxes from XML
 */
function extractCheckboxes(xmlContent) {
    const checkboxes = [];
    
    // Look for checkbox symbols (☐, ☑, ✓) or checkbox form fields
    // Word uses symbols or form fields for checkboxes
    const checkboxSymbolPattern = /[☐☑✓□]/g;
    const checkboxFormFieldPattern = /<w:fldChar[^>]*w:fldCharType="begin"[^>]*>[\s\S]*?checkbox[\s\S]*?<\/w:fldChar>/gi;
    
    // Extract text content from XML first to avoid capturing XML tags
    // Look for paragraphs that contain checkbox symbols
    // IMPORTANT: Use a regex that captures the full match to get position
    const paragraphPattern = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
    let paraMatch;
    let checkboxIndex = 0;
    let paraPosition = 0; // Track paragraph position to preserve order
    
    while ((paraMatch = paragraphPattern.exec(xmlContent)) !== null) {
        const paraXml = paraMatch[1];
        const paraStartIndex = paraMatch.index; // Position of paragraph in XML
        
        // Extract text from this paragraph, preserving spaces correctly
        const texts = [];
        const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
        let textMatch;
        
        while ((textMatch = textRegex.exec(paraXml)) !== null) {
            if (!textMatch || !textMatch[0]) continue;
            
            const isPreserve = textMatch[0].includes('xml:space="preserve"');
            const text = textMatch[1] || textMatch[2] || '';
            
            if (text) {
                if (isPreserve) {
                    // Preserve exact spacing
                    texts.push(text);
                } else {
                    // For normal nodes, trim but preserve word boundaries
                    const trimmed = text.trim();
                    if (trimmed) {
                        // Add space if needed between words
                        if (texts.length > 0 && !texts[texts.length - 1].endsWith(' ')) {
                            texts.push(' ');
                        }
                        texts.push(trimmed);
                    }
                }
            }
        }
        
        // Join and normalize only multiple spaces
        const textContent = texts.length > 0 ? texts.join('').replace(/[ \t]+/g, ' ').trim() : '';
        
        // Check if this paragraph contains a checkbox symbol
        // Try both strict (start of line) and flexible matching
        let checkboxMatch = textContent.match(/^([☐☑✓□]|\[[\sx]\])\s*(.+)$/);
        if (!checkboxMatch) {
            // Fallback: match checkbox anywhere in the line
            checkboxMatch = textContent.match(/([☐☑✓□]|\[[\sx]\])\s*(.+?)(?:\s*$|\s*[☐☑✓□]|$)/);
        }
        
        if (checkboxMatch) {
            const checkboxSymbol = checkboxMatch[1];
            let label = checkboxMatch[2].trim();
            
            // Only add if label is not empty and doesn't contain XML-like content
            if (label && label.length > 0 && !label.match(/^<[^>]+>/)) {
                checkboxes.push({
                    id: `checkbox_${checkboxIndex++}`,
                    label: label,
                    checked: /[☑✓x]/.test(checkboxSymbol),
                    position: paraStartIndex, // Store position to preserve order
                    paragraphIndex: paraPosition // Store paragraph index for matching
                });
            }
        }
        
        paraPosition++;
    }
    
    // Sort checkboxes by position to preserve document order
    checkboxes.sort((a, b) => (a.position || 0) - (b.position || 0));
    
    return checkboxes;
}

/**
 * Extract all section titles from paragraphs
 * Returns a Map<number, {title: string, paragraphIndex: number}>
 */
function extractAllSectionTitles(xmlContent, paragraphs) {
    const titlesMap = new Map();
    let sectionCounter = 1; // Counter for sections without numbers
    
    const isLargeFile = paragraphs.length > 1000;
    if (!isLargeFile) {
        console.log('🔍 Extracting all section titles from paragraphs...');
    }
    
    // Parcourir tous les paragraphes
    // Limit processing for very large files
    const maxParagraphsToCheck = isLargeFile ? Math.min(paragraphs.length, 2000) : paragraphs.length;
    
    for (let i = 0; i < maxParagraphsToCheck; i++) {
        const para = paragraphs[i];
        const text = para.text.trim();
        
        // Skip empty paragraphs
        if (!text || text.length < 5) {
            continue;
        }
        
        let sectionNumber = null;
        let titleText = null;
        
        // First, try to find numbered titles (existing logic)
        let match = text.match(/^(\d+)[-\s\.]+\s*(.+)$/);
        if (!match) {
            match = text.match(/^(\d+)\s+(.+)$/);
        }
        
        if (match) {
            sectionNumber = parseInt(match[1], 10);
            titleText = match[2].trim();
        } else {
            // If no number, check if it starts with known section words (even without number)
            const knownSectionWords = [
                'Contrôle', 'Montage', 'Cyclage', 'Tir', 'Emballage',
                'Test', 'Vérification'
            ];
            const startsWithSectionWord = knownSectionWords.some(word => 
                new RegExp(`^${word}`, 'i').test(text)
            );
            
            if (startsWithSectionWord && text.length > 10) {
                // Assign sequential number based on order
                sectionNumber = sectionCounter++;
                titleText = text;
                if (!isLargeFile) {
                    console.log(`  🔍 Found unnumbered title starting with section word: "${text}" -> assigning section ${sectionNumber}`);
                }
            }
        }
        
        if (sectionNumber && titleText) {
            // Normalize title text (fix missing spaces, etc.)
            // Example: "Contrôle interférométriqueavec" -> "Contrôle interférométrique avec"
            let normalizedTitle = titleText;
            
            // Fix common spacing issues
            normalizedTitle = normalizedTitle.replace(/([a-zéèêëàâäôöùûüç])([A-Z])/g, '$1 $2'); // Add space between lowercase and uppercase
            normalizedTitle = normalizedTitle.replace(/avec([a-zéèêëàâäôöùûüç])/gi, 'avec $1'); // Fix "avec" spacing
            // Fix missing space before "avec" when concatenated: "interférométriqueavec" -> "interférométrique avec"
            normalizedTitle = normalizedTitle.replace(/([a-zéèêëàâäôöùûüç])(avec)/gi, '$1 $2');
            // Fix missing space before "avec" when it's concatenated: "interférométriqueavec" -> "interférométrique avec"
            normalizedTitle = normalizedTitle.replace(/([a-zéèêëàâäôöùûüç])(avec)/gi, '$1 $2');
            // Fix missing space after "avec": "avec enregistrement" should stay as is, but "avecenregistrement" -> "avec enregistrement"
            normalizedTitle = normalizedTitle.replace(/(avec)([a-zéèêëàâäôöùûüç])/gi, '$1 $2');
            
            // Chercher continuation sur les paragraphes suivants (pour "MO 1097 ind", etc.)
            let fullTitle = normalizedTitle;
            for (let j = i + 1; j < Math.min(i + 3, paragraphs.length); j++) {
                const nextText = paragraphs[j].text.trim();
                
                // Skip empty paragraphs or PASS/FAIL lines
                if (!nextText || nextText.match(/Connecteur.*PASS.*FAIL/i)) {
                    break;
                }
                
                // Si le titre se termine par ":" et que le texte suivant ressemble à une référence
                if (fullTitle.endsWith(':') && nextText.match(/^(MO\s+\d+|ind)/i) && nextText.length < 50) {
                    fullTitle += ' ' + nextText;
                } else if (!fullTitle.endsWith(':') && nextText.match(/^(MO\s+\d+\s*ind|ind)/i) && nextText.length < 50) {
                    // Si le titre ne se termine pas par ":" mais que le texte suivant est une référence
                    fullTitle += ' ' + nextText;
                } else {
                    break;
                }
            }
            
            const fullTitleFormatted = `${sectionNumber}- ${fullTitle.trim()}`;
            titlesMap.set(sectionNumber, {
                title: fullTitleFormatted,
                paragraphIndex: i
            });
            
            if (!isLargeFile) {
                console.log(`  ✅ Found title for section ${sectionNumber}: "${fullTitleFormatted}"`);
            }
        }
    }
    
    if (!isLargeFile) {
        console.log(`📋 Extracted ${titlesMap.size} section titles`);
    }
    return titlesMap;
}

/**
 * Extract sections and tables from the parsed XML
 */
function extractSections(xmlObj, xmlContent, textFields = [], checkboxes = []) {
    const sections = [];
    
    // Check file size to optimize processing
    const xmlSize = xmlContent.length;
    const isLargeFile = xmlSize > 500000; // > 500KB
    const logLevel = isLargeFile ? 'warn' : 'log'; // Reduce logging for large files
    
    if (!isLargeFile) {
        console.log('🔍 Starting section extraction...');
    } else {
        console.warn(`🔍 Starting section extraction for large file (${Math.round(xmlSize / 1024)}KB)...`);
    }
    
    // Find all paragraphs and tables in the document
    const document = findDocumentElement(xmlObj);
    if (!document) {
        return sections;
    }
    
    // First, identify table boundaries to exclude table content from section extraction
    // Optimize regex for large files: use more specific pattern
    const tableBoundaries = [];
    const tableRegex = /<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tableMatch;
    let tableCount = 0;
    while ((tableMatch = tableRegex.exec(xmlContent)) !== null) {
        tableBoundaries.push({
            start: tableMatch.index,
            end: tableMatch.index + tableMatch[0].length
        });
        tableCount++;
    }
    
    if (!isLargeFile) {
        console.log(`📊 Found ${tableCount} table(s)`);
    }
    
    // Extract sections by parsing paragraphs directly from XML
    // This preserves exact formatting and order
    // Optimize: use a more efficient approach for large files
    const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
    const paragraphs = [];
    let paraMatch;
    let paraCount = 0;
    const maxParagraphs = isLargeFile ? 10000 : Infinity; // Limit for very large files
    
    while ((paraMatch = paragraphRegex.exec(xmlContent)) !== null) {
        if (paraCount >= maxParagraphs) {
            console.warn(`⚠️ Limiting paragraph extraction to ${maxParagraphs} for performance`);
            break;
        }
        
        const paraIndex = paraMatch.index;
        
        // Skip paragraphs that are inside tables (optimize: use binary search for large files)
        let isInTable = false;
        if (tableBoundaries.length > 0) {
            // For large files, use binary search instead of .some()
            if (isLargeFile && tableBoundaries.length > 10) {
                // Binary search for table boundaries
                let left = 0, right = tableBoundaries.length - 1;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const tb = tableBoundaries[mid];
                    if (paraIndex >= tb.start && paraIndex < tb.end) {
                        isInTable = true;
                        break;
                    } else if (paraIndex < tb.start) {
                        right = mid - 1;
                    } else {
                        left = mid + 1;
                    }
                }
            } else {
                isInTable = tableBoundaries.some(tb => paraIndex >= tb.start && paraIndex < tb.end);
            }
        }
        
        if (isInTable) {
            continue;
        }
        
        const paraXml = paraMatch[1];
        
        // Extract all text from this paragraph
        // Preserve spaces correctly, especially for xml:space="preserve"
        const texts = [];
        const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
        let textMatch;
        
        while ((textMatch = textRegex.exec(paraXml)) !== null) {
            if (!textMatch || !textMatch[0]) continue;
            
            // Check if it's a preserve space node
            const isPreserve = textMatch[0].includes('xml:space="preserve"');
            const text = textMatch[1] || textMatch[2] || '';
            
            if (text) {
                if (isPreserve) {
                    // Preserve exact spacing for preserve nodes
                    texts.push(text);
                } else {
                    // For normal nodes, trim but add space if needed
                    const trimmed = text.trim();
                    if (trimmed) {
                        // Add space before if previous text doesn't end with space
                        if (texts.length > 0 && !texts[texts.length - 1].endsWith(' ')) {
                            texts.push(' ');
                        }
                        texts.push(trimmed);
                    }
                }
            }
        }
        
        // Join texts, preserving spaces
        let paraText = texts.length > 0 ? texts.join('') : '';
        // Only normalize multiple spaces to single space (but preserve single spaces)
        paraText = paraText ? paraText.replace(/[ \t]+/g, ' ').trim() : '';
        // Include ALL paragraphs, even if empty (they might be important for structure)
        // But skip if it's completely empty (no text at all)
        if (paraText || paraXml.match(/<w:r[^>]*>/)) {
            paragraphs.push({
                text: paraText,
                xml: paraXml,
                index: paraIndex,
                originalIndex: paragraphs.length // Keep track of original order
            });
            paraCount++;
        }
    }
    
    // Extract ALL section titles FIRST (before any conditional blocks)
    // This ensures allTitlesMap is accessible everywhere in the function
    const allTitlesMap = extractAllSectionTitles(xmlContent, paragraphs);
    
    // Now find numbered sections from paragraphs
    const sectionMatches = [];
    
    if (!isLargeFile) {
        console.log(`📄 Found ${paragraphs.length} paragraphs to analyze`);
        
        // Debug: show first 30 paragraphs to understand structure (only for small files)
        if (paragraphs.length > 0 && paragraphs.length < 100) {
            console.log('📋 First 30 paragraphs:');
            paragraphs.slice(0, 30).forEach((para, idx) => {
                console.log(`  [${idx}] "${para.text.substring(0, 100)}${para.text.length > 100 ? '...' : ''}"`);
            });
        }
    } else {
        console.warn(`📄 Processing ${paragraphs.length} paragraphs (large file, reduced logging)`);
    }
    
    if (paragraphs.length === 0) {
        console.warn('⚠️ No paragraphs found! This is a problem.');
    }
    
    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        const text = para.text;
        
        // Debug: log first 20 paragraphs to see what we're working with (only for small files)
        if (!isLargeFile && i < 20) {
            console.log(`  Para ${i}: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
        }
        
        // Look for numbered section pattern: "1-", "1 -", "1.", etc.
        // Must start with number, separator, then text
        // Match patterns like "1- Contrôle", "2- Contrôle", etc.
        // Use more flexible pattern to catch all variations
        // Also handle cases where there might be whitespace or formatting issues
        let sectionMatch = text.match(/^(\d+)[-\s\.]+\s*(.+)$/);
        
        // If no match, try a more flexible pattern (number at start, then any separator, then text)
        if (!sectionMatch) {
            sectionMatch = text.match(/^(\d+)[\s\-\.]+(.+)$/);
        }
        
        // If still no match, try to find number followed by text (very flexible)
        if (!sectionMatch && /^\d+/.test(text) && /[A-Za-zÀ-ÿ]/.test(text)) {
            sectionMatch = text.match(/^(\d+)\s*(.+)$/);
        }
        
        if (sectionMatch) {
            const number = parseInt(sectionMatch[1], 10);
            let title = sectionMatch[2].trim();
            
            if (!isLargeFile) {
                console.log(`🔍 Found potential section ${number}: "${title}"`);
            }
            
            // Validation: title must contain letters (not just numbers/units)
            // Reject if it's just numbers, units, or measurement values like "65 mm ± 2 mm"
            if (!/[A-Za-zÀ-ÿ]/.test(title)) {
                if (!isLargeFile) {
                    console.log(`  ❌ Rejected: No letters in title`);
                }
                continue;
            }
            
            // Reject measurement values that start with numbers and units
            // But be more careful - only reject if it's clearly a measurement, not a title
            // Pattern: "65 mm ± 2 mm" or "0.5 dB" at the start
            if (/^\d+[\.,]?\d*\s*(mm|dB|°C|°F|°)\s*[±≤≥]/.test(title)) {
                if (!isLargeFile) {
                    console.log(`  ❌ Rejected: Looks like measurement value`);
                }
                continue;
            }
            
            // Accept if title starts with a letter (French or English) OR if it's a known section word
            // Expanded list of known section words to catch all 13 sections
            const startsWithLetter = /^[A-Za-zÀ-ÿ]/.test(title);
            const knownSectionWords = [
                'Contrôle', 'Montage', 'Cyclage', 'Tir', 'Emballage',
                'Données', 'Section', 'Formulaire', 'Test', 'Vérification'
            ];
            const startsWithKnownWord = knownSectionWords.some(word => 
                new RegExp(`^${word}`, 'i').test(title)
            );
            
            // Also check if title contains common section keywords anywhere
            const containsSectionKeyword = /(Contrôle|Montage|Cyclage|Tir|Emballage|Test|Vérification|dimensionnel|perte|insertion|return|loss|face|optique)/i.test(title);
            
            if (!startsWithLetter && !startsWithKnownWord) {
                // Check if it might still be a valid title (e.g., contains section keywords)
                if (!containsSectionKeyword) {
                    // Last resort: if it's a reasonable length and has some structure, accept it
                    // This catches edge cases like "7- Contrôle dimensionnel" where formatting might be off
                    if (title.length < 5 || (!/[A-Za-zÀ-ÿ]{3,}/.test(title))) {
                        if (!isLargeFile) {
                            console.log(`  ❌ Rejected: Doesn't match section patterns`);
                        }
                        continue;
                    }
                    // Accept if it has reasonable structure (at least 3 consecutive letters)
                    if (!isLargeFile) {
                        console.log(`  ⚠️ Title doesn't match known patterns but has structure, accepting anyway`);
                    }
                } else {
                    if (!isLargeFile) {
                        console.log(`  ⚠️ Title doesn't start with letter but contains section keyword, accepting anyway`);
                    }
                }
            }
            
            if (!isLargeFile) {
                console.log(`  ✅ Accepted: "${number}- ${title}"`);
            }
            
            // If title ends with colon, it might continue on next line(s)
            // Capture everything until we hit actual content
            
            // Check if next paragraph continues the title (common in Word)
            // Look ahead for continuation (no number, no table, no PASS/FAIL)
            let fullTitle = title;
            let j = i + 1;
            
            while (j < paragraphs.length) {
                const nextPara = paragraphs[j];
                const nextText = nextPara.text.trim();
                
                // Stop if we hit another numbered section
                if (nextText.match(/^\d+[-\s\.]+/)) {
                    break;
                }
                
                // Check if next paragraph is continuation of title
                // Common patterns: "MO 1097 ind", "MO 1125 ind", etc.
                // These are references that should be part of the title
                if (nextText.match(/^(MO\s+\d+\s*ind|MO\s+\d+)/i)) {
                    // Definitely part of title - capture it
                    fullTitle += ' ' + nextText;
                    j++;
                    continue;
                }
                
                // If current title ends with colon, look for continuation
                if (fullTitle.match(/[:]$/)) {
                    // Check if it's a reference pattern (MO, ind, numbers)
                    if (nextText.match(/^(MO\s+\d+|ind)/i) && nextText.length < 50) {
                        // Likely continuation (like "MO 1097 ind" after colon)
                        fullTitle += ' ' + nextText;
                        j++;
                        continue;
                    }
                }
                
                // Stop if we hit PASS/FAIL or table indicators (but not if it's part of title continuation)
                if (nextText.match(/Connecteur\s+\d+.*PASS|FAIL/i)) {
                    // This is content, not title continuation
                    break;
                }
                
                if (nextText.match(/^Mesures|^Date|^Opérateur/i)) {
                    // This is table header, stop
                    break;
                }
                
                if (nextText.match(/^\d+\s*(mm|dB)\s*[±≤≥]/i)) {
                    // This is a measurement value, stop
                    break;
                }
                
                // If next text is short and doesn't look like content, it might be title continuation
                if (nextText.length < 30 && !nextText.match(/^[A-Z][a-z]+\s+[A-Z]/)) {
                    // Might be continuation, but be conservative
                    // Only if it matches reference patterns
                    if (nextText.match(/(MO|ind|\d+)/i)) {
                        fullTitle += ' ' + nextText;
                        j++;
                        continue;
                    }
                }
                
                // Stop if we hit content that's clearly not part of title
                break;
            }
            
            // Preserve EXACT title - do NOT modify
            const fullTitleFormatted = `${number}- ${fullTitle.trim()}`;
            
            if (!isLargeFile) {
                console.log(`✅ Accepted section ${number}: "${fullTitleFormatted}"`);
            }
            
            sectionMatches.push({
                number: number,
                title: fullTitleFormatted,
                index: para.index,
                paragraphIndex: i
            });
            
            // Important: if we found section 13, we should have all sections
            // Log a warning if we're missing sections
            if (number === 13 && sectionMatches.length < 13) {
                const foundNumbers = sectionMatches.map(m => m.number).sort((a, b) => a - b);
                const missing = [];
                for (let n = 1; n <= 13; n++) {
                    if (!foundNumbers.includes(n)) {
                        missing.push(n);
                    }
                }
                console.warn(`⚠️ Section 13 found but missing sections: ${missing.join(', ')}`);
            }
        }
    }
    
    // Extract tables
    const tables = extractTables(xmlContent);
    
    console.log(`🔍 Found ${sectionMatches.length} section matches before processing`);
    if (sectionMatches.length === 0) {
        console.warn('⚠️ No section matches found! This means the regex did not match any paragraphs.');
        console.warn('   Check the paragraph logs above to see what text was found.');
        console.warn('   Using titles from extractAllSectionTitles to create section matches...');
        
        // Use titles from extractAllSectionTitles to create section matches
        if (allTitlesMap && allTitlesMap.size > 0) {
            allTitlesMap.forEach((titleInfo, number) => {
                // Find the paragraph for this title
                const para = paragraphs[titleInfo.paragraphIndex];
                if (para) {
                    sectionMatches.push({
                        number: number,
                        title: titleInfo.title,
                        index: para.index || 0,
                        paragraphIndex: titleInfo.paragraphIndex
                    });
                    console.log(`  ✅ Created section match ${number} from title map: "${titleInfo.title}"`);
                }
            });
            
            console.log(`🔍 After using title map: ${sectionMatches.length} section matches found`);
        } else {
            console.warn('  ⚠️ No titles found in allTitlesMap either! Attempting alternative extraction...');
            
            // Try alternative: look for paragraphs containing "Contrôle" which are likely section titles
            for (let i = 0; i < paragraphs.length; i++) {
                const para = paragraphs[i];
                const text = para.text.trim();
                
                // Look for patterns like "1- Contrôle" or "Contrôle" with a number nearby
                if (/Contrôle/i.test(text)) {
                    // First try numbered pattern
                    const altMatch = text.match(/^(\d+)[-\s\.]+\s*(.+)$/);
                    if (altMatch) {
                        const number = parseInt(altMatch[1], 10);
                        let title = altMatch[2].trim();
                        
                        console.log(`🔍 Alternative: Found potential section ${number}: "${title}"`);
                        
                        // Only add if it contains "Contrôle" and looks valid
                        if (/Contrôle/i.test(title) && title.length > 5) {
                            sectionMatches.push({
                                number: number,
                                title: `${number}- ${title}`,
                                index: para.index,
                                paragraphIndex: i
                            });
                            console.log(`  ✅ Alternative: Accepted section ${number}`);
                        }
                    } else if (/^Contrôle/i.test(text) && text.length > 10) {
                        // Title starts with "Contrôle" but has no number - use allTitlesMap if available
                        if (allTitlesMap && allTitlesMap.size > 0) {
                            // Find matching title in map by checking paragraph index
                            for (const [number, titleInfo] of allTitlesMap.entries()) {
                                if (titleInfo.paragraphIndex === i) {
                                    sectionMatches.push({
                                        number: number,
                                        title: titleInfo.title,
                                        index: para.index,
                                        paragraphIndex: i
                                    });
                                    console.log(`  ✅ Alternative: Found unnumbered title in map for section ${number}`);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            
            console.log(`🔍 After alternative extraction: ${sectionMatches.length} section matches found`);
        }
    } else {
        // If we have section matches, update their titles from the map if available
        sectionMatches.forEach(match => {
            if (allTitlesMap && allTitlesMap.has(match.number)) {
                const titleInfo = allTitlesMap.get(match.number);
                match.title = titleInfo.title;
                console.log(`  ✅ Updated title for section ${match.number} from title map`);
            }
        });
    }
    
    // Create a full text content for matching PASS/FAIL and tables
    const textContent = extractTextContent(xmlContent);
    
    // Match sections with tables and PASS/FAIL fields
    sectionMatches.forEach((sectionMatch, idx) => {
        // Find the range for this section using paragraph indices
        const currentParaIndex = sectionMatch.paragraphIndex;
        const nextParaIndex = idx < sectionMatches.length - 1 
            ? sectionMatches[idx + 1].paragraphIndex 
            : paragraphs.length;
        
        // Build section text from paragraphs
        let sectionText = '';
        for (let p = currentParaIndex; p < nextParaIndex && p < paragraphs.length; p++) {
            if (paragraphs[p] && paragraphs[p].text) {
                sectionText += paragraphs[p].text + ' ';
            }
        }
        sectionText = sectionText.trim();
        
        // Debug: log section text (first 200 chars)
        console.log(`📝 Section ${sectionMatch.number} text (first 200 chars): "${sectionText.substring(0, 200)}..."`);
        
        // Check for PASS/FAIL fields in this section
        // PASS/FAIL can appear in multiple sections (2, 6, 8, 12, etc.)
        // Don't restrict to only sections 1 and 5
        let passFailMatches = [];
        
        // Detect PASS/FAIL in any section (not just 1 and 5)
        {
            // Check paragraphs in the section for PASS/FAIL fields
            // Expand search range to catch all PASS/FAIL fields in the entire section
            if (sectionMatch.paragraphIndex !== undefined && paragraphs && paragraphs.length > 0) {
                const titleParaIndex = sectionMatch.paragraphIndex;
                const sectionEndPara = idx < sectionMatches.length - 1 
                    ? sectionMatches[idx + 1].paragraphIndex 
                    : Math.min(titleParaIndex + 50, paragraphs.length); // Search up to 50 paragraphs or next section
                
                let sectionParaText = '';
                // Check paragraphs in the section range
                for (let i = Math.max(0, titleParaIndex + 1); i < sectionEndPara && i < paragraphs.length; i++) {
                    if (!paragraphs[i] || !paragraphs[i].text) continue;
                    const paraText = paragraphs[i].text.trim();
                    // Stop if we hit a new numbered section
                    if (paraText.match(/^\d+[-\s\.]+\s*(Contrôle|Montage|Cyclage|Tir|Emballage)/i)) {
                        break;
                    }
                    sectionParaText += ' ' + paraText;
                }
                
                // Check if this text contains "PASS" and "FAIL" patterns
                // Pattern 1: "Connecteur X : PASS FAIL" or "Connecteur X (coté...): PASS FAIL"
                if (sectionParaText.match(/Connecteur/i) && sectionParaText.match(/PASS/i) && sectionParaText.match(/FAIL/i)) {
                    // Extract all connector mentions
                    const connectorPattern = /(Connecteur\s+\d+(?:\s*\([^)]+\))?)/gi;
                    let connMatch;
                    const foundConnectors = new Set();
                    
                    while ((connMatch = connectorPattern.exec(sectionParaText)) !== null) {
                        const connectorName = connMatch[1].trim();
                        if (!foundConnectors.has(connectorName)) {
                            foundConnectors.add(connectorName);
                            passFailMatches.push({
                                field: connectorName,
                                type: 'pass_fail'
                            });
                        }
                    }
                }
                
                // Pattern 2: Other PASS/FAIL fields (e.g., "Max pendant CIT <0,2 dB : PASS FAIL")
                // Look for text followed by "PASS" and "FAIL" on the same line
                const passFailPattern = /([^:]+):\s*PASS\s*FAIL/gi;
                let pfMatch;
                while ((pfMatch = passFailPattern.exec(sectionParaText)) !== null) {
                    const fieldName = pfMatch[1].trim();
                    // Skip if it's already a connector field
                    if (!fieldName.match(/Connecteur/i) && fieldName.length > 5 && fieldName.length < 100) {
                        // Check if this field is not already in the list
                        if (!passFailMatches.some(pf => pf.field === fieldName)) {
                            passFailMatches.push({
                                field: fieldName,
                                type: 'pass_fail'
                            });
                        }
                    }
                }
            }
            
            // Debug log for PASS/FAIL detection
            if (passFailMatches.length > 0) {
                if (!isLargeFile) {
                    console.log(`  🔘 Found ${passFailMatches.length} PASS/FAIL fields in section ${sectionMatch.number}`);
                }
            }
        }
        
        // Find associated table - match by section number and position
        // Each section should have its table matched by order
        let associatedTable = null;
        
        // Sections can have both PASS/FAIL AND tables
        // Don't exclude tables just because there are PASS/FAIL fields
        
        if (tables.length > 0) {
            // Filter out header tables (tables with "Numéro lancement" or "Référence SILOG" in headers)
            const dataTables = tables.filter(table => {
                const headersText = table.headers.join(' ').toLowerCase();
                // Skip tables that are clearly header tables
                return !headersText.includes('numéro lancement') && 
                       !headersText.includes('référence silog') &&
                       !headersText.includes('n° cordon');
            });
            
            // Only assign table if section doesn't have PASS/FAIL fields detected
            // But sections 2, 3, 4 should always get tables even if PASS/FAIL is detected incorrectly
            if (passFailMatches.length === 0) {
                // Try to match table by section number (section 2 -> first data table, section 3 -> second, section 4 -> third)
                // Skip header table, so section 2 -> dataTables[0], section 3 -> dataTables[1], section 4 -> dataTables[2]
                const tableIndex = sectionMatch.number - 2; // Section 2 -> index 0, Section 3 -> index 1, etc.
                if (tableIndex >= 0 && tableIndex < dataTables.length) {
                    associatedTable = dataTables[tableIndex];
                    console.log(`  📊 Assigned data table ${tableIndex} (filtered from ${tables.length} total tables) to section ${sectionMatch.number}`);
                } else {
                    console.log(`  ⚠️ No data table found for section ${sectionMatch.number} (tableIndex: ${tableIndex}, dataTables.length: ${dataTables.length})`);
                }
            } else {
                // Even if PASS/FAIL detected, sections 2-4 should have tables
                // Clear PASS/FAIL for sections 2-4
                if (sectionMatch.number >= 2 && sectionMatch.number <= 4) {
                    console.log(`  ⚠️ Section ${sectionMatch.number} is 2-4, clearing incorrect PASS/FAIL detection and assigning table`);
                    passFailMatches = [];
                    const tableIndex = sectionMatch.number - 2;
                    if (tableIndex >= 0 && tableIndex < dataTables.length) {
                        associatedTable = dataTables[tableIndex];
                        console.log(`  📊 Assigned data table ${tableIndex} (filtered from ${tables.length} total tables) to section ${sectionMatch.number}`);
                    } else {
                        console.log(`  ⚠️ No data table found for section ${sectionMatch.number} after clearing PASS/FAIL`);
                    }
                } else {
                    console.log(`  ⚠️ Section ${sectionMatch.number} has PASS/FAIL, skipping table assignment`);
                }
            }
        }
        
        // Find checkboxes in this section
        // Improve matching: check if checkbox label appears in section text or nearby paragraphs
        const sectionCheckboxes = [];
        const sectionStartPara = sectionMatch.paragraphIndex;
        // For the last section, search until the end of the document, not just 50 paragraphs
        const sectionEndPara = idx < sectionMatches.length - 1 
            ? sectionMatches[idx + 1].paragraphIndex 
            : paragraphs.length; // Last section: search until end
        
        if (sectionStartPara !== undefined && sectionEndPara !== undefined && paragraphs && paragraphs.length > 0 && checkboxes && checkboxes.length > 0) {
            // CRITICAL: First filter checkboxes by position, then verify by text matching, then sort
            // This ensures we preserve the document order
            const candidateCheckboxes = [];
            
            // Step 1: Filter checkboxes that are in the paragraph range of this section
            for (const cb of checkboxes) {
                if (!cb || !cb.label) continue;
                
                // Check if checkbox is in the paragraph range of this section
                const cbParaIndex = cb.paragraphIndex !== undefined ? cb.paragraphIndex : -1;
                const isInRange = cbParaIndex >= sectionStartPara && cbParaIndex < sectionEndPara;
                
                if (isInRange) {
                    candidateCheckboxes.push(cb);
                }
            }
            
            // CRITICAL: Sort candidate checkboxes by position BEFORE matching
            // This ensures that when we add them to matchedCheckboxes, they're already in order
            candidateCheckboxes.sort((a, b) => {
                if (a.paragraphIndex !== undefined && b.paragraphIndex !== undefined) {
                    const diff = a.paragraphIndex - b.paragraphIndex;
                    if (diff !== 0) return diff;
                }
                return (a.position || 0) - (b.position || 0);
            });
            
            // Step 2: Verify by text matching with section paragraphs
            const matchedCheckboxes = [];
            const sectionText = [];
            for (let p = sectionStartPara; p < sectionEndPara && p < paragraphs.length; p++) {
                if (paragraphs[p] && paragraphs[p].text) {
                    sectionText.push(paragraphs[p].text.toLowerCase());
                }
            }
            const fullSectionText = sectionText.join(' ').toLowerCase();
            
            // Process candidate checkboxes in sorted order
            for (const cb of candidateCheckboxes) {
                if (!cb || !cb.label) continue;
                const cbLabel = cb.label.toLowerCase();
                
                // Multiple matching strategies:
                let isMatch = false;
                
                // Strategy 1: Check if checkbox label appears in any paragraph of the section
                for (const paraText of sectionText) {
                    if (paraText.includes(cbLabel) || cbLabel.includes(paraText.substring(0, Math.min(50, paraText.length)))) {
                        isMatch = true;
                        break;
                    }
                }
                
                // Strategy 2: Word-based matching
                if (!isMatch) {
                    const cbWords = cbLabel.split(/\s+/).filter(w => w.length > 3);
                    if (cbWords.length > 0) {
                        for (const paraText of sectionText) {
                            const paraWords = paraText.split(/\s+/).filter(w => w.length > 3);
                            if (paraWords.length > 0) {
                                const matchingWords = cbWords.filter(cbw => 
                                    paraWords.some(pw => pw.includes(cbw) || cbw.includes(pw))
                                );
                                if (matchingWords.length >= Math.min(2, Math.max(1, cbWords.length / 2))) {
                                    isMatch = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // Strategy 3: If checkbox is in range and we can't find a better match, include it anyway
                // (this handles edge cases where text matching fails but position is correct)
                if (!isMatch) {
                    const cbParaIdx = cb.paragraphIndex !== undefined ? cb.paragraphIndex : -1;
                    if (cbParaIdx >= sectionStartPara && cbParaIdx < sectionEndPara) {
                        // Only include if it's clearly in the section range
                        isMatch = true;
                    }
                }
                
                if (isMatch) {
                    matchedCheckboxes.push(cb);
                }
            }
            
            // Step 3: Final sort of matched checkboxes by their position in the document
            // This is CRITICAL to maintain the exact order as they appear in the Word document
            // Note: candidateCheckboxes are already sorted, but we sort again here to be absolutely sure
            // and to handle any edge cases where checkboxes might be added out of order
            matchedCheckboxes.sort((a, b) => {
                // First sort by paragraph index if available (most accurate for order)
                if (a.paragraphIndex !== undefined && b.paragraphIndex !== undefined) {
                    const diff = a.paragraphIndex - b.paragraphIndex;
                    if (diff !== 0) return diff;
                }
                // Then by position in XML (absolute position in document)
                // This handles cases where multiple checkboxes are in the same paragraph
                return (a.position || 0) - (b.position || 0);
            });
            
            // Debug: Log checkbox order for verification
            if (matchedCheckboxes.length > 0 && !isLargeFile) {
                console.log(`  ☑️ Section ${sectionMatch.number}: Found ${matchedCheckboxes.length} checkboxes in order:`);
                matchedCheckboxes.forEach((cb, idx) => {
                    console.log(`    ${idx + 1}. [paraIndex: ${cb.paragraphIndex}, pos: ${cb.position}] ${cb.label.substring(0, 50)}`);
                });
            }
            
            // Add sorted checkboxes to section
            sectionCheckboxes.push(...matchedCheckboxes);
            
            // For section 13 specifically, also check if there are unmatched checkboxes near the end
            // that might belong to it (fallback for last section)
            if (sectionMatch.number === 13 && sectionCheckboxes.length === 0 && checkboxes.length > 0) {
                // Find checkboxes that haven't been assigned to any section yet
                // Check the last 20 checkboxes (likely to be in section 13), sorted by position
                const unassignedCheckboxes = checkboxes
                    .filter(cb => !sectionCheckboxes.find(existing => existing.id === cb.id))
                    .slice(-20)
                    .sort((a, b) => {
                        if (a.paragraphIndex !== undefined && b.paragraphIndex !== undefined) {
                            return a.paragraphIndex - b.paragraphIndex;
                        }
                        return (a.position || 0) - (b.position || 0);
                    });
                
                unassignedCheckboxes.forEach(cb => {
                    if (!cb || !cb.label) return;
                    // Check if label contains keywords related to packaging/emballage
                    const cbLabel = cb.label.toLowerCase();
                    if (cbLabel.match(/retreint|thermo|rayon|courbure|dessiccant|étiquette|emballage/i)) {
                        sectionCheckboxes.push(cb);
                    }
                });
                
                // Re-sort after adding fallback checkboxes to preserve order
                sectionCheckboxes.sort((a, b) => {
                    if (a.paragraphIndex !== undefined && b.paragraphIndex !== undefined) {
                        const diff = a.paragraphIndex - b.paragraphIndex;
                        if (diff !== 0) return diff;
                    }
                    return (a.position || 0) - (b.position || 0);
                });
                
                // Debug: Log final checkbox order for section 13
                if (!isLargeFile && sectionCheckboxes.length > 0) {
                    console.log(`  ☑️ Section 13 (fallback): Final order of ${sectionCheckboxes.length} checkboxes:`);
                    sectionCheckboxes.forEach((cb, idx) => {
                        console.log(`    ${idx + 1}. [paraIndex: ${cb.paragraphIndex}, pos: ${cb.position}] ${cb.label.substring(0, 50)}`);
                    });
                }
            }
        }
        
        // Extract simple text fields from section (e.g., "Voie du cordon sur connecteur 38999 : _______")
        // Also check the section title itself for text fields (e.g., "13- Emballage :MO 1098 ind___")
        const textFieldsInSection = [];
        
        // First, check the section title for text fields
        const titleText = sectionMatch.title || '';
        // Pattern: "Label :MO XXX ind___" or "Label :MO XXX ind" followed by underscores
        // More flexible pattern to catch variations
        const titleTextFieldPatterns = [
            /:\s*(MO\s+\d+\s+ind\s*_{2,})/i,  // "13- Emballage :MO 1098 ind___"
            /:\s*(MO\s+\d+\s+ind\s*_+)/i,     // "13- Emballage :MO 1098 ind___" (flexible underscores)
            /(MO\s+\d+\s+ind\s*_{2,})/i       // "MO 1098 ind___" (without colon before)
        ];
        
        for (const pattern of titleTextFieldPatterns) {
            const titleMatch = titleText.match(pattern);
            if (titleMatch) {
                // Extract the label part (everything before the MO pattern)
                const moPart = titleMatch[1] || titleMatch[0];
                const labelPart = titleText.split(moPart)[0].replace(/:\s*$/, '').trim();
                // This is a MO reference field in the title
                if (labelPart) {
                    textFieldsInSection.push({
                        label: labelPart + ' :MO',
                        placeholder: 'MO XXX ind___'
                    });
                    break; // Only add once
                }
            }
        }
        
        // Then check paragraphs in the section
        if (sectionStartPara !== undefined && sectionEndPara !== undefined && paragraphs && paragraphs.length > 0) {
            for (let p = sectionStartPara; p < sectionEndPara && p < paragraphs.length; p++) {
                if (!paragraphs[p] || !paragraphs[p].text) continue;
                const paraText = paragraphs[p].text;
                // Pattern: "Label : _______" or "Label : ______"
                const textFieldPattern = /([^:]+):\s*_{3,}/;
                const match = paraText.match(textFieldPattern);
                if (match) {
                    const fieldLabel = match[1].trim();
                    // Skip if it's a PASS/FAIL field or connector
                    if (!fieldLabel.match(/PASS|FAIL|Connecteur/i) && fieldLabel.length > 5) {
                        // Check if this field is not already added from the title
                        if (!textFieldsInSection.some(tf => tf.label.includes(fieldLabel))) {
                            textFieldsInSection.push({
                                label: fieldLabel,
                                placeholder: '_______'
                            });
                        }
                    }
                }
            }
        }
        
        // Determine section type more accurately
        // A section can have multiple types (PASS/FAIL + table + checkboxes)
        let sectionType = 'text';
        if (passFailMatches.length > 0 && associatedTable) {
            sectionType = 'mixed'; // Has both PASS/FAIL and table
        } else if (passFailMatches.length > 0) {
            sectionType = 'pass_fail';
        } else if (associatedTable) {
            sectionType = 'table';
        } else if (sectionCheckboxes.length > 0) {
            sectionType = 'checkboxes';
        } else if (textFieldsInSection.length > 0) {
            sectionType = 'text_fields';
        }
        
        // Ensure we use the title from the map if available (more complete)
        let finalTitle = sectionMatch.title;
        if (allTitlesMap.has(sectionMatch.number)) {
            finalTitle = allTitlesMap.get(sectionMatch.number).title;
        }
        
        // Find ALL tables in this section (not just one)
        // A section can have multiple tables (e.g., section 1 has "Collage" table AND "Polymérisation" table)
        const sectionTables = [];
        if (tables.length > 0) {
            // Find tables that are within this section's paragraph range
            // We need to match tables by their position in the XML relative to section paragraphs
            const sectionStartIndex = sectionMatch.index || 0;
            const sectionEndIndex = idx < sectionMatches.length - 1 
                ? (sectionMatches[idx + 1].index || xmlContent.length)
                : xmlContent.length;
            
            // For now, use the simple approach: assign tables by order within filtered dataTables
            // But we should improve this to match by actual position
            {
                // Try to find all tables that belong to this section
                // For sections with multiple tables, we need to match them by proximity
                const dataTables = tables.filter(table => {
                    const headersText = table.headers.join(' ').toLowerCase();
                    return !headersText.includes('numéro lancement') && 
                           !headersText.includes('référence silog') &&
                           !headersText.includes('n° cordon');
                });
                
                // Simple heuristic: if section 1, it might have 2 tables (Collage + Polymérisation)
                // For now, assign the first matching table, but we'll extend this
                if (associatedTable) {
                    sectionTables.push(associatedTable);
                }
                
                // For section 1, try to find a second table (Polymérisation)
                if (sectionMatch.number === 1 && dataTables.length > 1) {
                    // Look for a table with "Heure" in headers (Polymérisation table)
                    const polymerisationTable = dataTables.find(t => 
                        t.headers.some(h => h.toLowerCase().includes('heure'))
                    );
                    if (polymerisationTable && polymerisationTable !== associatedTable) {
                        sectionTables.push(polymerisationTable);
                    }
                }
            }
        }
        
        const section = {
            id: sectionMatch.number,
            title: finalTitle,
            type: sectionType,
            fields: passFailMatches.length > 0 ? passFailMatches.map(m => m.field) : [],
            table: sectionTables.length > 0 ? sectionTables[0] : null, // Keep for backward compatibility
            tables: sectionTables.length > 0 ? sectionTables : [], // NEW: support multiple tables
            checkboxes: sectionCheckboxes,
            textFields: textFieldsInSection // NEW: simple text input fields
        };
        
        sections.push(section);
        
        // Debug log
        console.log(`✅ Section ${section.id}: "${section.title}" - Type: ${sectionType}, PASS/FAIL: ${passFailMatches.length}, Table: ${associatedTable ? 'Yes' : 'No'}, Checkboxes: ${sectionCheckboxes.length}`);
    });
    
    // If no numbered sections found but we have tables, try to create sections from tables
    // This should not happen if extraction works correctly, but it's a fallback
    // Use a Set to track which section numbers have already been created to avoid duplicates
    const createdSectionNumbers = new Set(sections.map(s => s.id));
    
    if (sections.length === 0 && tables.length > 0) {
        console.log('⚠️ No numbered sections found, creating sections from tables...');
        console.log(`   Found ${sectionMatches.length} section matches but ${sections.length} sections created`);
        console.log(`   This means section extraction failed. Check logs above for rejected sections.`);
        console.log(`   Tables found: ${tables.length}`);
        console.log(`   Using titles from extractAllSectionTitles to create sections...`);
        
        // Find table positions in XML to find preceding paragraphs
        const tablePositions = [];
        const tableRegex = /<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g;
        let tableMatch;
        while ((tableMatch = tableRegex.exec(xmlContent)) !== null) {
            tablePositions.push({
                index: tableMatch.index,
                tableIndex: tablePositions.length
            });
        }
        
        // Create sections for each table found, using titles from extractAllSectionTitles
        tables.forEach((table, idx) => {
            const sectionNumber = idx + 1;
            
            // Skip if this section number already exists (avoid duplicates)
            if (createdSectionNumbers.has(sectionNumber)) {
                console.log(`   ⚠️ Section ${sectionNumber} already exists, skipping...`);
                return;
            }
            
            // Get title from the map if available
            let sectionTitle = `Section ${sectionNumber}`;
            if (allTitlesMap.has(sectionNumber)) {
                sectionTitle = allTitlesMap.get(sectionNumber).title;
                console.log(`   ✅ Using title from map for section ${sectionNumber}: "${sectionTitle}"`);
            }
            
            let sectionType = 'table';
            let sectionFields = [];
            
            // Try to find a title in paragraphs before this table
            if (tablePositions[idx]) {
                const tableStartIndex = tablePositions[idx].index;
                
                // Look for paragraphs before this table (within last 2000 chars)
                const searchStart = Math.max(0, tableStartIndex - 2000);
                const searchText = xmlContent.substring(searchStart, tableStartIndex);
                
                // Extract paragraphs from this region
                const paraRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
                let paraMatch;
                const precedingParagraphs = [];
                
                while ((paraMatch = paraRegex.exec(searchText)) !== null) {
                    const paraXml = paraMatch[1];
                    const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
                    const texts = [];
                    let textMatch;
                    
                    while ((textMatch = textRegex.exec(paraXml)) !== null) {
                        const text = textMatch[1] || textMatch[2] || '';
                        if (text.trim()) {
                            texts.push(text);
                        }
                    }
                    
                    const paraText = texts.join('').trim();
                    if (paraText && paraText.length > 3) {
                        precedingParagraphs.push(paraText);
                    }
                }
                
                // Look for section titles in preceding paragraphs (most recent first)
                for (let i = precedingParagraphs.length - 1; i >= 0; i--) {
                    const paraText = precedingParagraphs[i];
                    
                    // Try multiple patterns to match section titles
                    let titleMatch = paraText.match(/^(\d+)[-\s\.]+\s*(.+)$/);
                    
                    // If no match, try more flexible patterns
                    if (!titleMatch) {
                        titleMatch = paraText.match(/^(\d+)[\s\-\.]+(.+)$/);
                    }
                    if (!titleMatch) {
                        titleMatch = paraText.match(/^(\d+)\s+(.+)$/);
                    }
                    
                    if (titleMatch) {
                        const number = parseInt(titleMatch[1], 10);
                        let title = titleMatch[2].trim();
                        
                        // Check if this looks like a valid section title
                        // Accept if it contains "Contrôle" or starts with a capital letter
                        if ((/Contrôle/i.test(title) || /^[A-Z]/.test(title)) && title.length > 5) {
                            // Try to get continuation from next paragraphs if title ends with colon
                            let fullTitle = title;
                            if (title.endsWith(':') && i > 0) {
                                // Check next paragraph for continuation (like "MO 1097 ind")
                                for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
                                    const nextPara = precedingParagraphs[j];
                                    if (nextPara.match(/^(MO\s+\d+|ind)/i) && nextPara.length < 50) {
                                        fullTitle += ' ' + nextPara;
                                        break;
                                    }
                                }
                            }
                            
                            sectionTitle = `${number}- ${fullTitle.trim()}`;
                            console.log(`   ✅ Found title for section ${idx + 1}: "${sectionTitle}"`);
                            break;
                        }
                    }
                    
                    // Also check for PASS/FAIL patterns
                    if (paraText.match(/Connecteur/i) && (paraText.match(/PASS/i) || paraText.match(/FAIL/i))) {
                        sectionType = 'pass_fail';
                        // Extract connector fields
                        const connectorPattern = /(Connecteur\s+\d+)/gi;
                        let connMatch;
                        while ((connMatch = connectorPattern.exec(paraText)) !== null) {
                            sectionFields.push(connMatch[1].trim());
                        }
                        console.log(`   ✅ Found PASS/FAIL section for table ${idx + 1} with ${sectionFields.length} fields`);
                    }
                }
                
                // If still no title found, try searching in a wider range (up to 10000 chars)
                if (sectionTitle === `Section ${idx + 1}` && tablePositions[idx]) {
                    const tableStartIndex = tablePositions[idx].index;
                    const widerSearchStart = Math.max(0, tableStartIndex - 10000);
                    const widerSearchText = xmlContent.substring(widerSearchStart, tableStartIndex);
                    
                    console.log(`   🔍 Searching for title in wider range (${widerSearchStart} to ${tableStartIndex}) for section ${idx + 1}`);
                    
                    // Look for any paragraph with "Contrôle" and a number
                    const widerParaRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
                    let widerParaMatch;
                    const widerParagraphs = [];
                    
                    while ((widerParaMatch = widerParaRegex.exec(widerSearchText)) !== null) {
                        const paraXml = widerParaMatch[1];
                        const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
                        const texts = [];
                        let textMatch;
                        
                        while ((textMatch = textRegex.exec(paraXml)) !== null) {
                            const text = textMatch[1] || textMatch[2] || '';
                            if (text.trim()) {
                                texts.push(text);
                            }
                        }
                        
                        const paraText = texts.join('').trim();
                        if (paraText && paraText.length > 3) {
                            widerParagraphs.push({
                                text: paraText,
                                position: widerParaMatch.index
                            });
                        }
                    }
                    
                    console.log(`   📋 Found ${widerParagraphs.length} paragraphs in wider search`);
                    
                    // Look for section titles (most recent first)
                    for (let i = widerParagraphs.length - 1; i >= 0; i--) {
                        const para = widerParagraphs[i];
                        const paraText = para.text;
                        
                        // Try multiple patterns
                        let titleMatch = paraText.match(/^(\d+)[-\s\.]+\s*(.+)$/);
                        if (!titleMatch) {
                            titleMatch = paraText.match(/^(\d+)[\s\-\.]+(.+)$/);
                        }
                        if (!titleMatch) {
                            titleMatch = paraText.match(/^(\d+)\s+(.+)$/);
                        }
                        
                        if (titleMatch) {
                            const number = parseInt(titleMatch[1], 10);
                            const title = titleMatch[2].trim();
                            
                            // Accept if it contains "Contrôle" or looks like a valid title
                            if ((/Contrôle/i.test(title) || /^[A-Z]/.test(title)) && title.length > 5) {
                                sectionTitle = `${number}- ${title}`;
                                console.log(`   ✅ Found title in wider search for section ${idx + 1}: "${sectionTitle}"`);
                                break;
                            }
                        }
                    }
                    
                    // If still no title, try to find any paragraph with the expected section number
                    if (sectionTitle === `Section ${idx + 1}`) {
                        const expectedNumber = idx + 1;
                        for (let i = widerParagraphs.length - 1; i >= 0; i--) {
                            const para = widerParagraphs[i];
                            const paraText = para.text;
                            
                            // Check if paragraph starts with expected section number
                            if (paraText.match(new RegExp(`^${expectedNumber}[-\s\.]`))) {
                                const titleMatch = paraText.match(/^(\d+)[-\s\.]+\s*(.+)$/) || 
                                                  paraText.match(/^(\d+)\s+(.+)$/);
                                if (titleMatch) {
                                    const title = titleMatch[2].trim();
                                    if (title.length > 5) {
                                        sectionTitle = `${expectedNumber}- ${title}`;
                                        console.log(`   ✅ Found title by section number for section ${idx + 1}: "${sectionTitle}"`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            const newSection = {
                id: sectionNumber,
                title: sectionTitle,
                type: sectionType,
                fields: sectionFields,
                table: sectionType === 'table' ? table : null,
                checkboxes: []
            };
            
            sections.push(newSection);
            createdSectionNumbers.add(sectionNumber);
            console.log(`   ✅ Created section ${sectionNumber}: "${sectionTitle}" (type: ${sectionType})`);
        });
        
        // Also create sections for PASS/FAIL that don't have tables (sections 1 and 5)
        // Check if we have titles for sections 1 and 5 but no sections created for them
        [1, 5].forEach(sectionNum => {
            if (!createdSectionNumbers.has(sectionNum) && allTitlesMap.has(sectionNum)) {
                const titleInfo = allTitlesMap.get(sectionNum);
                const title = titleInfo.title;
                
                // Check if this section has PASS/FAIL fields
                const titleParaIndex = titleInfo.paragraphIndex;
                let hasPassFail = false;
                const passFailFields = [];
                
                // Look for PASS/FAIL in paragraphs after the title
                for (let i = titleParaIndex; i < Math.min(titleParaIndex + 10, paragraphs.length); i++) {
                    const paraText = paragraphs[i].text;
                    if (paraText.match(/Connecteur/i) && (paraText.match(/PASS/i) || paraText.match(/FAIL/i))) {
                        hasPassFail = true;
                        // Extract connector fields
                        const connectorPattern = /(Connecteur\s+\d+)/gi;
                        let connMatch;
                        while ((connMatch = connectorPattern.exec(paraText)) !== null) {
                            const connectorName = connMatch[1].trim();
                            if (!passFailFields.includes(connectorName)) {
                                passFailFields.push(connectorName);
                            }
                        }
                    }
                }
                
                if (hasPassFail || passFailFields.length > 0) {
                    sections.push({
                        id: sectionNum,
                        title: title,
                        type: 'pass_fail',
                        fields: passFailFields,
                        table: null,
                        checkboxes: []
                    });
                    createdSectionNumbers.add(sectionNum);
                    console.log(`   ✅ Created PASS/FAIL section ${sectionNum}: "${title}" with ${passFailFields.length} fields`);
                }
            }
        });
    }
    
    // Check for "Général" section (non-numbered section before section 1)
    // Look for paragraphs containing "Général" or "Composant" before the first numbered section
    if (sectionMatches.length > 0 && paragraphs.length > 0 && sectionMatches[0].paragraphIndex !== undefined) {
        const firstSectionIndex = sectionMatches[0].paragraphIndex;
        for (let i = 0; i < Math.min(firstSectionIndex, 50) && i < paragraphs.length; i++) {
            const paraText = paragraphs[i]?.text?.trim() || '';
            if (paraText.match(/Général|Composant/i) && paraText.length > 5) {
                // Check if there's a table nearby (the "Composant" table)
                const generalTable = tables.find(t => {
                    if (!t || !t.headers || !Array.isArray(t.headers)) return false;
                    const headersText = t.headers.join(' ').toLowerCase();
                    return headersText.includes('composant') || headersText.includes('lot');
                });
                
                if (generalTable) {
                    sections.push({
                        id: 0, // Use 0 for Général section
                        title: 'Général : Composant',
                        type: 'table',
                        fields: [],
                        table: generalTable,
                        tables: [generalTable],
                        checkboxes: [],
                        textFields: []
                    });
                    console.log('✅ Found "Général : Composant" section with table');
                    break;
                }
            }
        }
    }
    
    // Sort sections by ID to ensure correct order (0 comes before 1)
    sections.sort((a, b) => a.id - b.id);
    
    // Remove any duplicates (should not happen, but safety check)
    const seenIds = new Set();
    const uniqueSections = [];
    sections.forEach(section => {
        if (!seenIds.has(section.id)) {
            seenIds.add(section.id);
            uniqueSections.push(section);
        } else {
            console.warn(`⚠️ Duplicate section ${section.id} detected, removing duplicate`);
        }
    });
    
    console.log(`📊 Extracted ${uniqueSections.length} sections (after deduplication), ${tables.length} tables`);
    
    // Check if we're missing sections (especially for documents that should have 13 sections)
    const sectionIds = uniqueSections.map(s => s.id).sort((a, b) => a - b);
    const maxSectionId = sectionIds.length > 0 ? Math.max(...sectionIds) : 0;
    
    if (maxSectionId >= 10) {
        // Likely a document with many sections, check for gaps
        const missing = [];
        for (let n = 1; n <= maxSectionId; n++) {
            if (!sectionIds.includes(n)) {
                missing.push(n);
            }
        }
        if (missing.length > 0) {
            console.warn(`⚠️ Missing sections: ${missing.join(', ')} (found sections: ${sectionIds.join(', ')})`);
        }
    }
    
    // Final summary
    if (uniqueSections.length > 0) {
        console.log('📋 Sections finales:');
        uniqueSections.forEach(s => {
            const tableCount = s.tables ? s.tables.length : (s.table ? 1 : 0);
            console.log(`  ${s.id}. "${s.title}" (${s.type}) - Fields: ${s.fields?.length || 0}, Tables: ${tableCount}, Checkboxes: ${s.checkboxes?.length || 0}`);
        });
    } else {
        console.warn('⚠️ Aucune section extraite!');
    }
    
    return uniqueSections;
}

/**
 * Extract tables from XML content
 */
function extractTables(xmlContent) {
    const tables = [];
    
    // Match table elements: <w:tbl>...</w:tbl>
    const tableRegex = /<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tableMatch;
    let tableIndex = 0;
    
    while ((tableMatch = tableRegex.exec(xmlContent)) !== null) {
        const tableXml = tableMatch[1];
        
        // Extract rows
        const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
        const rows = [];
        let rowMatch;
        
        while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
            const rowXml = rowMatch[1];
            
            // Extract cells - IMPORTANT: preserve all cells even if empty
            const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
            const cells = [];
            let cellMatch;
            
            while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
                const cellXml = cellMatch[1];
                
                // Extract text from cell, preserving spaces correctly
                const textRegex = /<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>|<w:t[^>]*>([^<]*)<\/w:t>/g;
                const cellTexts = [];
                let textMatch;
                
                while ((textMatch = textRegex.exec(cellXml)) !== null) {
                    if (!textMatch || !textMatch[0]) continue;
                    
                    const isPreserve = textMatch[0].includes('xml:space="preserve"');
                    const text = textMatch[1] || textMatch[2] || '';
                    
                    if (text) {
                        if (isPreserve) {
                            // Preserve exact spacing
                            cellTexts.push(text);
                        } else {
                            // For normal nodes, trim but preserve word boundaries
                            const trimmed = text.trim();
                            if (trimmed) {
                                // Add space if needed between words
                                if (cellTexts.length > 0 && !cellTexts[cellTexts.length - 1].endsWith(' ')) {
                                    cellTexts.push(' ');
                                }
                                cellTexts.push(trimmed);
                            }
                        }
                    }
                }
                
                // Join and normalize only multiple spaces
                const cellText = cellTexts.length > 0 ? cellTexts.join('').replace(/[ \t]+/g, ' ').trim() : '';
                // ALWAYS add cell, even if empty - this preserves table structure
                cells.push(cellText || '');
            }
            
            // Always add row with all cells (even empty ones)
            if (cells.length > 0) {
                rows.push(cells);
            }
        }
        
        if (rows.length > 0) {
            // First row is usually headers
            const headers = rows[0] || [];
            const dataRows = rows.slice(1);
            
            // Determine column types based on headers and content
            const columns = headers.map((header, idx) => {
                const columnData = dataRows.map(row => row[idx]).filter(Boolean);
                let type = 'text';
                
                // Check header for type hints
                const headerLower = header.toLowerCase();
                if (headerLower.includes('date')) {
                    type = 'date';
                } else if (headerLower.includes('heure') || headerLower.includes('time')) {
                    type = 'time';
                } else if (headerLower.includes('opérateur') || headerLower.includes('operateur')) {
                    type = 'operator';
                } else if (headerLower.includes('lot') || headerLower.includes('numéro')) {
                    type = 'text';
                } else if (headerLower.includes('quantité') || headerLower.includes('quantite')) {
                    type = 'numeric';
                } else if (headerLower.includes('mesures') || headerLower.includes('mm') || headerLower.includes('db') || headerLower.includes('°c')) {
                    type = 'numeric';
                }
                // Check if column contains numeric values
                else if (columnData.some(val => /^-?\d+\.?\d*$/.test(val))) {
                    type = 'numeric';
                }
                // Check if column contains dates
                else if (columnData.some(val => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(val))) {
                    type = 'date';
                }
                
                return {
                    name: header,
                    type: type,
                    index: idx
                };
            });
            
            // Ensure we have at least one data row (even if empty) for filling
            // Also ensure all rows have the same number of cells as headers
            const processedRows = dataRows.length > 0 ? dataRows : [new Array(headers.length).fill('')];
            
            tables.push({
                id: tableIndex++,
                headers: headers,
                columns: columns,
                rows: processedRows.map((row, rowIdx) => {
                    // Ensure row has same number of cells as headers (pad with empty strings if needed)
                    const normalizedRow = [];
                    for (let i = 0; i < headers.length; i++) {
                        normalizedRow.push(row[i] !== undefined ? row[i] : '');
                    }
                    
                    return {
                        id: rowIdx,
                        cells: normalizedRow.map((cellValue, cellIdx) => ({
                            columnIndex: cellIdx,
                            value: cellValue || '',
                            type: columns[cellIdx]?.type || 'text',
                            isEmpty: !cellValue || String(cellValue).trim() === ''
                        }))
                    };
                })
            });
        }
    }
    
    return tables;
}

/**
 * Find table associated with a section based on proximity in text
 */
function findTableForSection(sectionText, tables, sectionIndex) {
    // Simple heuristic: return first table if any
    // In a more sophisticated implementation, we could match by keywords or position
    // For now, match tables to sections by order
    const sectionNumber = parseInt(sectionText.match(/^(\d+)/)?.[1] || '0', 10);
    if (sectionNumber > 0 && sectionNumber <= tables.length) {
        return tables[sectionNumber - 1];
    }
    return tables.length > 0 ? tables[0] : null;
}

/**
 * Extract readable text content from XML (simplified)
 * Improved to better handle Word document structure
 */
function extractTextContent(xmlContent) {
    // Extract text nodes preserving exact formatting
    let text = xmlContent
        .replace(/<w:t[^>]*xml:space="preserve"[^>]*>([^<]*)<\/w:t>/g, '$1')
        .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1 ')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // DO NOT normalize or clean - preserve exact text as it appears
    return text;
}

/**
 * Find the document element in parsed XML
 */
function findDocumentElement(xmlObj) {
    // Navigate through the XML structure to find document
    if (Array.isArray(xmlObj)) {
        for (const item of xmlObj) {
            if (item['w:document']) {
                return item['w:document'];
            }
        }
    } else if (xmlObj['w:document']) {
        return xmlObj['w:document'];
    }
    
    // Try alternative structure
    if (xmlObj.document) {
        return xmlObj.document;
    }
    
    return xmlObj;
}

/**
 * Extract reference field (e.g., RETA-697-HOI-23.199) from document
 * Looks for:
 * - Placeholder {{REF}} or {{REFERENCE}}
 * - Text field labeled "Référence" or "Reference"
 * - Pattern matching RETA-XXX-XXX-XX.XXX format
 */
function extractReference(xmlContent, placeholders) {
    // First, check for explicit REF or REFERENCE placeholder
    const refPlaceholders = placeholders.filter(p => {
        const tag = p.replace(/[{}]/g, '').toUpperCase();
        return tag === 'REF' || tag === 'REFERENCE' || tag.startsWith('REF_');
    });
    
    if (refPlaceholders.length > 0) {
        return {
            placeholder: refPlaceholders[0],
            detected: true
        };
    }
    
    // Look for reference pattern in text (RETA-XXX-XXX-XX.XXX)
    const referencePattern = /(RETA-\d+-[A-Z0-9]+-\d+\.\d+)/i;
    const textContent = extractTextContent(xmlContent);
    const match = textContent.match(referencePattern);
    
    if (match) {
        return {
            value: match[1],
            detected: true
        };
    }
    
    // Look for "Référence:" or "Reference:" label
    const refLabelPattern = /(?:Référence|Reference)[\s:]+([A-Z0-9\-\.]+)/i;
    const labelMatch = textContent.match(refLabelPattern);
    
    if (labelMatch && labelMatch[1]) {
        return {
            value: labelMatch[1].trim(),
            detected: true
        };
    }
    
    return {
        detected: false
    };
}

/**
 * Extract tagged measures from document
 * Tagged measures are placeholders that:
 * - Start with TAG_ (e.g., {{TAG_MESURE1}}, {{TAG_LONGUEUR}})
 * - Or are explicitly marked for Excel transfer
 */
function extractTaggedMeasures(xmlContent, placeholders) {
    const taggedMeasures = [];
    
    // Find placeholders that start with TAG_
    const tagPattern = /TAG_/i;
    placeholders.forEach(placeholder => {
        const tagName = placeholder.replace(/[{}]/g, '');
        if (tagPattern.test(tagName)) {
            taggedMeasures.push({
                tag: tagName,
                placeholder: placeholder,
                detected: true
            });
        }
    });
    
    return taggedMeasures;
}

module.exports = {
    parseWordStructure
};

