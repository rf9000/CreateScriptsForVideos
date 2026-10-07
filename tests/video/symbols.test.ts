import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { strToU8, zipSync } from 'fflate';
import {
  buildIndex, describePage, fieldGroupsFor, lintRecordingNames, loadSymbolIndex, readSymbolReference,
} from '../../src/video/symbols.ts';
import type { Recording } from '../../src/video/recording.ts';

const field = (name: string, caption?: string) => ({
  Kind: 8, Name: name, Properties: caption ? [{ Name: 'Caption', Value: caption }] : [],
});
const group = (name: string, caption: string | undefined, controls: unknown[]) => ({
  Kind: 1, Name: name, Properties: caption ? [{ Name: 'Caption', Value: caption }] : [], Controls: controls,
});
const action = (name: string, caption?: string, kind = 2) => ({
  Kind: kind, Name: name, Properties: caption ? [{ Name: 'Caption', Value: caption }] : [],
});

// Shapes as found in Microsoft_Base Application and Continia Banking SymbolReference.json.
const baseApp = {
  Pages: [
    {
      Id: 9022, Name: 'Business Manager Role Center',
      Controls: [],
      Actions: [{ Kind: 1, Name: 'New', Actions: [action('Bank Accounts', 'Bank Accounts')] }],
    },
    {
      Id: 371, Name: 'Bank Account List',
      Controls: [{ Kind: 3, Name: 'Control1', Controls: [field('No.'), field('Name')] }],
      Actions: [action('CreateNewLinkedBankAccount', 'Create New Linked Bank Account')],
    },
  ],
  Namespaces: [{
    Pages: [{
      Id: 370, Name: 'Bank Account Card',
      Controls: [
        { Name: 'content', Controls: [
          group('General', undefined, [field('No.'), field('Name')]),
          group('Transfer', 'Transfer', [field('SWIFT Code'), field('IBAN')]),
        ] },
      ],
      Actions: [],
    }],
  }],
};
const bankingApp = {
  PageExtensions: [{
    TargetObject: '#437dbf0e84ff417a965ded2bb9650972#Bank Account Card',
    ControlChanges: [{ Anchor: 'Blocked', ChangeKind: 4, Controls: [field('CTS-CB Bank Code', 'Bank Code')] }],
    ActionChanges: [{ Anchor: 'Statistics', ChangeKind: 4, Actions: [action('CTSCBSetDefaultCommunication', 'Set Default Communication')] }],
  }],
};

describe('buildIndex', () => {
  const index = buildIndex([baseApp, bankingApp]);

  test('indexes pages in nested namespaces with fields, actions, repeaters and FastTabs', () => {
    const card = index.pages.get('bank account card')!;
    expect(card.id).toBe(370);
    expect(card.fields.get('IBAN')).toEqual({ caption: undefined, group: 'Transfer' });
    expect(card.fields.get('No.')?.group).toBe('General');
    expect(index.pages.get('bank account list')!.repeaters.has('Control1')).toBe(true);
    expect(index.pages.get('business manager role center')!.actions.get('Bank Accounts')).toEqual({ caption: 'Bank Accounts' });
  });

  test('merges page extensions (fields and actions added by Continia)', () => {
    const card = index.pages.get('bank account card')!;
    expect(card.fields.get('CTS-CB Bank Code')?.caption).toBe('Bank Code');
    expect(card.actions.get('CTSCBSetDefaultCommunication')?.caption).toBe('Set Default Communication');
  });
});

const rec = (steps: Recording['steps']): Recording => ({ description: 'd', steps });

describe('lintRecordingNames', () => {
  const index = buildIndex([baseApp, bankingApp]);

  test('accepts real names, built-in actions and modal dialogs', () => {
    expect(lintRecordingNames(rec([
      { type: 'navigate', target: [{ page: 'Business Manager Role Center' }, { action: 'Bank Accounts' }] },
      { type: 'invoke', target: [{ page: 'Bank Account List' }, { action: 'Control_New' }], invokeType: 'New' },
      { type: 'invoke', target: [{ page: 'Bank Account List' }, { repeater: 'Control1' }], invokeType: 'Edit' },
      { type: 'input', target: [{ page: 'Bank Account Card' }, { field: 'IBAN' }], value: 'x' },
      { type: 'page-shown', source: { page: 'Some System Dialog' }, modal: true, runtimeId: 'd1' },
    ]), index)).toEqual([]);
  });

  test('names the step, the wrong name and the closest real one', () => {
    const problems = lintRecordingNames(rec([
      { type: 'navigate', target: [{ page: 'Business Manager Role Center' }, { action: 'BankAccounts' }] },
      { type: 'input', target: [{ page: 'Bank Account Card' }, { field: 'Bank Code' }], value: 'x' },
      { type: 'invoke', target: [{ page: 'Bank Account Crd' }, { action: 'X' }] },
    ]), index);
    expect(problems).toEqual([
      `step 0: action "BankAccounts" is not on page "Business Manager Role Center" (did you mean "Bank Accounts"?)`,
      `step 1: field "Bank Code" is not on page "Bank Account Card" (did you mean "CTS-CB Bank Code"?)`,
      `step 2: page "Bank Account Crd" not found in the symbols (did you mean "Bank Account Card"?)`,
    ]);
  });

  test('filter-scope fields are not checked against page controls', () => {
    expect(lintRecordingNames(rec([
      { type: 'input', target: [{ page: 'Bank Account List' }, { scope: 'filter', field: 'Currency Code' }], value: 'EUR' },
    ]), index)).toEqual([]);
  });
});

describe('fieldGroupsFor', () => {
  test('derives FastTab hints for every field the recording touches', () => {
    const index = buildIndex([baseApp]);
    expect(fieldGroupsFor(rec([
      { type: 'input', target: [{ page: 'Bank Account Card' }, { field: 'IBAN' }], value: 'x' },
      { type: 'focus', target: [{ page: 'Bank Account Card' }, { field: 'No.' }] },
    ]), index)).toEqual({ fieldGroups: { IBAN: 'Transfer', 'No.': 'General' } });
  });
});

describe('describePage', () => {
  test('lists real names with captions for the agent', () => {
    const text = describePage(buildIndex([baseApp, bankingApp]), 'Bank Account Card');
    expect(text).toContain('Bank Account Card (page 370)');
    expect(text).toContain('field IBAN  [FastTab: Transfer]');
    expect(text).toContain('action CTSCBSetDefaultCommunication  "Set Default Communication"');
  });

  test('suggests near names for an unknown page', () => {
    expect(describePage(buildIndex([baseApp]), 'Bank Acount Card')).toContain('did you mean "Bank Account Card"?');
  });
});

describe('reading .app packages', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sym-'));
    // A .app is a NAVX header followed by a zip; the symbols are SymbolReference.json (with BOM).
    const zip = zipSync({ 'SymbolReference.json': strToU8('﻿' + JSON.stringify(baseApp)) });
    const header = new Uint8Array(40).fill(7);
    const app = new Uint8Array(header.length + zip.length);
    app.set(header);
    app.set(zip, header.length);
    writeFileSync(join(dir, 'Microsoft_Base Application_29.0.0.0.app'), app);
    writeFileSync(join(dir, 'not-an-app.txt'), 'x');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('readSymbolReference skips the header and the BOM', () => {
    const app = new Uint8Array(require('fs').readFileSync(join(dir, 'Microsoft_Base Application_29.0.0.0.app')));
    expect((readSymbolReference(app) as { Pages: unknown[] }).Pages).toHaveLength(2);
  });

  test('loadSymbolIndex reads every .app in the given folders', () => {
    expect(loadSymbolIndex([dir]).pages.has('bank account card')).toBe(true);
  });
});
