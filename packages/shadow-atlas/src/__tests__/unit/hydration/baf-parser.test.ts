import { describe, it, expect } from 'vitest';
import { extractEntityType, parseBAFFilesAsync } from '../../../hydration/baf-parser.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// extractEntityType
// ============================================================================

describe('extractEntityType', () => {
  it('should extract CD entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_CD.txt')).toBe('CD');
  });

  it('should extract INCPLACE_CDP entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_INCPLACE_CDP.txt')).toBe('INCPLACE_CDP');
  });

  it('should extract SLDU entity type', () => {
    expect(extractEntityType('BlockAssign_ST36_NY_SLDU.txt')).toBe('SLDU');
  });

  it('should extract SLDL entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_SLDL.txt')).toBe('SLDL');
  });

  it('should extract VTD entity type', () => {
    expect(extractEntityType('BlockAssign_ST11_DC_VTD.txt')).toBe('VTD');
  });

  it('should extract MCD entity type', () => {
    expect(extractEntityType('BlockAssign_ST25_MA_MCD.txt')).toBe('MCD');
  });

  it('should extract SDUNI entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_SDUNI.txt')).toBe('SDUNI');
  });

  it('should extract SDELM entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_SDELM.txt')).toBe('SDELM');
  });

  it('should extract SDSEC entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_SDSEC.txt')).toBe('SDSEC');
  });

  it('should extract AIANNH entity type', () => {
    expect(extractEntityType('BlockAssign_ST06_CA_AIANNH.txt')).toBe('AIANNH');
  });

  it('should return null for non-BAF filenames', () => {
    expect(extractEntityType('random-file.txt')).toBeNull();
  });
});

// ============================================================================
// parseBAFFilesAsync
// ============================================================================

describe('parseBAFFilesAsync', () => {
  let testDir: string;

  async function setupTestDir(): Promise<string> {
    const dir = join(tmpdir(), `baf-parser-test-${Date.now().toString(36)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it('should parse CD file correctly', async () => {
    testDir = await setupTestDir();

    // Create a mock CD file
    const cdContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|14',
      '060750001011001|14',
      '060750001012000|13',
    ].join('\n');

    const cdPath = join(testDir, 'BlockAssign_ST06_CA_CD.txt');
    await writeFile(cdPath, cdContent);

    const blocks = await parseBAFFilesAsync([cdPath]);

    expect(blocks.size).toBe(3);

    const block1 = blocks.get('060750001011000');
    expect(block1).toBeDefined();
    expect(block1!.stateFips).toBe('06');
    expect(block1!.countyFips).toBe('06075');
    expect(block1!.tractGeoid).toBe('06075000101');
    // Slot 0 (CD): state FIPS + district = "0614"
    expect(block1!.districts.get(0)).toBe('0614');
    // Slot 1 (Federal Senate) = state FIPS
    expect(block1!.districts.get(1)).toBe('06');
    // Slot 4 (County) = state+county
    expect(block1!.districts.get(4)).toBe('06075');

    await rm(testDir, { recursive: true });
  });

  it('should parse SLDU file correctly', async () => {
    testDir = await setupTestDir();

    const slduContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|009',
      '060750001012000|009',
    ].join('\n');

    const slduPath = join(testDir, 'BlockAssign_ST06_CA_SLDU.txt');
    await writeFile(slduPath, slduContent);

    const blocks = await parseBAFFilesAsync([slduPath]);
    const block = blocks.get('060750001011000');
    expect(block).toBeDefined();
    // Slot 2 (State Senate): state + district = "06009"
    expect(block!.districts.get(2)).toBe('06009');

    await rm(testDir, { recursive: true });
  });

  it('should parse INCPLACE_CDP file correctly', async () => {
    testDir = await setupTestDir();

    const placeContent = [
      'BLOCKID|PLACEFP',
      '110010001011000|50000',
      '110010001011001|50000',
    ].join('\n');

    const placePath = join(testDir, 'BlockAssign_ST11_DC_INCPLACE_CDP.txt');
    await writeFile(placePath, placeContent);

    const blocks = await parseBAFFilesAsync([placePath]);
    const block = blocks.get('110010001011000');
    expect(block).toBeDefined();
    // Slot 5 (Place): state + PLACEFP = "1150000"
    expect(block!.districts.get(5)).toBe('1150000');

    await rm(testDir, { recursive: true });
  });

  it('should parse VTD file with 3-column format', async () => {
    testDir = await setupTestDir();

    const vtdContent = [
      'BLOCKID|COUNTYFP|DISTRICT',
      '110010001011000|001|02-005',
      '110010001011001|001|02-005',
    ].join('\n');

    const vtdPath = join(testDir, 'BlockAssign_ST11_DC_VTD.txt');
    await writeFile(vtdPath, vtdContent);

    const blocks = await parseBAFFilesAsync([vtdPath]);
    const block = blocks.get('110010001011000');
    expect(block).toBeDefined();
    // Slot 21 (VTD): county(5) + VTD code = "1100102-005"
    expect(block!.districts.get(21)).toBe('1100102-005');

    await rm(testDir, { recursive: true });
  });

  it('should parse MCD file with COUSUBFP column', async () => {
    testDir = await setupTestDir();

    const mcdContent = [
      'BLOCKID|COUNTYFP|COUSUBFP',
      '250010101001000|001|55500',
    ].join('\n');

    const mcdPath = join(testDir, 'BlockAssign_ST25_MA_MCD.txt');
    await writeFile(mcdPath, mcdContent);

    const blocks = await parseBAFFilesAsync([mcdPath]);
    const block = blocks.get('250010101001000');
    expect(block).toBeDefined();
    // Slot 20 (Township): county(5) + COUSUBFP = "2500155500"
    expect(block!.districts.get(20)).toBe('2500155500');

    await rm(testDir, { recursive: true });
  });

  it('should skip blank district values', async () => {
    testDir = await setupTestDir();

    const sdelmContent = [
      'BLOCKID|DISTRICT',
      '060014001001000|',       // blank
      '060014001001001|28050',  // valid
    ].join('\n');

    const path = join(testDir, 'BlockAssign_ST06_CA_SDELM.txt');
    await writeFile(path, sdelmContent);

    const blocks = await parseBAFFilesAsync([path]);
    // First block not created (no valid assignments)
    expect(blocks.has('060014001001000')).toBe(false);
    // Second block has SDELM
    const block = blocks.get('060014001001001');
    expect(block).toBeDefined();
    expect(block!.districts.get(8)).toBe('0628050');

    await rm(testDir, { recursive: true });
  });

  it('should skip ZZZ-style unassigned codes', async () => {
    testDir = await setupTestDir();

    const cdContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|ZZ',
      '060750001012000|13',
    ].join('\n');

    const cdPath = join(testDir, 'BlockAssign_ST06_CA_CD.txt');
    await writeFile(cdPath, cdContent);

    const blocks = await parseBAFFilesAsync([cdPath]);
    // First block should not have CD assignment (ZZ skipped)
    // But it might have derived slots (1 = senate, 4 = county)
    const block1 = blocks.get('060750001011000');
    // Block not created since ZZ skipped and no valid entity
    expect(block1).toBeUndefined();

    await rm(testDir, { recursive: true });
  });

  it('should merge districts from multiple entity files', async () => {
    testDir = await setupTestDir();

    const cdContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|14',
    ].join('\n');

    const slduContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|009',
    ].join('\n');

    const sldlContent = [
      'BLOCKID|DISTRICT',
      '060750001011000|015',
    ].join('\n');

    const cdPath = join(testDir, 'BlockAssign_ST06_CA_CD.txt');
    const slduPath = join(testDir, 'BlockAssign_ST06_CA_SLDU.txt');
    const sldlPath = join(testDir, 'BlockAssign_ST06_CA_SLDL.txt');

    await writeFile(cdPath, cdContent);
    await writeFile(slduPath, slduContent);
    await writeFile(sldlPath, sldlContent);

    const blocks = await parseBAFFilesAsync([cdPath, slduPath, sldlPath]);
    const block = blocks.get('060750001011000');

    expect(block).toBeDefined();
    expect(block!.districts.get(0)).toBe('0614');   // CD
    expect(block!.districts.get(1)).toBe('06');      // Federal Senate (derived)
    expect(block!.districts.get(2)).toBe('06009');   // State Senate
    expect(block!.districts.get(3)).toBe('06015');   // State House
    expect(block!.districts.get(4)).toBe('06075');   // County (derived)

    await rm(testDir, { recursive: true });
  });

  it('should skip AIANNH files (unmapped entity type)', async () => {
    testDir = await setupTestDir();

    const aiannhContent = [
      'BLOCKID|AIANNHCE|COMPTYP',
      '060014001001000||',
    ].join('\n');

    const path = join(testDir, 'BlockAssign_ST06_CA_AIANNH.txt');
    await writeFile(path, aiannhContent);

    const blocks = await parseBAFFilesAsync([path]);
    expect(blocks.size).toBe(0);

    await rm(testDir, { recursive: true });
  });
});
