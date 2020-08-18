const test = require('ava')
const nock = require('nock')
const GithubRetriever = require('../lib/github')

const log = { info: () => {}, warn: () => {} }

test.before((t) => {})

test.beforeEach((t) => {
  const ghr = new GithubRetriever({ log })
  t.context.ghr = ghr
})

test.afterEach((t) => {
  nock.cleanAll()
})

test.serial('getManifestsForOrg | success', async (t) => {
  const { ghr } = t.context

  const scope = nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [
      { full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' } },
      { full_name: 'flossbank/splash', name: 'splash', owner: { login: 'flossbank' } }
    ])
    .get('/search/code').query(true)
    .reply(200, {
      items: [
        { name: 'package.json', path: 'package.json' },
        { name: 'package-lock.json', path: 'package-lock.json' },
        { name: 'package.json', path: 'ci/tests/package.json' }
      ]
    }, { // these headers trigger the rate-limiter-avoiding logic
      'x-ratelimit-remaining': 0,
      'x-ratelimit-reset': (Date.now() + 2000) / 1000
    })
    .get('/search/code').query(true)
    .reply(200, {
      items: [
        { name: 'package.json', path: 'package.json' }
      ]
    })
    .get('/repos/flossbank/cli/contents/package.json')
    .reply(200, { content: Buffer.from('cli_package.json').toString('base64') })
    .get('/repos/flossbank/cli/contents/ci/tests/package.json')
    .reply(200, { content: Buffer.from('cli_ci_package.json').toString('base64') })
    .get('/repos/flossbank/splash/contents/package.json')
    .reply(200, { content: Buffer.from('splash_package.json').toString('base64') })

  const manifests = await ghr.getManifestsForOrg('flossbank', 'package.json', 'token')

  t.notThrows(() => scope.done())

  t.deepEqual(manifests, [
    'cli_package.json',
    'cli_ci_package.json',
    'splash_package.json'
  ])
})

test.serial('getManifestsForOrg | bad github response to search', async (t) => {
  const { ghr } = t.context

  const scope = nock('https://api.github.com')
    .get('/orgs/flossbank/repos')
    .reply(200, [{ full_name: 'flossbank/cli', name: 'cli', owner: { login: 'flossbank' } }])
    .get('/search/code').query(true)
    .reply(200, {})

  const manifests = await ghr.getManifestsForOrg('flossbank', 'package.json', 'token')
  t.notThrows(() => scope.done())

  t.deepEqual(manifests, [])
})
