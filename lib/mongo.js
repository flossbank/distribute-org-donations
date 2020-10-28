const { MongoClient, ObjectId } = require('mongodb')

const MONGO_DB = 'flossbank_db'
const PACKAGES_COLLECTION = 'packages'
const ORGS_COLLECTION = 'organizations'
const USERS_COLLECTION = 'users'
const META_COLLECTION = 'meta'
const NO_COMP_LIST = 'noCompList'

class Mongo {
  constructor ({ config, log }) {
    this.log = log
    this.config = config
    this.db = null
    this.mongoClient = null
  }

  async connect () {
    const mongoUri = await this.config.getMongoUri()
    this.mongoClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    await this.mongoClient.connect()

    this.db = this.mongoClient.db(MONGO_DB)
  }

  async close () {
    if (this.mongoClient) return this.mongoClient.close()
  }

  async getOrgAccessToken ({ organizationId }) {
    this.log.info('Retrieving org from DB')
    // Get org from DB
    // Find user with write permissions in org
    // Get user from DB
    // Find access token in user
    const org = await this.db.collection(ORGS_COLLECTION).findOne({
      _id: ObjectId(organizationId)
    })

    const { name, host } = org
    this.log.info('Found org %s with code host %s', name, host)

    const adminUser = org.users.find((user) => user.role === 'WRITE')
    if (!adminUser) {
      throw new Error(`Could not find an admin user for organization ${organizationId}`)
    }
    const { userId } = adminUser
    this.log.info('Found user with write permission: %s', userId)

    const user = await this.db.collection(USERS_COLLECTION).findOne({
      _id: ObjectId(userId)
    })

    if (!user) {
      throw new Error(`Invalid user id found in organization ${organizationId}`)
    }

    const { codeHost } = user
    const { accessToken } = codeHost[host]
    this.log.info('Found %s access token in user', host)

    return { name, host, accessToken }
  }

  async distributeOrgDonation ({ donationAmount, packageWeightsMap, language, registry, organizationId }) {
    // if there are no weights in the map, this suggests we found no supported package manifest files
    // in the organization's repos for this language and registry
    if (!packageWeightsMap.size) {
      return
    }

    this.log.info('Distributing %d to %d packages for language: %s, registry: %s', donationAmount, packageWeightsMap.size, language, registry)

    const bulkUpdates = this.db.collection(PACKAGES_COLLECTION).initializeUnorderedBulkOp()
    for (const [pkg, weight] of packageWeightsMap) {
      const packageShareOfDonation = weight * donationAmount
      bulkUpdates.find({ registry, language, name: pkg }).upsert().updateOne({
        $push: {
          donationRevenue: { organizationId, amount: packageShareOfDonation, timestamp: Date.now() }
        }
      })
    }
    return bulkUpdates.execute()
  }

  async createOrganizationOssUsageSnapshot ({ totalDependencies, topLevelDependencies, organizationId }) {
    return this.db.collection(ORGS_COLLECTION).updateOne({
      _id: ObjectId(organizationId),
      $push: {
        snapshots: { timestamp: Date.now(), totalDependencies, topLevelDependencies }
      }
    })
  }

  async getNoCompList ({ language, registry }) {
    const noCompList = await this.db.collection(META_COLLECTION).findOne({
      name: NO_COMP_LIST,
      language,
      registry
    })
    if (!noCompList || !noCompList.list) {
      return new Set()
    }
    return new Set(noCompList.list)
  }
}

module.exports = Mongo
