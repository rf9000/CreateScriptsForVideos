import { describe, test, expect } from 'bun:test';
import { htmlToText } from '../../src/services/html.ts';

describe('htmlToText', () => {
  test('strips tags and keeps text', () => {
    expect(htmlToText('<div>Show how to <b>create</b> a merge rule.</div>')).toBe(
      'Show how to create a merge rule.',
    );
  });

  test('converts block ends and <br> to newlines', () => {
    expect(htmlToText('<p>Line one</p><p>Line two</p>Line<br>three')).toBe(
      'Line one\nLine two\nLine\nthree',
    );
  });

  test('renders list items as dashes', () => {
    expect(htmlToText('<ul><li>First</li><li>Second</li></ul>')).toBe('- First\n- Second');
  });

  test('decodes common entities', () => {
    expect(htmlToText('A&nbsp;&amp;&nbsp;B &lt;tag&gt; &quot;q&quot; &#39;s&#39;')).toBe(
      'A & B <tag> "q" \'s\'',
    );
  });

  test('collapses excess blank lines and trims', () => {
    expect(htmlToText('<p></p><p>Text</p><p></p>')).toBe('Text');
  });

  test('returns empty string for empty/undefined-ish input', () => {
    expect(htmlToText('')).toBe('');
  });
});
