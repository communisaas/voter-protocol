#!/usr/bin/env node
/**
 * Replace console.log/warn/error/debug with structured logger
 *
 * Usage: node scripts/replace-console-with-logger.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = dirname(__dirname);

// Files to process (src/ only, exclude tests and node_modules)
const INCLUDE_PATTERNS = [
  'src/**/*.ts',
  'src/**/*.tsx',
];

const EXCLUDE_PATTERNS = [
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/node_modules/**',
  '**/dist/**',
  '**/*.md',
];

/**
 * Calculate relative import path for logger
 */
function getLoggerImportPath(filePath) {
  const rel = relative(dirname(filePath), `${PROJECT_ROOT}/src/core/utils/logger.ts`);
  // Remove .ts extension and ensure .js extension for ESM
  return rel.replace(/\.ts$/, '.js');
}

/**
 * Check if file already imports logger
 */
function hasLoggerImport(content) {
  return /import.*logger.*from.*logger/.test(content);
}

/**
 * Add logger import to file
 */
function addLoggerImport(content, importPath) {
  // Find last import statement
  const lines = content.split('\n');
  let lastImportIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^import /)) {
      lastImportIndex = i;
    }
  }

  const loggerImport = `import { logger } from '${importPath}';`;

  if (lastImportIndex === -1) {
    // No imports found, add at top after comments/directives
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
        insertIndex = i;
        break;
      }
    }
    lines.splice(insertIndex, 0, loggerImport, '');
  } else {
    // Add after last import
    lines.splice(lastImportIndex + 1, 0, loggerImport);
  }

  return lines.join('\n');
}

/**
 * Replace console.log with logger.info
 */
function replaceConsoleLog(content) {
  // Pattern: console.log('message', ...args)
  // Replace with: logger.info('message', { ...args })

  // Simple string messages
  content = content.replace(
    /console\.log\((["'`][^"'`]*["'`])\)/g,
    'logger.info($1)'
  );

  // Template literals
  content = content.replace(
    /console\.log\(([`][^`]*[`])\)/g,
    'logger.info($1)'
  );

  // With additional arguments - more complex
  content = content.replace(
    /console\.log\((["'`][^"'`]*["'`]),\s*([^)]+)\)/g,
    (match, message, args) => {
      // Try to convert to metadata object
      if (args.includes('{') || args.includes('[')) {
        // Already an object or array, use as-is
        return `logger.info(${message}, ${args})`;
      }
      // Simple variable, wrap in object
      return `logger.info(${message}, { value: ${args} })`;
    }
  );

  return content;
}

/**
 * Replace console.warn with logger.warn
 */
function replaceConsoleWarn(content) {
  content = content.replace(
    /console\.warn\((["'`][^"'`]*["'`])\)/g,
    'logger.warn($1)'
  );

  content = content.replace(
    /console\.warn\(([`][^`]*[`])\)/g,
    'logger.warn($1)'
  );

  content = content.replace(
    /console\.warn\((["'`][^"'`]*["'`]),\s*([^)]+)\)/g,
    (match, message, args) => {
      if (args.includes('{') || args.includes('[')) {
        return `logger.warn(${message}, ${args})`;
      }
      return `logger.warn(${message}, { value: ${args} })`;
    }
  );

  return content;
}

/**
 * Replace console.error with logger.error
 */
function replaceConsoleError(content) {
  content = content.replace(
    /console\.error\((["'`][^"'`]*["'`])\)/g,
    'logger.error($1)'
  );

  content = content.replace(
    /console\.error\(([`][^`]*[`])\)/g,
    'logger.error($1)'
  );

  content = content.replace(
    /console\.error\((["'`][^"'`]*["'`]),\s*([^)]+)\)/g,
    (match, message, args) => {
      if (args.includes('{') || args.includes('[')) {
        return `logger.error(${message}, ${args})`;
      }
      return `logger.error(${message}, { error: ${args} })`;
    }
  );

  return content;
}

/**
 * Replace console.debug with logger.debug
 */
function replaceConsoleDebug(content) {
  content = content.replace(
    /console\.debug\((["'`][^"'`]*["'`])\)/g,
    'logger.debug($1)'
  );

  content = content.replace(
    /console\.debug\(([`][^`]*[`])\)/g,
    'logger.debug($1)'
  );

  content = content.replace(
    /console\.debug\((["'`][^"'`]*["'`]),\s*([^)]+)\)/g,
    (match, message, args) => {
      if (args.includes('{') || args.includes('[')) {
        return `logger.debug(${message}, ${args})`;
      }
      return `logger.debug(${message}, { value: ${args} })`;
    }
  );

  return content;
}

/**
 * Replace console.time/timeEnd with manual timing
 */
function replaceConsoleTime(content) {
  // console.time('label') -> const start = Date.now()
  // console.timeEnd('label') -> logger.debug('label completed', { duration: Date.now() - start })

  // This is complex - skip for now, manual review needed
  return content;
}

/**
 * Process a single file
 */
function processFile(filePath) {
  const originalContent = readFileSync(filePath, 'utf-8');
  let content = originalContent;

  // Check if file has console statements
  if (!/console\.(log|warn|error|debug)/.test(content)) {
    return { processed: false, replacements: 0 };
  }

  // Count replacements
  const consoleCalls = (content.match(/console\.(log|warn|error|debug)/g) || []).length;

  // Replace console calls
  content = replaceConsoleLog(content);
  content = replaceConsoleWarn(content);
  content = replaceConsoleError(content);
  content = replaceConsoleDebug(content);

  // Add logger import if needed
  if (content !== originalContent && !hasLoggerImport(content)) {
    const importPath = getLoggerImportPath(filePath);
    content = addLoggerImport(content, importPath);
  }

  // Only write if changed
  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf-8');
    return { processed: true, replacements: consoleCalls };
  }

  return { processed: false, replacements: 0 };
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Finding TypeScript files in src/...');

  const files = await glob(INCLUDE_PATTERNS, {
    ignore: EXCLUDE_PATTERNS,
    cwd: PROJECT_ROOT,
    absolute: true,
  });

  console.log(`📝 Found ${files.length} files to process\n`);

  let processedCount = 0;
  let totalReplacements = 0;
  const processedFiles = [];

  for (const file of files) {
    const result = processFile(file);
    if (result.processed) {
      processedCount++;
      totalReplacements += result.replacements;
      processedFiles.push(relative(PROJECT_ROOT, file));
    }
  }

  console.log(`\n✅ Processing complete:`);
  console.log(`   - Files processed: ${processedCount}`);
  console.log(`   - Console calls replaced: ${totalReplacements}`);

  if (processedFiles.length > 0 && processedFiles.length <= 20) {
    console.log(`\n📄 Modified files:`);
    processedFiles.forEach(f => console.log(`   - ${f}`));
  }

  console.log(`\n⚠️  Manual review recommended for:`);
  console.log(`   - console.time/timeEnd calls (complex replacement)`);
  console.log(`   - console.log with complex expressions`);
  console.log(`   - Test files (excluded from this script)`);
}

main().catch(console.error);
