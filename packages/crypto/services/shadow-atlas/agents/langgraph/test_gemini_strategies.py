#!/usr/bin/env python3
"""Test the multi-strategy Gemini discovery approach."""

import asyncio
import os
import aiohttp
import re
from dotenv import load_dotenv

load_dotenv()

async def get_api_key():
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        pool = os.getenv('GEMINI_KEYS', '')
        if pool:
            api_key = pool.split(',')[0].split(':')[1]
    return api_key

async def test_gemini_multi_strategy(city: str, state: str):
    from google import genai
    from google.genai.types import Tool, GoogleSearch

    api_key = await get_api_key()
    client = genai.Client(api_key=api_key)
    google_search_tool = Tool(google_search=GoogleSearch())

    print(f'\n{"="*60}')
    print(f'{city}, {state}')
    print("="*60)

    # Strategy 1: ArcGIS Hub
    prompt1 = f'''Find {city}, {state} city council district boundaries data.

Search for: "{city} city council districts" site:arcgis.com OR site:hub.arcgis.com

Return the ArcGIS Hub dataset URL or FeatureServer URL.
If not found, respond NOT_FOUND.'''

    response1 = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=prompt1,
        config={'tools': [google_search_tool]},
    )
    text1 = response1.text.strip()
    print(f'Strategy 1 response: {text1[:300]}...' if len(text1) > 300 else f'Strategy 1: {text1}')

    # Extract ArcGIS URLs
    urls = re.findall(r'https?://[^\s<>"\'`\)]+(?:arcgis|hub\.arcgis)[^\s<>"\'`\)]*', text1)
    print(f'Found ArcGIS URLs: {urls[:3]}')

    # Try to resolve Hub URLs
    for url in urls[:2]:
        item_match = re.search(r'(?:datasets|items)/([a-f0-9]+)', url)
        if item_match:
            item_id = item_match.group(1)
            print(f'Resolving Hub item: {item_id}')
            async with aiohttp.ClientSession() as session:
                meta_url = f'https://www.arcgis.com/sharing/rest/content/items/{item_id}?f=json'
                try:
                    async with session.get(meta_url, timeout=15) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            svc_url = data.get('url')
                            if svc_url:
                                print(f'  -> FeatureServer: {svc_url}')
                                # Probe it
                                probe_url = f'{svc_url}/0/query?where=1%3D1&returnCountOnly=true&f=json'
                                async with session.get(probe_url, timeout=15) as pr:
                                    if pr.status == 200:
                                        pdata = await pr.json()
                                        print(f'  -> Features: {pdata.get("count", "error")}')
                                        return True
                except Exception as e:
                    print(f'  -> Error: {e}')

    print('Strategy 1 failed, no valid Hub data')
    return False

async def main():
    for city in ['Corpus Christi', 'Plano', 'Amarillo']:
        await test_gemini_multi_strategy(city, 'TX')
        await asyncio.sleep(5)

if __name__ == '__main__':
    asyncio.run(main())
