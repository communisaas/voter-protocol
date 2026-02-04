/**
 * External API Response Schemas
 *
 * SA-014: Zod schemas for validating all external API responses in the discovery pipeline.
 *
 * SECURITY PRINCIPLE: All external data must be validated before use.
 * - Prevents JSON deserialization attacks
 * - Catches schema changes in upstream APIs
 * - Provides type-safe access to response data
 */

// ============================================================================
// ArcGIS API Schemas
// ============================================================================

export {
  // Hub API
  HubDatasetAttributesSchema,
  HubDatasetSchema,
  HubDatasetsResponseSchema,
  HubSingleDatasetResponseSchema,
  parseHubDatasetsResponse,
  parseHubSingleDatasetResponse,

  // Portal API
  PortalSearchResultItemSchema,
  PortalSearchResponseSchema,
  parsePortalSearchResponse,

  // Service Info
  ArcGISLayerInfoSchema,
  ArcGISServiceInfoSchema,
  ArcGISLayerDetailSchema,
  ArcGISFolderListingSchema,
  parseArcGISServiceInfo,
  parseArcGISLayerDetail,
  parseArcGISFolderListing,

  // GeoJSON
  GeoJSONPolygonSchema,
  GeoJSONMultiPolygonSchema,
  GeoJSONGeometrySchema,
  GeoJSONFeatureSchema,
  ArcGISGeoJSONResponseSchema,
  parseArcGISGeoJSONResponse,

  // Utility
  safeParseArcGISResponse,

  // Types
  type ValidatedHubDatasetAttributes,
  type ValidatedHubDataset,
  type ValidatedHubDatasetsResponse,
  type ValidatedHubSingleDatasetResponse,
  type ValidatedPortalSearchResultItem,
  type ValidatedPortalSearchResponse,
  type ValidatedArcGISLayerInfo,
  type ValidatedArcGISServiceInfo,
  type ValidatedArcGISLayerDetail,
  type ValidatedArcGISFolderListing,
  type ValidatedGeoJSONFeature,
  type ValidatedArcGISGeoJSONResponse,
} from './arcgis-response.js';

// ============================================================================
// Census API Schemas
// ============================================================================

export {
  // TIGERweb
  TIGERWebLayerInfoSchema,
  TIGERWebServiceInfoSchema,
  TIGERWebLayerDetailSchema,
  TIGERWebFeatureSchema,
  TIGERWebQueryResponseSchema,
  TIGERWebGeoJSONResponseSchema,
  parseTIGERWebServiceInfo,
  parseTIGERWebLayerDetail,
  parseTIGERWebQueryResponse,
  parseTIGERWebGeoJSONResponse,

  // Census Data API
  CensusDataAPIResponseSchema,
  CensusGeographySchema,
  parseCensusDataAPIResponse,

  // TIGER/Line
  TIGERLineAttributeSchema,
  TIGERLineFeatureSchema,
  TIGERLineFeatureCollectionSchema,
  parseTIGERLineFeatureCollection,

  // Error handling
  ArcGISErrorResponseSchema,
  isArcGISError,

  // Utility
  safeParseCensusResponse,

  // Types
  type ValidatedTIGERWebLayerInfo,
  type ValidatedTIGERWebServiceInfo,
  type ValidatedTIGERWebLayerDetail,
  type ValidatedTIGERWebFeature,
  type ValidatedTIGERWebQueryResponse,
  type ValidatedTIGERWebGeoJSONResponse,
  type ValidatedCensusDataAPIResponse,
  type ValidatedCensusGeography,
  type ValidatedTIGERLineAttribute,
  type ValidatedTIGERLineFeature,
  type ValidatedTIGERLineFeatureCollection,
  type ValidatedArcGISErrorResponse,
} from './census-response.js';

// ============================================================================
// Socrata API Schemas
// ============================================================================

export {
  // Discovery API
  SocrataDistributionSchema,
  SocrataResourceSchema,
  SocrataClassificationSchema,
  SocrataMetadataSchema,
  SocrataSearchResultSchema,
  SocrataDiscoveryResponseSchema,
  parseSocrataDiscoveryResponse,

  // Domain Catalog
  SocrataDomainResourceSchema,
  SocrataDomainSearchResultSchema,
  SocrataDomainCatalogResponseSchema,
  parseSocrataDomainCatalogResponse,

  // SODA API
  SocrataGeoJSONFeatureSchema,
  SocrataGeoJSONResponseSchema,
  SocrataJSONRowSchema,
  SocrataJSONResponseSchema,
  parseSocrataGeoJSONResponse,
  parseSocrataJSONResponse,

  // Metadata
  SocrataDatasetMetadataSchema,
  parseSocrataDatasetMetadata,

  // Error handling
  SocrataErrorResponseSchema,
  isSocrataError,

  // Utility
  safeParseSocrataResponse,

  // Types
  type ValidatedSocrataDistribution,
  type ValidatedSocrataResource,
  type ValidatedSocrataClassification,
  type ValidatedSocrataMetadata,
  type ValidatedSocrataSearchResult,
  type ValidatedSocrataDiscoveryResponse,
  type ValidatedSocrataDomainResource,
  type ValidatedSocrataDomainSearchResult,
  type ValidatedSocrataDomainCatalogResponse,
  type ValidatedSocrataGeoJSONFeature,
  type ValidatedSocrataGeoJSONResponse,
  type ValidatedSocrataJSONRow,
  type ValidatedSocrataJSONResponse,
  type ValidatedSocrataDatasetMetadata,
  type ValidatedSocrataErrorResponse,
} from './socrata-response.js';

// ============================================================================
// Field Mapping (existing)
// ============================================================================

export * from './field-mapping.js';
