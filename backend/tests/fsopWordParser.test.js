import { describe, expect, it } from 'vitest';

// CommonJS module
const parser = require('../services/fsopWordParser');

describe('fsopWordParser text extraction', () => {
    it('strips embedded Word XML checkbox tags from paragraph text', () => {
        const xml = `
            <w:p>
              <w:r><w:t>Tir puissance : MO 1114 ind ____</w:t></w:r>
              <w:r><w:t>&lt;w14:checkbox&gt;&lt;w14:checked w14:val="0"/&gt;&lt;/w14:checkbox&gt;</w:t></w:r>
              <w:r><w:t> 1000 tir 30W / 12 ms OK</w:t></w:r>
            </w:p>
        `;

        const text = parser.__test.extractTextFromParagraphXml(xml);
        expect(text).toContain('Tir puissance');
        expect(text).toContain('1000 tir 30W');
        expect(text.toLowerCase()).not.toContain('w14:checkbox');
        expect(text.toLowerCase()).not.toContain('w14:checked');
        expect(text).not.toContain('<w14:');
    });

    it('keeps comparison signs like "< 0,5 dB" intact', () => {
        const xml = `
            <w:p>
              <w:r><w:t>Perte d'insertion 850 nm (&lt; 0,5 dB)</w:t></w:r>
            </w:p>
        `;

        const text = parser.__test.extractTextFromParagraphXml(xml);
        expect(text).toContain('< 0,5 dB');
        expect(text.toLowerCase()).not.toContain('w14:');
    });
});

