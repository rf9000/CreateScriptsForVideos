import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import {
  ACTIVATION_APP_DEPENDENCY, ACTIVATION_CALL, ACTIVATION_FILE, ACTIVATION_SOURCE,
  enforcePteActivation, withActivationCall,
} from '../../src/services/pte-activation.ts';

const INSTALL = `codeunit 50000 "Install Demo Data"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        BankAccount: Record "Bank Account";
    begin
        CreateDemoData();
        VerifyDemoData();
    end;
}
`;

function fakePte(files: Record<string, string>) {
  const store = new Map(Object.entries(files).map(([k, v]) => [join('/pte', k), v]));
  return {
    store,
    io: {
      list: () => [...store.keys()].map((p) => p.slice(join('/pte', '').length + 1)),
      read: (p: string) => {
        const v = store.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      },
      write: (p: string, t: string) => void store.set(p, t),
    },
  };
}

const banking = { id: '83461f48-dd16-49ea-b00c-e656830c640f', name: 'Continia Banking', publisher: 'Continia Software', version: '29.0.0.0' };

describe('withActivationCall', () => {
  test('puts the call first in OnInstallAppPerCompany, after its var section', () => {
    const out = withActivationCall(INSTALL)!;
    expect(out).toContain(`    begin\n        ${ACTIVATION_CALL}\n        CreateDemoData();`);
  });
  test('is idempotent', () => {
    const once = withActivationCall(INSTALL)!;
    expect(withActivationCall(once)).toBe(once);
  });
  test('no install trigger: undefined', () => {
    expect(withActivationCall('codeunit 50001 X { }')).toBeUndefined();
  });
});

describe('enforcePteActivation', () => {
  test('writes the codeunit, adds the dependency and the call, keeping the rest', () => {
    const { store, io } = fakePte({ 'app.json': JSON.stringify({ dependencies: [banking] }), 'InstallDemoData.Codeunit.al': INSTALL });
    expect(enforcePteActivation('/pte', io)).toHaveLength(3);
    expect(store.get(join('/pte', ACTIVATION_FILE))).toBe(ACTIVATION_SOURCE);
    expect(JSON.parse(store.get(join('/pte', 'app.json'))!).dependencies).toEqual([banking, { ...ACTIVATION_APP_DEPENDENCY }]);
    expect(store.get(join('/pte', 'InstallDemoData.Codeunit.al'))).toContain(ACTIVATION_CALL);
  });

  test('a second run changes nothing', () => {
    const { io } = fakePte({ 'app.json': JSON.stringify({ dependencies: [banking] }), 'InstallDemoData.Codeunit.al': INSTALL });
    enforcePteActivation('/pte', io);
    expect(enforcePteActivation('/pte', io)).toEqual([]);
  });

  test('an agent-edited activation file is rewritten', () => {
    const { store, io } = fakePte({
      'app.json': JSON.stringify({ dependencies: [banking, { ...ACTIVATION_APP_DEPENDENCY }] }),
      'InstallDemoData.Codeunit.al': withActivationCall(INSTALL)!,
      [ACTIVATION_FILE]: 'codeunit 50099 "Demo Activate Continia" { }',
    });
    expect(enforcePteActivation('/pte', io)).toEqual([`wrote ${ACTIVATION_FILE}`]);
    expect(store.get(join('/pte', ACTIVATION_FILE))).toBe(ACTIVATION_SOURCE);
  });

  test('no install codeunit: throws', () => {
    const { io } = fakePte({ 'app.json': '{}', 'Other.Codeunit.al': 'codeunit 50001 X { }' });
    expect(() => enforcePteActivation('/pte', io)).toThrow('no install codeunit');
  });
});
