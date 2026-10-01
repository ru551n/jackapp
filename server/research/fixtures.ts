// Real-shaped provider responses for tests (trimmed copies of the APIs' structure).

const UP = 'https://upload.wikimedia.org/wikipedia/commons'
const commonsPage = (pageid: number, index: number, file: string, extmetadata: Record<string, string>) => ({
  pageid,
  ns: 6,
  title: `File:${file}`,
  index,
  imagerepository: 'local',
  imageinfo: [
    {
      thumburl: `${UP}/thumb/a/ab/${encodeURIComponent(file)}/1024px-${encodeURIComponent(file)}`,
      thumbwidth: 1024,
      url: `${UP}/a/ab/${encodeURIComponent(file)}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
      mime: 'image/jpeg',
      extmetadata: Object.fromEntries(
        Object.entries(extmetadata).map(([k, value]) => [k, { value, source: 'commons-desc-page' }]),
      ),
    },
  ],
})

export const COMMONS_RESPONSE = {
  batchcomplete: '',
  continue: { gsroffset: 6, continue: 'gsroffset||' },
  query: {
    pages: {
      '901': commonsPage(901, 2, 'Saab JAS 39 Gripen.jpg', {
        ObjectName: 'Saab JAS 39 Gripen',
        ImageDescription: '<p>A <b>Gripen</b> fighter in flight &amp; banking</p>',
        Artist: '<a href="//commons.wikimedia.org/wiki/User:Example" title="User:Example">Example Photographer</a>',
        LicenseShortName: 'CC BY-SA 4.0',
        License: 'cc-by-sa-4.0',
        LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        AttributionRequired: 'true',
        UsageTerms: 'Creative Commons Attribution-Share Alike 4.0',
      }),
      '902': commonsPage(902, 1, 'Gripen CC0.jpg', {
        ObjectName: 'Gripen on runway',
        Artist: 'Jane Doe',
        LicenseShortName: 'CC0',
        License: 'cc0',
        LicenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
        AttributionRequired: 'false',
      }),
      '903': commonsPage(903, 3, 'Gripen NC.jpg', {
        Artist: 'Someone',
        LicenseShortName: 'CC BY-NC 2.0',
        License: 'cc-by-nc-2.0',
        LicenseUrl: 'https://creativecommons.org/licenses/by-nc/2.0',
      }),
      '904': commonsPage(904, 4, 'Gripen unknown.jpg', { Artist: 'Nobody', UsageTerms: 'See source' }),
      '905': commonsPage(905, 5, 'Gripen NASA.jpg', {
        Artist: '<span class="fn">NASA</span>',
        Credit: 'NASA',
        LicenseShortName: 'Public domain',
        License: 'pd',
        UsageTerms: 'Public domain',
        AttributionRequired: 'false',
      }),
      '906': commonsPage(906, 6, 'Saab logo.png', {
        LicenseShortName: 'Public domain',
        License: 'pd',
        Restrictions: 'trademarked',
      }),
      '907': commonsPage(907, 7, 'Gripen GFDL.jpg', {
        LicenseShortName: 'GFDL',
        LicenseUrl: 'https://www.gnu.org/copyleft/fdl.html',
      }),
    },
  },
}

const ov = (id: string, license: string, license_version: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Volvo PV444 ${id}`,
  indexed_on: '2024-01-01T00:00:00Z',
  foreign_landing_url: `https://www.flickr.com/photos/someone/${id}`,
  url: `https://live.staticflickr.com/1/${id}_b.jpg`,
  creator: 'Car Fan',
  creator_url: 'https://www.flickr.com/photos/someone',
  license,
  license_version,
  license_url: `https://creativecommons.org/licenses/${license}/${license_version}/`,
  provider: 'flickr',
  source: 'flickr',
  category: 'photograph',
  filetype: 'jpg',
  mature: false,
  attribution: `"Volvo PV444 ${id}" by Car Fan is licensed under CC ${license.toUpperCase()} ${license_version}.`,
  ...extra,
})

export const OPENVERSE_RESPONSE = {
  result_count: 6,
  page_count: 1,
  page_size: 20,
  page: 1,
  results: [
    ov('a1', 'by-sa', '2.0'),
    ov('a2', 'cc0', '1.0', { license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
    ov('a3', 'by-nc', '2.0'),
    ov('a4', 'pdm', '1.0', { license_url: 'https://creativecommons.org/publicdomain/mark/1.0/', creator: null }),
    ov('a5', 'sampling+', '1.0'),
    ov('a6', 'by', '4.0', { mature: true }),
    ov('a7', 'by', '', { license_url: null }),
  ],
}
