class Config {
  constructor ({ kms, dynamo }) {
    this.kms = kms
    this.dynamo = dynamo
    this.configCache = new Map()
  }

  async decrypt (data) {
    return this.kms.decrypt({
      CiphertextBlob: Buffer.from(data, 'base64')
    }).promise().then(decrypted => decrypted.Plaintext.toString())
  }

  async getAndCacheValue (configKey) {
    if (this.configCache.has(configKey)) {
      return this.configCache.get(configKey)
    }
    const configValue = await this.dynamo.getConfigValue(configKey)
    this.configCache.set(configKey, configValue)

    return configValue
  }

  async getMongoUri () {
    if (this.configCache.has('mongoUri')) {
      return this.configCache.get('mongoUri')
    }
    const mongoUri = await this.decrypt(process.env.MONGO_URI)
    this.configCache.set('mongoUri', mongoUri)
    return mongoUri
  }

  async getCompensationEpsilon () {
    // this is the smallest amount we will compensate a package in millicents
    return this.getAndCacheValue('compensationEpsilon') // Number
  }
}

module.exports = Config