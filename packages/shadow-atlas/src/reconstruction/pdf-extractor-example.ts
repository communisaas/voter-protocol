/**
 * PDF Extractor Usage Example
 *
 * Demonstrates how to extract legal descriptions from PDF ward maps.
 */

import {
  extractTextFromPDF,
  extractTextFromPDFUrl,
  extractLegalDescriptions,
  extractLegalDescriptionsFromPDF,
  extractLegalDescriptionsFromPDFUrl,
  type PDFExtractionResult,
  type LegalDescriptionsExtraction,
} from './pdf-extractor';

// =============================================================================
// Example 1: Extract text from local PDF file
// =============================================================================

async function example1_extractFromFile(): Promise<void> {
  const filePath = '/path/to/ward-ordinance.pdf';

  // Step 1: Extract text
  const extraction = await extractTextFromPDF(filePath);

  if (!extraction.success) {
    console.error('Failed to extract PDF:', extraction.error);
    return;
  }

  console.log('PDF Metadata:');
  console.log('- Title:', extraction.metadata.title);
  console.log('- Pages:', extraction.metadata.numPages);
  console.log('- Author:', extraction.metadata.author);
  console.log('- Content Hash:', extraction.contentHash);

  // Step 2: Find legal descriptions
  const descriptions = extractLegalDescriptions(extraction);

  console.log('\nLegal Descriptions Found:', descriptions.sections.length);
  console.log('- High Confidence:', descriptions.highConfidenceSections.length);
  console.log('- Medium Confidence:', descriptions.mediumConfidenceSections.length);
  console.log('- Low Confidence:', descriptions.lowConfidenceSections.length);

  // Show high-confidence sections
  for (const section of descriptions.highConfidenceSections) {
    console.log('\n---');
    console.log('Ward/District:', section.wardIdentifier || 'Unknown');
    console.log('Confidence:', section.confidence);
    console.log('Indicators:');
    console.log('  - Beginning phrase:', section.indicators.hasBeginningPhrase);
    console.log('  - Thence phrase:', section.indicators.hasThencePhrase);
    console.log('  - Street names:', section.indicators.hasStreetNames);
    console.log('  - Directional terms:', section.indicators.hasDirectionalTerms);
    console.log('Text preview:', section.text.substring(0, 200) + '...');
  }
}

// =============================================================================
// Example 2: Extract directly from URL (convenience method)
// =============================================================================

async function example2_extractFromUrl(): Promise<void> {
  const url = 'https://city.gov/documents/ward-boundaries.pdf';

  // Single-step extraction
  const result = await extractLegalDescriptionsFromPDFUrl(url);

  if (!result.success) {
    console.error('Failed to extract:', result.sourceExtraction.error);
    return;
  }

  console.log('Extracted from:', url);
  console.log('Found', result.sections.length, 'potential boundary descriptions');

  // Process each section
  for (const section of result.sections) {
    if (section.confidence === 'high') {
      console.log(`\nWard ${section.wardIdentifier}:`);
      console.log('Confidence reasons:', section.confidenceReasons);
      console.log('Estimated page:', section.estimatedPage);
    }
  }
}

// =============================================================================
// Example 3: Filter and process by confidence level
// =============================================================================

async function example3_filterByConfidence(): Promise<void> {
  const filePath = '/path/to/redistricting-plan.pdf';

  const result = await extractLegalDescriptionsFromPDF(filePath);

  if (!result.success) {
    console.error('Extraction failed');
    return;
  }

  // Only process high-confidence sections
  console.log('Processing', result.highConfidenceSections.length, 'high-confidence sections');

  for (const section of result.highConfidenceSections) {
    // Further processing with description-parser.ts
    // This text can be fed into parseLegalDescription()
    console.log(`Ward ${section.wardIdentifier}:`, section.text.length, 'characters');

    // Check specific indicators
    if (section.indicators.hasIntersections && section.indicators.hasMeasurements) {
      console.log('  → Contains precise intersection + measurement data');
    } else if (section.indicators.hasStreetNames) {
      console.log('  → Street-based description (suitable for street-snap)');
    }
  }

  // Review medium-confidence sections manually
  if (result.mediumConfidenceSections.length > 0) {
    console.log('\nMedium-confidence sections (manual review recommended):');
    for (const section of result.mediumConfidenceSections) {
      console.log(`- Ward ${section.wardIdentifier}: ${section.confidenceReasons.join(', ')}`);
    }
  }
}

// =============================================================================
// Example 4: Integration with reconstruction pipeline
// =============================================================================

async function example4_pipelineIntegration(): Promise<void> {
  // Extract legal descriptions from city ordinance PDF
  const pdfUrl = 'https://city.gov/ward-ordinance.pdf';
  const extraction = await extractLegalDescriptionsFromPDFUrl(pdfUrl);

  if (!extraction.success) {
    throw new Error('Failed to extract PDF');
  }

  // Process each high-confidence ward description
  for (const section of extraction.highConfidenceSections) {
    const wardId = section.wardIdentifier;
    if (!wardId) continue;

    console.log(`Processing Ward ${wardId}...`);

    // This text can now be passed to the reconstruction pipeline:
    // 1. parseWardDescription() - Parse into structured segments
    // 2. matchWardDescription() - Match to street network
    // 3. buildWardPolygon() - Construct GeoJSON polygon

    /*
    import { parseWardDescription, reconstructWard } from './reconstruction';

    const reconstructionInput = {
      cityFips: '1234567',
      cityName: 'Example City',
      state: 'TX',
      wardId: wardId,
      wardName: `Ward ${wardId}`,
      descriptionText: section.text,
      source: {
        type: 'pdf_redistricting_plan' as const,
        source: pdfUrl,
        title: extraction.sourceExtraction.metadata.title || 'Ward Ordinance',
        effectiveDate: extraction.sourceExtraction.metadata.creationDate || '2024-01-01',
        retrievedAt: extraction.sourceExtraction.extractedAt,
        contentHash: extraction.sourceExtraction.contentHash,
      },
    };

    const result = reconstructWard(reconstructionInput, streetSegments);
    if (result.success) {
      console.log(`✓ Ward ${wardId} reconstructed successfully`);
    }
    */
  }
}

// =============================================================================
// Example 5: Handling warnings and errors
// =============================================================================

async function example5_errorHandling(): Promise<void> {
  const filePath = '/path/to/scanned-document.pdf';

  const extraction = await extractTextFromPDF(filePath);

  // Check for extraction success
  if (!extraction.success) {
    console.error('Failed to extract PDF:', extraction.error);
    // Possible reasons:
    // - File not found
    // - Invalid PDF format
    // - Corrupted file
    return;
  }

  // Check for warnings
  if (extraction.warnings.length > 0) {
    console.warn('Extraction warnings:');
    for (const warning of extraction.warnings) {
      console.warn('-', warning);
    }

    // Common warning: "PDF contains no extractable text (may be scanned image)"
    // Solution: Use OCR pre-processing before extraction
    if (extraction.text.trim().length === 0) {
      console.error('PDF is likely a scanned image - OCR required');
      return;
    }
  }

  // Verify content hash for integrity
  console.log('Content hash:', extraction.contentHash);
  // Store this hash to detect if the PDF changes later

  // Check extraction quality
  const descriptions = extractLegalDescriptions(extraction);

  if (descriptions.sections.length === 0) {
    console.warn('No legal descriptions found in PDF');
    console.log('- Text length:', extraction.text.length);
    console.log('- Possible reasons: descriptive text format, narrative descriptions');
  } else if (descriptions.highConfidenceSections.length === 0) {
    console.warn('No high-confidence legal descriptions found');
    console.log('- Consider manual review of medium/low confidence sections');
  }
}

// =============================================================================
// Run examples
// =============================================================================

if (require.main === module) {
  console.log('PDF Extractor Examples\n');

  // Uncomment to run specific examples:
  // example1_extractFromFile().catch(console.error);
  // example2_extractFromUrl().catch(console.error);
  // example3_filterByConfidence().catch(console.error);
  // example4_pipelineIntegration().catch(console.error);
  // example5_errorHandling().catch(console.error);

  console.log('Examples defined. Uncomment to run specific examples.');
}
