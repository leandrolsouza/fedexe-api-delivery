import { copyFileSync } from 'node:fs';

const binary = process.platform === 'win32' ? 'fedexe-runner.exe' : 'fedexe-runner';
copyFileSync(`target/release/${binary}`, `dist-cli/${binary}`);
