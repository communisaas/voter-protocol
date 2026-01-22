/**
 * Direct OSM Query to find specific streets
 */

async function queryOSM(query: string): Promise<unknown> {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  return response.json();
}

async function main(): Promise<void> {
  console.log('Querying OSM for specific street names in St. Louis area...\n');

  // Query for Watson Road in Crestwood area with bbox
  // Crestwood is around -90.37, 38.56
  const query = `
[out:json][timeout:30];
(
  way["highway"]["name"~"Watson|Sappington|Big Bend|Grant",i](38.50,-90.45,38.62,-90.30);
);
out geom;
`;

  console.log('Query:', query);
  console.log('\nSending to Overpass API...');

  try {
    const result = await queryOSM(query) as { elements: Array<{ id: number; tags?: { name?: string; highway?: string } }> };
    console.log(`\nFound ${result.elements.length} ways`);

    // Group by name
    const byName = new Map<string, number>();
    for (const el of result.elements) {
      if (el.tags?.name) {
        const count = byName.get(el.tags.name) ?? 0;
        byName.set(el.tags.name, count + 1);
      }
    }

    console.log('\nStreet names found:');
    for (const [name, count] of [...byName.entries()].sort()) {
      console.log(`  ${name}: ${count} segments`);
    }

    // Show details of first few
    console.log('\nSample elements:');
    result.elements.slice(0, 5).forEach((el) => {
      console.log(`  ID: ${el.id}`);
      console.log(`    Name: ${el.tags?.name}`);
      console.log(`    Highway: ${el.tags?.highway}`);
    });
  } catch (e) {
    console.log('Error:', e);
  }
}

main();
