import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Continia Banking is activated per company. The Continia Core Internal Activation
 * App installs nothing active by itself; Banking's own tests activate through its
 * "CSC Library - Activation Mgt.", which reads Continia's test PartnerZone login
 * from that app's Key Vault. The PTE does the same, first thing on install, so the
 * demo company is active before the demo data is seeded and before the video
 * opens a Banking page. Written by the pipeline, never by the agent.
 */

export const ACTIVATION_APP_DEPENDENCY = {
  id: 'c3755ece-dab0-4d16-987d-040661f18522',
  name: 'Continia Core Internal Activation App',
  publisher: 'Continia Software',
  version: '1.0.0.0',
} as const;

export const ACTIVATION_FILE = 'ActivateContinia.Codeunit.al';
const ACTIVATION_CODEUNIT = 'Demo Activate Continia';
export const ACTIVATION_CALL = `Codeunit.Run(Codeunit::"${ACTIVATION_CODEUNIT}");`;

export const ACTIVATION_SOURCE = `// Written by the pipeline: activates Continia Banking in this company the way Banking's own
// tests do, through the Continia Core Internal Activation App. Don't edit; it is rewritten.
codeunit 50099 "${ACTIVATION_CODEUNIT}"
{
    trigger OnRun()
    var
        CoreMgt: Codeunit "CTS-CB Core Mgt.";
        ActivationMgt: Codeunit "CSC Library - Activation Mgt.";
    begin
        if not CoreMgt.IsAppActive(false, false) then
            ActivationMgt.ActivateCompany(CoreMgt.ProductCode(), true);
    end;
}
`;

export interface PteIo {
  list: (dir: string) => string[];
  read: (path: string) => string;
  write: (path: string, text: string) => void;
}

const fsIo: PteIo = {
  list: (dir) => readdirSync(dir),
  read: (path) => readFileSync(path, 'utf-8'),
  write: (path, text) => writeFileSync(path, text),
};

const INSTALL_TRIGGER = /trigger\s+OnInstallAppPerCompany\s*\(\s*\)[\s\S]*?\n([ \t]*)begin[ \t]*\r?\n/i;

/** Put the activation call first in the install codeunit's OnInstallAppPerCompany. */
export function withActivationCall(source: string): string | undefined {
  if (source.includes(ACTIVATION_CALL)) return source;
  const match = INSTALL_TRIGGER.exec(source);
  if (!match) return undefined;
  const at = match.index + match[0].length;
  return `${source.slice(0, at)}${match[1]}    ${ACTIVATION_CALL}\n${source.slice(at)}`;
}

/**
 * Make the PTE activate Banking on install: write the activation codeunit, depend on
 * the activation app, and run it first in the install trigger. Returns what changed.
 * Throws when the PTE has no install codeunit with OnInstallAppPerCompany.
 */
export function enforcePteActivation(ptePath: string, io: PteIo = fsIo): string[] {
  const changes: string[] = [];

  const filePath = join(ptePath, ACTIVATION_FILE);
  let current: string | undefined;
  try {
    current = io.read(filePath);
  } catch {
    current = undefined;
  }
  if (current !== ACTIVATION_SOURCE) {
    io.write(filePath, ACTIVATION_SOURCE);
    changes.push(`wrote ${ACTIVATION_FILE}`);
  }

  const appPath = join(ptePath, 'app.json');
  const app = JSON.parse(io.read(appPath).replace(/^﻿/, '')) as { dependencies?: Array<{ id?: unknown }> };
  const deps = app.dependencies ?? [];
  if (!deps.some((d) => String(d.id).toLowerCase() === ACTIVATION_APP_DEPENDENCY.id)) {
    app.dependencies = [...deps, { ...ACTIVATION_APP_DEPENDENCY }];
    io.write(appPath, `${JSON.stringify(app, null, 2)}\n`);
    changes.push('added the Continia Core Internal Activation App dependency');
  }

  const install = io.list(ptePath)
    .filter((f) => f.toLowerCase().endsWith('.al') && f !== ACTIVATION_FILE)
    .map((f) => ({ path: join(ptePath, f), source: io.read(join(ptePath, f)) }))
    .find((f) => /Subtype\s*=\s*Install/i.test(f.source) && INSTALL_TRIGGER.test(f.source));
  if (!install) throw new Error('no install codeunit with OnInstallAppPerCompany in the PTE');
  const updated = withActivationCall(install.source)!;
  if (updated !== install.source) {
    io.write(install.path, updated);
    changes.push('the install trigger now activates Banking first');
  }
  return changes;
}
