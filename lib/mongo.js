const { MongoClient, ObjectId } = require('mongodb')

const MONGO_DB = 'flossbank_db'
const PACKAGES_COLLECTION = 'packages'

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

  async distributeOrgDonation ({ donationAmount, packageWeightsMap, organizationId }) {
    // if there are no weights in the map, this suggests we found no supported package manifest files
    // in the organization's repos
    if (!packageWeightsMap.size) {
      return
    }

    const totalMass = Array.from(packageWeightsMap.values()).reduce((acc, val) => acc + val, 0)
    const packageIds = packageWeightsMap.keys()

    const bulkUpdates = this.db.collection(PACKAGES_COLLECTION).initializeUnorderedBulkOp()
    for (const id of packageIds) {
      const packageWeight = packageWeightsMap.get(id)
      const packagePortion = packageWeight / totalMass
      const packageShareOfDonation = packagePortion * donationAmount
      bulkUpdates.find({ _id: ObjectId(id) }).updateOne({
        $push: {
          donationRevenue: { organizationId, amount: packageShareOfDonation, timestamp: Date.now() }
        }
      })
    }
    return bulkUpdates.execute()
  }
}

module.exports = Mongo
