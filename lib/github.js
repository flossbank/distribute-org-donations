const got = require('gh-got')
const limit = require('call-limit')
const minimatch = require('minimatch')

const getRateLimit = headers => ({
  limit: parseInt(headers['x-ratelimit-limit'], 10),
  remaining: parseInt(headers['x-ratelimit-remaining'], 10),
  reset: new Date(parseInt(headers['x-ratelimit-reset'], 10) * 1000)
})

async function sleepUntil (date) {
  return new Promise((resolve) => {
    const now = Date.now()
    const then = date.getTime()
    if (now >= then) return resolve()

    setTimeout(() => resolve(), then - now)
  })
}

class GithubRetriever {
  constructor ({ log }) {
    this.log = log
    this.got = got.extend({
      hooks: {
        afterResponse: [
          async (response) => {
            const rateLimits = getRateLimit(response.headers)
            if (rateLimits && rateLimits.remaining < 1) {
              this.log.warn('Rate limited; continuing at %s', rateLimits.reset.toString())
              await sleepUntil(rateLimits.reset)
            }
            return response
          }
        ]
      }
    })

    this.cache = new Map()
    this.fetchFile = limit.promise(this.fetchFileFromRepo, 30) // limit to 30 concurrent downloads
  }

  async getManifestsForOrg (org, manifestSearchPattern, token) {
    const repos = await this.getOrgRepos(org, token)

    const filesToFetch = []
    for (const repo of repos) {
      const searchResults = await this.searchForManifests(repo, manifestSearchPattern, token)
      for (const file of searchResults) {
        filesToFetch.push(this.fetchFile(repo, file, token))
      }
    }

    // rate limits are tight on searching, but pretty loose on downloading code
    // so we can download the manifests in parallel
    const manifests = await Promise.all(filesToFetch)

    this.log.info('Found %d manifest files in %s', manifests.length, org)
    return manifests
  }

  async getOrgRepos (org, token) {
    const cacheKey = `repos_${org}`
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    this.log.info('Getting repos for %s', org)
    const repos = await this.got.paginate.all(`orgs/${org}/repos`, { token })
    this.cache.set(cacheKey, repos)

    return repos
  }

  async searchForManifests (repo, searchPattern, token) {
    const { registry, language, pattern } = searchPattern
    const cacheKey = `${repo.full_name}_${registry}_${language}`
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    const options = {
      searchParams: { q: `filename:${pattern} repo:${repo.full_name}` },
      _pagination: {
        transform: async ({ body }) => {
          // filter out partial matches (e.g. package-lock.json)
          const files = (body.items || []).filter(file => minimatch(file.name, pattern))
          return files
        }
      },
      token
    }

    this.log.info('Searching for %s/%s manifests in %s', language, registry, repo.full_name)
    const searchResults = await this.got.paginate.all('search/code', options)
    this.cache.set(cacheKey, searchResults)

    return searchResults
  }

  async fetchFileFromRepo (repo, file, token) {
    this.log.info('Fetching %s from %s', file.path, repo.full_name)
    const { path } = file
    const { body } = await this.got.get(`repos/${repo.owner.login}/${repo.name}/contents/${path}`, { token })
    const contents = Buffer.from(body.content, 'base64').toString('utf8')
    return contents
  }
}

module.exports = GithubRetriever
