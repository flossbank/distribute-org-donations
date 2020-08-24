const { MongoClient } = require('mongodb')

const MONGO_DB = 'flossbank_db'
const PACKAGES_COLLECTION = 'packages'
const META_COLLECTION = 'meta'
const NO_COMP_LIST = 'noCompList'

class Mongo {
  constructor ({ config }) {
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

  async distributeOrgDonation ({ donationAmount, packageWeightsMap, language, registry, organizationId }) {
    // if there are no weights in the map, this suggests we found no supported package manifest files
    // in the organization's repos for this language and registry
    if (!packageWeightsMap.size) {
      return
    }

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
