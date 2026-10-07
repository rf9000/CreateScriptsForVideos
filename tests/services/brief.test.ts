import { describe, test, expect } from 'bun:test';
import { briefWorkItem, parseBrief } from '../../src/services/brief.ts';

describe('parseBrief', () => {
  test('first # heading is the title, the rest is the description', () => {
    const brief = parseBrief('# Get bank account information\n\nShow how entering an IBAN fills in the bank details.\n\n- Use a Dutch IBAN\n', 'iban.md');
    expect(brief.title).toBe('Get bank account information');
    expect(brief.description).toBe('Show how entering an IBAN fills in the bank details.\n\n- Use a Dutch IBAN');
  });

  test('without a heading the file name is the title and the whole text the description', () => {
    const brief = parseBrief('Just a description.', 'payment-journal.md');
    expect(brief.title).toBe('payment-journal');
    expect(brief.description).toBe('Just a description.');
  });

  test('ids are stable per file name, in a range real work items do not use', () => {
    const a = parseBrief('x', 'iban.md').id;
    expect(parseBrief('y', 'iban.md').id).toBe(a);
    expect(parseBrief('x', 'other.md').id).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(900_000_000);
    expect(a).toBeLessThan(1_000_000_000);
  });

  test('an explicit id wins', () => {
    expect(parseBrief('x', 'iban.md', 42).id).toBe(42);
  });
});

describe('briefWorkItem', () => {
  test('builds the work item shape the processor reads', () => {
    const item = briefWorkItem({ id: 7, title: 'T', description: 'D' });
    expect(item.id).toBe(7);
    expect(item.fields['System.Title']).toBe('T');
    expect(item.fields['System.Description']).toBe('D');
    expect(item.fields['System.WorkItemType']).toBe('Brief');
    expect(item.fields['System.Tags']).toBe('');
  });
});
