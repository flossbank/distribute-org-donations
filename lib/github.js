const got = require('gh-got')
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
  }

  async getManifestsForOrg (org, manifestSearchPattern, token) {
    const repos = this.got.paginate(`orgs/${org}/repos`, { token })

    const manifests = []
    for await (const repo of repos) {
      const searchResults = this.searchForManifests(repo, manifestSearchPattern, token)
      for await (const searchResult of searchResults) {
        this.log.info('Fetching %s from %s', searchResult.path, repo.full_name)
        const manifest = await this.fetchFileFromRepo(repo, searchResult, token)
        manifests.push(manifest)
      }
    }

    this.log.info('Found %d manifest files in %s', manifests.length, org)
    return manifests
  }

  searchForManifests (repo, searchPattern, token) {
    const options = {
      searchParams: { q: `filename:${searchPattern} repo:${repo.full_name}` },
      _pagination: {
        transform: async ({ body }) => {
          // filter out partial matches (e.g. package-lock.json)
          const files = (body.items || []).filter(file => minimatch(file.name, searchPattern))
          return files
        }
      },
      token
    }

    return this.got.paginate('search/code', options)
  }

  async fetchFileFromRepo (repo, file, token) {
    const { path } = file
    const { body } = await this.got.get(`repos/${repo.owner.login}/${repo.name}/contents/${path}`, { token })
    const contents = Buffer.from(body.content, 'base64').toString('utf8')
    return contents
  }
}

module.exports = GithubRetriever
