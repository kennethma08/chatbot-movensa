import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const widgetSource = resolve(projectRoot, 'apps/widget/dist/movensa-widget.js');
const widgetDirectory = resolve(projectRoot, 'apps/web/dist/widget');

await mkdir(widgetDirectory, { recursive: true });
await copyFile(widgetSource, resolve(widgetDirectory, 'movensa-widget.js'));

