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

    it('extractTextContent preserves w:t text and strips leftover tags', () => {
        const xml = '<w:p><w:t xml:space="preserve">Hello</w:t><w:br/><w:t>World</w:t></w:p>';
        const text = parser.__test.extractTextContent(xml);
        expect(text).toContain('Hello');
        expect(text).toContain('World');
        expect(text).not.toContain('<w:');
    });

    it('stripXmlMarkup removes tags without eating comparison text', () => {
        expect(parser.__test.stripXmlMarkup('A<w:br/>B < 0,5')).toContain('A');
        expect(parser.__test.stripXmlMarkup('A<w:br/>B < 0,5')).toContain('B');
        expect(parser.__test.stripXmlMarkup('plain')).toBe('plain');
    });
});

