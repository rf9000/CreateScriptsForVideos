import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { enforcePteIdentity, INTERNAL_ACCESS_IDENTITY } from '../../src/services/pte-identity.ts';

const APP = join('/pte', 'app.json');

function fakeIo(app: object, bom = false) {
  const files = new Map<string, string>([[APP, `${bom ? '﻿' : ''}${JSON.stringify(app)}`]]);
  return {
    files,
    io: { read: (p: string) => files.get(p)!, write: (p: string, t: string) => void files.set(p, t) },
  };
}

const banking = { id: '83461f48-dd16-49ea-b00c-e656830c640f', name: 'Continia Banking', publisher: 'Continia Software', version: '29.0.0.0' };

describe('enforcePteIdentity', () => {
  test('takes the Internal Access identity and drops the dependency on it, keeping the rest', () => {
    const { files, io } = fakeIo({
      id: '11111111-2222-3333-4444-555555555555', name: 'Continia Demo Data - Merge Rules', publisher: 'Continia Software',
      version: '1.0.0.0', idRanges: [{ from: 50000, to: 50099 }],
      dependencies: [banking, { id: '6E549E35-D1B2-4878-A37A-A736C22F35BF', name: 'Continia Banking Internal Access' }],
    }, true);
    const changes = enforcePteIdentity('/pte', io);
    expect(changes).toHaveLength(4);
    const app = JSON.parse(files.get(APP)!);
    expect({ id: app.id, name: app.name, publisher: app.publisher }).toEqual({ ...INTERNAL_ACCESS_IDENTITY });
    expect(app.dependencies).toEqual([banking]);
    expect(app.idRanges).toEqual([{ from: 50000, to: 50099 }]);
  });

  test('leaves a correct app.json untouched', () => {
    const original = { ...INTERNAL_ACCESS_IDENTITY, version: '1.0.0.0', dependencies: [banking] };
    const { files, io } = fakeIo(original);
    expect(enforcePteIdentity('/pte', io)).toEqual([]);
    expect(files.get(APP)).toBe(JSON.stringify(original));
  });

  test('throws on an app.json that is not JSON', () => {
    const io = { read: () => '{ nope', write: () => {} };
    expect(() => enforcePteIdentity('/pte', io)).toThrow();
  });
});
