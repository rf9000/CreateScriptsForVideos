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

// Shape of Continia Banking's Bank Account Setup wizard: a NavigatePage whose step shows a list part.
const wizardApp = {
  Pages: [
    {
      Id: 71553588, Name: 'CTS-CB MultiBankAccAssistSetup',
      Controls: [{ Name: 'Content', Controls: [
        group('Step2', undefined, [{ Kind: 6, Name: 'SetupBankAccountList', RelatedPagePartId: { Name: '', Id: 71553589 } }]),
      ] }],
      Actions: [action('ActionNext', 'Next')],
    },
    {
      Id: 71553589, Name: 'CTS-CB SetupMultiBankAccList',
      Controls: [{ Kind: 3, Name: 'BankAccountList', Controls: [field('CommunicationType', 'Communication Type')] }],
      Actions: [],
    },
  ],
};

describe('page parts', () => {
  const index = buildIndex([wizardApp]);

  test('indexes part controls with the page they show', () => {
    expect(index.pages.get('cts-cb multibankaccassistsetup')!.parts.get('SetupBankAccountList')).toBe(71553589);
  });

  test('a page-shown for a part of a page in the recording is rejected with the target to use', () => {
    const problems = lintRecordingNames(rec([
      { type: 'invoke', target: [{ page: 'CTS-CB MultiBankAccAssistSetup' }, { action: 'ActionNext' }] },
      { type: 'page-shown', source: { page: 'CTS-CB SetupMultiBankAccList' }, runtimeId: 'p2' },
    ]), index);
    expect(problems).toEqual([
      'step 1: "CTS-CB SetupMultiBankAccList" is not a page that opens; it is part "SetupBankAccountList" of "CTS-CB MultiBankAccAssistSetup". ' +
        'Drop this page-shown and target it as [{page: "CTS-CB MultiBankAccAssistSetup"}, {part: "SetupBankAccountList"}, ...]',
    ]);
  });

  test('targets through a part are checked against the part\'s page', () => {
    expect(lintRecordingNames(rec([
      { type: 'input', target: [{ page: 'CTS-CB MultiBankAccAssistSetup' }, { part: 'SetupBankAccountList' }, { repeater: 'BankAccountList' }, { field: 'CommunicationType' }], value: 'Direct' },
    ]), index)).toEqual([]);
    expect(lintRecordingNames(rec([
      { type: 'input', target: [{ page: 'CTS-CB MultiBankAccAssistSetup' }, { part: 'SetupBankAccountList' }, { field: 'CommType' }], value: 'Direct' },
    ]), index)).toEqual(['step 0: field "CommType" is not on page "CTS-CB SetupMultiBankAccList"']);
    expect(lintRecordingNames(rec([
      { type: 'input', target: [{ page: 'CTS-CB MultiBankAccAssistSetup' }, { part: 'BankList' }, { field: 'CommunicationType' }], value: 'Direct' },
    ]), index)).toEqual(['step 0: part "BankList" is not on page "CTS-CB MultiBankAccAssistSetup"']);
  });

  test('describePage lists parts and how to target them', () => {
    expect(describePage(index, 'CTS-CB MultiBankAccAssistSetup')).toContain(
      'part SetupBankAccountList  -> CTS-CB SetupMultiBankAccList (target it as {part: SetupBankAccountList}, not as a page)');
  });
});
