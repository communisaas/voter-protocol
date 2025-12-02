
const fs = require('fs');
const path = require('path');

const generatedDir = 'vendor/aztec-packages/barretenberg/ts/src/cbind/generated';
const dtsPath = 'node_modules/@aztec/bb.js/dest/node/cbind/generated/api_types.d.ts';

const files = ['async.ts', 'sync.ts', 'native.ts', 'api_types.ts'];

files.forEach(file => {
    const filePath = path.join(generatedDir, file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(filePath, '// @ts-nocheck\n' + content);
        console.log(`Prepended @ts-nocheck to ${file}`);
    }
});

// Append interfaces to api_types.ts
if (fs.existsSync(dtsPath)) {
    const dtsContent = fs.readFileSync(dtsPath, 'utf8');
    // Extract interfaces (simple regex, might need refinement)
    // We want "export interface ... { ... }"
    // But d.ts has "export declare interface" or just "export interface"
    // And "export declare type"

    // Actually, we can just append the whole d.ts content but strip "declare " and "export " to avoid conflicts?
    // No, we need "export".
    // The conflicts arise if we export the same name as a class in JS.
    // JS has classes. d.ts has interfaces and types.
    // If d.ts has "export declare class Foo", and JS has "export class Foo", we should skip the d.ts one.

    // Let's just append everything that is NOT a class.
    // And for classes, we assume JS handles it.

    // Regex to match "export declare class ..."
    // We will filter out lines starting with "export declare class"

    const lines = dtsContent.split('\n');
    const interfaceLines = lines.filter(line => {
        return !line.trim().startsWith('export declare class') && !line.trim().startsWith('import ');
    });

    // Also strip "declare " from "export declare function/interface/type"
    const cleanedLines = interfaceLines.map(line => line.replace('export declare ', 'export '));

    const apiTypesPath = path.join(generatedDir, 'api_types.ts');
    fs.appendFileSync(apiTypesPath, '\n' + cleanedLines.join('\n'));
    console.log('Appended interfaces to api_types.ts');
}
