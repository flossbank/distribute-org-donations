const got = require('gh-got')
const limit = require('call-limit')
const minimatch = require('minimatch')
const { App } = require('@octokit/app')

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
  constructor ({ log, config }) {
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

    this.config = config
    this.app = null // needs init()
  }

  async init () {
    const { privateKey, id } = await this.config.getGithubAppConfig()
    this.app = new App({ id, privateKey })
  }

  // manifestSearchPatterns: [
  //   { registry, language, patterns } => [{ registry, language, manifest }, ...]
  // ]
  async getAllManifestsForOrg (org, manifestSearchPatterns) {
    const { name, installationId } = org
    if (!name || !installationId || !this.app) {
      throw new Error('need org name, installationId, and a valid GH app to get manifests')
    }
    const token = await this.app.getInstallationAccessToken({ installationId })

    const manifests = await Promise.all(
      manifestSearchPatterns.map(async (manifestSearchPattern) => (
        this.getManifestsForOrg(name, manifestSearchPattern, token)
      ))
    )
    return manifests.flat()
  }

  async getManifestsForOrg (org, manifestSearchPattern, token) {
    const repos = await this.getOrgRepos(org, token)

    const filesToFetch = []
    for (const repo of repos) {
      const { registry, language, patterns } = manifestSearchPattern
      for (const pattern of patterns) {
        const searchResults = await this.searchForManifests(repo, { registry, language, pattern }, token)
        for (const file of searchResults) {
          filesToFetch.push((async () => {
            const manifest = await this.fetchFile(repo, file, token)
            return { registry, language, manifest }
          })())
        }
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
    // It's possible at some point in the future, github api https://developer.github.com/v3/repos/
    // will allow us to filter for non archived repos during the request. Until then, we'll fetch all
    // repos and filter the response.
    let repos = await this.got.paginate.all(`orgs/${org}/repos`, { token })
    repos = repos.filter(repo => !repo.archived)

    // Repo's have an "archived" key on them in api v3 https://developer.github.com/v3/repos/
    // We don't want to distribute donations or count deps for any archived repositories.
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
