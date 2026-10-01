import { describe, expect, it } from 'vitest'
import { COMMONS_RESPONSE, OPENVERSE_RESPONSE } from './fixtures'
import { buildAttribution, classifyLicense, parseCommons, parseOpenverse } from './licensing'

const AT = '2026-10-01T00:00:00.000Z'

describe('classifyLicense', () => {
  it.each([
    ['cc0', undefined, 'CC0-1.0', true, false],
    ['CC0', undefined, 'CC0-1.0', true, false],
    ['pd', undefined, 'PD', true, false],
    ['Public domain', undefined, 'PD', true, false],
    ['PD-USGov-NASA', undefined, 'PD', true, false],
    ['pdm', '1.0', 'PD', true, false],
    ['cc-by-4.0', undefined, 'CC-BY-4.0', true, false],
    ['CC BY-SA 3.0', undefined, 'CC-BY-SA-3.0', true, true],
    ['cc-by-sa-3.0-de', undefined, 'CC-BY-SA-3.0-DE', true, true],
    ['CC BY 3.0 IGO', undefined, 'CC-BY-3.0-IGO', true, false],
    ['CC BY-SA 3.0 migrated', undefined, 'CC-BY-SA-3.0', true, true],
    ['PD-US', undefined, 'PD-US', false, false],
    ['PD-US-expired', undefined, 'PD-US', false, false],
    ['PD-1923', undefined, 'PD-US', false, false],
    ['by-sa', '2.0', 'CC-BY-SA-2.0', true, true],
    ['by', '', 'CC-BY', false, false],
    ['cc-by-nc-2.0', undefined, 'CC-BY-NC-2.0', false, false],
    ['by-nc-sa', '4.0', 'CC-BY-NC-SA-4.0', false, false],
    ['CC BY-ND 4.0', undefined, 'CC-BY-ND-4.0', false, false],
    ['GFDL', undefined, 'unknown', false, false],
    ['sampling+', '1.0', 'unknown', false, false],
    ['Attribution', undefined, 'unknown', false, false],
    [undefined, undefined, 'unknown', false, false],
    ['', undefined, 'unknown', false, false],
  ])('%s %s → %s', (raw, ver, id, usable, sa) => {
    const v = classifyLicense(raw, ver)
    expect(v).toMatchObject({ license: id, autoUsable: usable })
    if (usable) expect(v.shareAlike).toBe(sa)
    else expect(v.reason).toBeTruthy()
  })
})

describe('licence labels and deed URLs', () => {
  it('keeps ports and IGO in the label and builds the deed URL', () => {
    expect(classifyLicense('cc-by-sa-3.0-de')).toMatchObject({
      label: 'CC BY-SA 3.0 DE',
      url: 'https://creativecommons.org/licenses/by-sa/3.0/de/',
    })
    expect(classifyLicense('CC BY 3.0 IGO')).toMatchObject({
      label: 'CC BY 3.0 IGO',
      url: 'https://creativecommons.org/licenses/by/3.0/igo/',
    })
    expect(classifyLicense('by', '4.0').url).toBe('https://creativecommons.org/licenses/by/4.0/')
  })
})

const commons = (extmetadata: Record<string, string>) => ({
  query: {
    pages: {
      1: {
        title: 'File:Kronhjort.jpg',
        index: 1,
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/k.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kronhjort.jpg',
            extmetadata: Object.fromEntries(Object.entries(extmetadata).map(([k, value]) => [k, { value }])),
          },
        ],
      },
    },
  },
})

describe('Commons metadata', () => {
  it('never uses Credit as the creator and fills a missing licence URL', () => {
    const [c] = parseCommons(commons({ Credit: 'Own work', License: 'cc-by-sa-3.0-de' }), AT)
    expect(c!.license.creator).toBeUndefined()
    expect(c!.license.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/3.0/de/')
    expect(c!.license.attribution).toContain('okänd upphovsperson')
    expect(c!.license.attribution).toContain('CC BY-SA 3.0 DE (https://creativecommons.org/licenses/by-sa/3.0/de/)')
    expect(c!.license.attribution).not.toContain('Own work')
  })

  it('uses UsageTerms when License is missing and rejects PD on a copyrighted file', () => {
    expect(parseCommons(commons({ UsageTerms: 'CC BY 4.0' }), AT)[0]!.license.license).toBe('CC-BY-4.0')
    const [pd] = parseCommons(commons({ License: 'pd', Copyrighted: 'True' }), AT)
    expect(pd!.license.autoUsable).toBe(false)
    expect(
      parseCommons(commons({ License: 'pd', AttributionRequired: 'true' }), AT)[0]!.verdict.attributionRequired,
    ).toBe(true)
  })
})

describe('Openverse public-domain marks', () => {
  const one = (source: string) =>
    parseOpenverse(
      {
        results: [
          {
            url: 'https://example.org/a.jpg',
            title: 'Vas',
            license: 'pdm',
            license_version: '1.0',
            source,
            foreign_landing_url: 'https://example.org/a',
          },
        ],
      },
      AT,
    )[0]!.license.autoUsable
  it('trusts pdm only from curated institutions', () => {
    expect(one('met')).toBe(true)
    expect(one('smithsonian_national_museum_of_natural_history')).toBe(true)
    expect(one('flickr')).toBe(false)
  })
})

describe('provider parsing', () => {
  it('Commons extmetadata: order, licences, stripped artist, restrictions', () => {
    const c = parseCommons(COMMONS_RESPONSE, AT)
    expect(c.map((x) => [x.title, x.license.license, x.license.autoUsable])).toEqual([
      ['Gripen on runway', 'CC0-1.0', true],
      ['Saab JAS 39 Gripen', 'CC-BY-SA-4.0', true],
      ['Gripen NC', 'CC-BY-NC-2.0', false],
      ['Gripen unknown', 'unknown', false],
      ['Gripen NASA', 'PD', true],
      ['Saab logo', 'PD', false], // trademarked
      ['Gripen GFDL', 'unknown', false],
    ])
    const sa = c[1]!
    expect(sa.license).toMatchObject({
      creator: 'Example Photographer',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Saab%20JAS%2039%20Gripen.jpg',
      provider: 'Wikimedia Commons',
      retrievedAt: AT,
    })
    expect(sa.downloadUrl).toContain('/thumb/')
    expect(sa.license.assetUrl).toBe(sa.downloadUrl)
    expect(sa.alt).toBe('A Gripen fighter in flight & banking')
    expect(sa.license.attribution).toContain('Får delas vidare under samma licens')
    expect(c[4]!.license.creator).toBe('NASA')
  })

  it('Openverse: licence + version, mature skipped, missing version rejected', () => {
    const o = parseOpenverse(OPENVERSE_RESPONSE, AT)
    expect(o.map((x) => [x.license.license, x.license.autoUsable])).toEqual([
      ['CC-BY-SA-2.0', true],
      ['CC0-1.0', true],
      ['CC-BY-NC-2.0', false],
      ['PD', false], // pdm from Flickr: an uploader's claim
      ['unknown', false],
      ['CC-BY', false],
    ])
    expect(o[0]!.license).toMatchObject({
      creator: 'Car Fan',
      sourceUrl: 'https://www.flickr.com/photos/someone/a1',
      provider: 'Openverse (flickr)',
    })
    expect(o[3]!.license.creator).toBeUndefined()
  })

  it('tolerates empty or malformed responses', () => {
    expect(parseCommons({}, AT)).toEqual([])
    expect(parseCommons({ query: { pages: { 1: { title: 'File:x.jpg' } } } }, AT)).toEqual([])
    expect(parseOpenverse({ results: [{ url: 'javascript:alert(1)' }] }, AT)).toEqual([])
  })
})

describe('buildAttribution', () => {
  it('builds TASL with share-alike note and caps length', () => {
    expect(
      buildAttribution({
        title: 'Saab JAS 39 Gripen',
        creator: 'Example Photographer',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Gripen.jpg',
        provider: 'Wikimedia Commons',
        label: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        shareAlike: true,
      }),
    ).toBe(
      '”Saab JAS 39 Gripen”, av Example Photographer, licens: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), ' +
        'källa: Wikimedia Commons, https://commons.wikimedia.org/wiki/File:Gripen.jpg. Får delas vidare under samma licens.',
    )
    const long = buildAttribution({
      title: 'x'.repeat(1000),
      creator: 'y'.repeat(1000),
      sourceUrl: 'https://e.org/' + 'z'.repeat(1000),
      provider: 'P',
      label: 'CC BY 4.0',
      shareAlike: false,
    })
    expect(long.length).toBeLessThanOrEqual(500)
    expect(long).toContain('x'.repeat(100))
    expect(
      buildAttribution({ title: 'T', sourceUrl: 'https://e.org', provider: 'P', label: 'CC0 1.0', shareAlike: false }),
    ).toBe('”T”, okänd upphovsperson, licens: CC0 1.0, källa: P, https://e.org.')
  })
})
