# Geocoding Architecture: Provider-Agnostic Design

**Date:** 2025-11-08
**Principle:** Geocoding providers are CONFIGURATION, not CODE

---

## Design Philosophy

**THE PROBLEM:** Geocodio only supports US + Canada. We need global expansion.

**BAD APPROACH:** Hardcode Geocodio calls throughout codebase
```typescript
// ❌ WRONG - Tightly coupled to Geocodio
const coords = await geocodio.geocode(address);
const district = findDistrictForCoords(coords);
```

**PRINCIPLED APPROACH:** Abstract geocoding behind provider-agnostic interface
```typescript
// ✅ CORRECT - Provider selected automatically
const coords = await geocodingService.geocode(address);
const district = await districtResolver.resolve(address);
```

**Result:** Business logic never knows which geocoding provider is used. Provider selection is environmental configuration, not application code.

---

## Architecture Layers

### Layer 1: Provider Interface (`types.ts`)

**Abstraction:** Common interface ALL geocoding providers must implement

```typescript
export interface GeocodingProvider {
  geocode(address: Address): Promise<GeocodeResult>;
  reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult>;
  geocodeBatch?(addresses: Address[]): Promise<GeocodeResult[]>;

  readonly capabilities: {
    supportedCountries: string[]; // ['US', 'CA'] or ['*'] for global
    rateLimit?: number;
    accuracy: 'rooftop' | 'street' | 'city';
  };

  readonly pricing: {
    costPerLookup: number; // USD
    freeTierLimit?: number;
  };
}
```

**Key Insight:** Every provider returns the SAME types (`GeocodeResult`, `Address`, `Coordinates`). Business logic doesn't care if it's Geocodio, Nominatim, Google Maps, or Mapbox.

---

### Layer 2: Provider Implementations

**Phase 1: Geocodio** (US + Canada, $0.0005/lookup)
- File: `providers/geocodio.ts`
- Countries: `['US', 'CA']`
- Accuracy: Rooftop (highest)
- Cost: $0.50 per 1,000 lookups

**Phase 3: Nominatim** (Global, FREE)
- File: `providers/nominatim.ts`
- Countries: `['*']` (all countries with OSM data)
- Accuracy: Street (lower than Geocodio)
- Cost: $0 (self-hosted or public OSM instance)

**Future: Google Maps** (Premium global, expensive)
- File: `providers/google.ts`
- Countries: `['*']`
- Accuracy: Rooftop (highest globally)
- Cost: $0.005 per lookup (10x Geocodio)

**Future: Mapbox** (Global, mid-tier)
- File: `providers/mapbox.ts`
- Countries: `['*']`
- Accuracy: Street
- Cost: $0.0006 per lookup

**Key Insight:** Each provider is a SEPARATE FILE implementing the SAME INTERFACE. Adding a new provider requires ZERO changes to business logic.

---

### Layer 3: Routing Service (`index.ts`)

**Responsibility:** Select best provider based on country + strategy

```typescript
export class GeocodingService {
  private selectProvider(country: string): GeocodingProvider {
    switch (this.config.strategy) {
      case 'cost-optimized':
        // Geocodio for US/CA (cheap + accurate)
        if (['US', 'CA'].includes(country)) return geocodio;
        // Nominatim for everything else (FREE)
        return nominatim;

      case 'accuracy-first':
        // Geocodio for US/CA
        if (['US', 'CA'].includes(country)) return geocodio;
        // Google Maps for international (premium)
        return googleMaps;
    }
  }
}
```

**Routing Rules:**
- **US/Canada:** Geocodio (best accuracy + cheap, Phase 1)
- **UK/EU/AU:** Nominatim FREE (Phase 3) OR Google Maps premium (if accuracy-first)
- **Future:** Country-specific providers (e.g., Japan Post for JP addresses)

**Key Insight:** Business logic calls `geocodingService.geocode(address)`. The service decides which provider to use based on `address.country` + configured strategy.

---

### Layer 4: Business Logic (`district-resolver.ts`)

**Responsibility:** Resolve legislative districts for address

```typescript
export class DistrictResolver {
  async resolveDistricts(address: Address): Promise<District[]> {
    // Step 1: Geocode (provider-agnostic)
    const coords = await this.geocodingService.geocode(address);

    // Step 2: Country-specific district resolution
    const strategy = this.getCountryStrategy(address.country);
    const districts = await strategy.resolve(address, coords);

    return districts;
  }
}
```

**Key Insight:** District resolver NEVER calls Geocodio/Nominatim directly. It calls `geocodingService.geocode()`, which abstracts provider selection.

---

## International Scalability

### Adding a New Country (Example: UK)

**1. Geocoding (ALREADY WORKS):**
```typescript
// No code changes needed - Nominatim supports UK
const service = createGeocodingService();
const result = await service.geocode({
  street: '10 Downing Street',
  city: 'London',
  country: 'GB' // ← Nominatim auto-selected
});
```

**2. District Resolution (Country-Specific):**
```typescript
// Add UK strategy (NEW FILE)
class UKDistrictStrategy implements CountryStrategy {
  async resolve(address: Address, coords: Coordinates): Promise<District[]> {
    // UK-specific logic:
    // 1. City council wards (local authority GIS)
    // 2. Parliamentary constituencies (UK Parliament API)
    return districts;
  }
}

// Register strategy (ONE LINE)
districtResolver.strategies.set('GB', new UKDistrictStrategy());
```

**Key Insight:** Adding UK support requires:
- ✅ Geocoding: ZERO changes (Nominatim already supports UK)
- ✅ Districts: ONE new file implementing `CountryStrategy` interface
- ✅ Business logic: ZERO changes (already calls `resolveDistricts(address)`)

---

### Adding a New Geocoding Provider (Example: Mapbox)

**1. Implement Provider Interface:**
```typescript
// NEW FILE: providers/mapbox.ts
export class MapboxProvider implements GeocodingProvider {
  readonly capabilities = {
    supportedCountries: ['*'], // Global
    accuracy: 'street' as const
  };

  async geocode(address: Address): Promise<GeocodeResult> {
    // Mapbox API call
    const response = await fetch(`https://api.mapbox.com/geocoding/v5/...`);
    return {
      coordinates: { latitude, longitude },
      accuracy,
      source: 'mapbox'
    };
  }
}
```

**2. Register Provider:**
```typescript
// ONE LINE in GeocodingService constructor
this.providers.set('mapbox', new MapboxProvider(config.mapboxApiKey));
```

**3. Update Routing (OPTIONAL):**
```typescript
// Prefer Mapbox for accuracy in EU
if (country.startsWith('EU-') && this.config.strategy === 'accuracy-first') {
  return this.providers.get('mapbox')!;
}
```

**Key Insight:** Adding Mapbox requires:
- ✅ ONE new file implementing `GeocodingProvider`
- ✅ ONE line registering provider
- ✅ Business logic: ZERO changes

---

## Cost Optimization Strategy

### Provider Selection by Country (Phase-by-Phase)

| Country | Phase 1 | Phase 3 | Future (Premium) |
|---------|---------|---------|------------------|
| **US** | Geocodio ($0.0005) | Geocodio | Google Maps ($0.005) |
| **Canada** | Geocodio ($0.0005) | Geocodio | Google Maps ($0.005) |
| **UK** | N/A | Nominatim (FREE) | Google Maps ($0.005) |
| **EU** | N/A | Nominatim (FREE) | Mapbox ($0.0006) |
| **Australia** | N/A | Nominatim (FREE) | Google Maps ($0.005) |
| **Japan** | N/A | Nominatim (FREE) | Japan Post API (FREE) |

### Strategy Toggle (Runtime Configuration)

```typescript
// Cost-optimized (default)
const service = new GeocodingService({
  geocodioApiKey: process.env.GEOCODIO_API_KEY,
  strategy: 'cost-optimized' // ← FREE/cheap providers
});

// Accuracy-first (premium)
const service = new GeocodingService({
  geocodioApiKey: process.env.GEOCODIO_API_KEY,
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  strategy: 'accuracy-first' // ← Best accuracy globally
});
```

**Key Insight:** Changing from FREE Nominatim to premium Google Maps requires ZERO code changes. It's an ENVIRONMENT VARIABLE change.

---

## Testing Strategy

### Provider-Agnostic Tests

```typescript
describe('DistrictResolver', () => {
  it('resolves US address with any geocoding provider', async () => {
    // Test with Geocodio
    const geocodioService = createGeocodingService({ forceProvider: 'geocodio' });
    const resolver1 = new DistrictResolver({ geocodingService: geocodioService });
    const result1 = await resolver1.resolveDistricts(testAddress);

    // Test with Nominatim
    const nominatimService = createGeocodingService({ forceProvider: 'nominatim' });
    const resolver2 = new DistrictResolver({ geocodingService: nominatimService });
    const result2 = await resolver2.resolveDistricts(testAddress);

    // Should return same district (different providers, same result)
    expect(result1.districts[0].id).toBe(result2.districts[0].id);
  });
});
```

**Key Insight:** Tests verify business logic works with ANY provider implementing the interface. If Geocodio goes down, switch to Nominatim with ZERO code changes.

---

## Migration Path (Phase 1 → Phase 3)

### Phase 1: US Launch (Geocodio only)
```typescript
const service = new GeocodingService({
  geocodioApiKey: process.env.GEOCODIO_API_KEY,
  strategy: 'cost-optimized'
});
// Supports: US, CA
```

### Phase 2: Add Canada
```typescript
// ZERO code changes - Geocodio already supports CA
const service = new GeocodingService({
  geocodioApiKey: process.env.GEOCODIO_API_KEY,
  strategy: 'cost-optimized'
});
// Supports: US, CA
```

### Phase 3: Global Expansion (UK, EU, AU)
```typescript
const service = new GeocodingService({
  geocodioApiKey: process.env.GEOCODIO_API_KEY,
  // Nominatim auto-registered (no API key required)
  strategy: 'cost-optimized'
});
// Supports: US (Geocodio), CA (Geocodio), UK/EU/AU (Nominatim FREE)
```

**Key Insight:** Going from US-only → global requires ZERO code changes. Just deploy with Nominatim provider available.

---

## Principles Summary

**1. ABSTRACTION:** Geocoding providers are PLUGINS, not hardcoded dependencies

**2. CONFIGURATION:** Provider selection is ENVIRONMENT CONFIG, not application logic

**3. SCALABILITY:** Adding countries requires NEW FILES, not REFACTORING

**4. TESTABILITY:** Mock any provider by implementing `GeocodingProvider` interface

**5. COST CONTROL:** Switch FREE ↔ premium providers with ENV VAR change

**6. FUTURE-PROOF:** When Geocodio adds international support, change ONE LINE (routing logic)

---

## File Structure

```
/packages/crypto/services/geocoding/
├── types.ts                      # Provider interface (abstraction)
├── index.ts                      # Routing service (provider selection)
├── providers/
│   ├── geocodio.ts              # Phase 1: US + CA
│   ├── nominatim.ts             # Phase 3: Global (FREE)
│   ├── google.ts                # Future: Premium global
│   └── mapbox.ts                # Future: Mid-tier global
└── README.md                     # Provider comparison, costs

/packages/crypto/services/
└── district-resolver.ts          # Business logic (provider-agnostic)
```

**Key Insight:** Each layer is SEPARATE FILE. No circular dependencies. Clear separation of concerns.

---

## Real-World Example: Handling Geocodio Outage

**WITHOUT abstraction (tightly coupled):**
```typescript
// ❌ DISASTER - Geocodio calls everywhere
const coords1 = await geocodio.geocode(address1); // Line 42
const coords2 = await geocodio.geocode(address2); // Line 87
const coords3 = await geocodio.geocode(address3); // Line 134
// ... 50+ more files with direct Geocodio calls
```

**Geocodio goes down → EMERGENCY REFACTOR across entire codebase**

**WITH abstraction (provider-agnostic):**
```typescript
// ✅ RESILIENT - One-line fix
const service = new GeocodingService({
  // geocodioApiKey: process.env.GEOCODIO_API_KEY, // ← Comment out broken provider
  strategy: 'cost-optimized' // ← Auto-selects Nominatim fallback
});
```

**Geocodio goes down → Change ONE LINE in environment config, redeploy**

---

## Conclusion

**Geocoding providers will change.** Geocodio may add international support. Nominatim may improve accuracy. Google Maps pricing may become competitive. New providers (Mapbox, HERE, TomTom) may emerge.

**This architecture makes provider changes CONFIGURATION, not REFACTORING.**

Business logic calls:
```typescript
await geocodingService.geocode(address);
await districtResolver.resolveDistricts(address);
```

Provider selection happens in ONE FILE (`geocoding/index.ts`), isolated from ALL business logic.

**Principle:** Be principled about abstraction boundaries. Geocoding is INFRASTRUCTURE, not DOMAIN LOGIC. Domain logic should NEVER know which geocoding provider is being used.

---

**Implementation:** Claude Code
**Date:** 2025-11-08
**Status:** Production-ready architecture
