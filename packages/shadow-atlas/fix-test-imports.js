#!/usr/bin/env node
/**
 * Fix test imports after reorganizing test files
 *
 * Maps relative imports to absolute paths based on directory structure
 */

import { readFile, writeFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Map of test directory to source directory
const directoryMap = {
  'acquisition': '../../../acquisition',
  'agents': '../../../agents',
  'core': '../../../core',
  'integration': '../../../integration',
  'persistence': '../../../persistence',
  'provenance': '../../../provenance',
  'providers': '../../../providers',
  'providers/international': '../../../../providers/international',
  'resilience': '../../../resilience',
  'resilience/chaos': '../../../../resilience/chaos',
  'root': '../../..',
  'scanners': '../../../scanners',
  'sdk': '../../../sdk',
  'services': '../../../services',
  'serving': '../../../serving',
  'utils': '../../../utils',
  'validators': '../../../validators',
};

async function getAllTestFiles(dir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function fixImportsInFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // Determine the test directory relative to __tests__/unit
  const relPath = relative(join(__dirname, 'src/__tests__/unit'), dirname(filePath));
  const sourcePrefix = directoryMap[relPath];

  if (!sourcePrefix) {
    console.warn(`Unknown directory mapping for: ${relPath}`);
    return;
  }

  let modified = false;
  const newLines = lines.map(line => {
    // Match import/export lines with relative paths starting with './'
    // This handles both: import x from './file' and } from './file'
    const importMatch = line.match(/^(.+from\s+['"])(\.\/.+?)(['"];?)$/);
    if (importMatch) {
      const [, prefix, importPath, end] = importMatch;

      // Don't modify if it already starts with ../ (cross-directory import)
      if (!importPath.startsWith('./')) {
        return line;
      }

      // Replace ./ with the appropriate relative path
      const newPath = importPath.replace('./', sourcePrefix + '/');
      modified = true;
      return `${prefix}${newPath}${end}`;
    }

    return line;
  });

  if (modified) {
    await writeFile(filePath, newLines.join('\n'), 'utf-8');
    console.log(`✓ Fixed imports in: ${relative(__dirname, filePath)}`);
  }
}

async function main() {
  const testsDir = join(__dirname, 'src/__tests__/unit');
  const testFiles = await getAllTestFiles(testsDir);

  console.log(`Found ${testFiles.length} test files to process...\n`);

  for (const file of testFiles) {
    try {
      await fixImportsInFile(file);
    } catch (error) {
      console.error(`✗ Error processing ${file}:`, error.message);
    }
  }

  console.log('\n✓ Import path fixing complete!');
}

main().catch(console.error);
